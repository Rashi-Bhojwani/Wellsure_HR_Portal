import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { setBusinessTodayForTests } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { computeAttendance } from "../../attendance/compute";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { resolveDayCountContext } from "../dayCountContext";
import { writeLedgerEntry } from "../ledger";

// Audit fix (2026-11-18, docs/plans/AUDIT_FIXES.md item 1): leave days follow each person's own week-off pattern and the holidays that apply to them (the same
// settings attendance uses), not a built-in Saturday-and-Sunday. Made-up people. December 2026: Sat 5, 12, 19, 26; Sun 6, 13, 20, 27; 12 Dec is the 2nd Saturday.
const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("leave days follow the person's week-off pattern and holidays", () => {
  let org: TestOrgMasters;
  const ids: string[] = [];
  const t: Record<string, string> = {};
  const e: Record<string, string> = {};
  const patternIds: string[] = [];
  let plId = "";
  let holidayId = "";
  const apply = (who: string, fromDate: string, toDate: string, parts: { from?: string; to?: string } = {}) =>
    request(app).post("/api/leave/requests").set(...authHeader(t[who]!)).send({ leaveTypeId: plId, fromDate, toDate, fromDayPart: parts.from ?? "FULL", toDayPart: parts.to ?? (fromDate === toDate ? (parts.from ?? "FULL") : "FULL"), reason: "test" });

  beforeAll(async () => {
    setBusinessTodayForTests(d("2026-11-20"));
    org = await createEmployeeTestOrgMasters();
    const tag = `T${Date.now().toString(36).toUpperCase()}`;
    const pattern = async (code: string, rules: unknown) => {
      const p = await prisma.weekOffPattern.create({ data: { code: `${tag}_${code}`, name: `Test ${code}`, rules: rules as object } });
      patternIds.push(p.id);
      return p.id;
    };
    const monSat = await pattern("MONSAT", [{ weekday: 0 }]);
    const monFri = await pattern("MONFRI", [{ weekday: 0 }, { weekday: 6 }]);
    const altSat = await pattern("ALTSAT", [{ weekday: 0 }, { weekday: 6, weeks: [2, 4] }]);
    for (const [k, pid] of [["monSat", monSat], ["monFri", monFri], ["altSat", altSat]] as const) {
      const x = await createFullTestEmployee(org);
      ids.push(x.employeeId);
      e[k] = x.employeeId;
      t[k] = await loginAs(x.employeeCode);
      await prisma.attendanceAssignment.updateMany({ where: { employeeId: x.employeeId }, data: { weekOffPatternId: pid } });
    }
    plId = (await prisma.leaveType.findUniqueOrThrow({ where: { code: "PL" } })).id;
    for (const id of ids) await writeLedgerEntry(prisma, { employeeId: id, leaveTypeId: plId, leaveYear: 2026, entryDate: d("2026-01-01"), entryType: "ACCRUAL", days: 40 });
    const existing = await prisma.holiday.findUnique({ where: { date: d("2026-12-23") } });
    if (!existing) holidayId = (await prisma.holiday.create({ data: { date: d("2026-12-23"), name: "Test holiday" } })).id;
  }, 120_000);

  afterAll(async () => {
    setBusinessTodayForTests(null);
    await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: ids } } });
    for (const id of ids) await cleanupFullTestEmployee(id);
    await deleteWithDependents("WeekOffPattern", patternIds);
    if (holidayId) await deleteWithDependents("Holiday", [holidayId]);
    await cleanupEmployeeTestOrgMasters(org);
  }, 120_000);

  it("Monday to Saturday: a Saturday alone is 1 day, a full week (Mon to Sun) is 6, Sunday skipped", async () => {
    expect((await apply("monSat", "2026-12-05", "2026-12-05")).body.totalDays).toBe(1);
    expect((await apply("monSat", "2026-12-07", "2026-12-13")).body.totalDays).toBe(6);
  });

  it("Monday to Friday: a full week is 5; Friday to Monday across the weekend is 2; a Saturday alone has no leave day", async () => {
    expect((await apply("monFri", "2026-12-07", "2026-12-13")).body.totalDays).toBe(5);
    expect((await apply("monFri", "2026-12-18", "2026-12-21")).body.totalDays).toBe(2);
    const sat = await apply("monFri", "2026-12-05", "2026-12-05");
    expect([sat.status, sat.body.error.code]).toEqual([400, "NO_WORKING_DAYS"]);
  });

  it("2nd and 4th Saturdays off: the 1st Saturday counts, the 2nd does not", async () => {
    expect((await apply("altSat", "2026-12-05", "2026-12-05")).body.totalDays).toBe(1); // 1st Saturday: working
    expect((await apply("altSat", "2026-12-14", "2026-12-20")).body.totalDays).toBe(6); // Mon 14 to Sat 19 (3rd Saturday, working); Sun off
    const ctx = await resolveDayCountContext(e.altSat!, d("2026-12-12"), d("2026-12-12"));
    expect([...ctx.weekOffDates]).toEqual(["2026-12-12"]);
  });

  it("a listed holiday is skipped, and half days count as half, across a weekend too", async () => {
    // Mon 21 to Sat 26 for the Monday-to-Saturday person; the 23rd (this test's) and the 25th (seeded) are holidays: 21 (afternoon only), 22, 24, 26 = 3.5
    const ctx = await resolveDayCountContext(e.monSat!, d("2026-12-21"), d("2026-12-26"));
    expect([...ctx.holidayDates].sort()).toEqual(["2026-12-23", "2026-12-25"]);
    expect([...ctx.weekOffDates]).toEqual([]);
    expect((await apply("monSat", "2026-12-21", "2026-12-26", { from: "SECOND_HALF" })).body.totalDays).toBe(3.5);
    expect((await apply("monSat", "2026-12-18", "2026-12-19", { to: "FIRST_HALF" })).body.totalDays).toBe(1.5); // Fri 18 full + Sat 19 morning
  });

  it("the attendance side shows a working Saturday inside the leave as leave, not absent", async () => {
    const req = await prisma.leaveRequest.findFirstOrThrow({ where: { employeeId: e.monSat!, fromDate: d("2026-12-05") } });
    await prisma.leaveRequest.update({ where: { id: req.id }, data: { status: "APPROVED", decidedAt: new Date(), decidedByUserId: (await prisma.user.findFirstOrThrow({ where: { employeeId: e.monSat! } })).id } });
    setBusinessTodayForTests(d("2026-12-10")); // the engine computes only days that have happened
    await computeAttendance([e.monSat!], "2026-12-04", "2026-12-06");
    setBusinessTodayForTests(d("2026-11-20"));
    const rows = await prisma.dailyAttendance.findMany({ where: { employeeId: e.monSat!, date: { gte: d("2026-12-04"), lte: d("2026-12-06") } }, orderBy: { date: "asc" } });
    const by = new Map(rows.map((r) => [r.date.toISOString().slice(0, 10), r]));
    expect(by.get("2026-12-05")?.status).toBe("PL"); // on leave, not absent
    expect(by.get("2026-12-06")?.status).toBe("O"); // Sunday: the week-off
  });
});
