import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setBusinessTodayForTests } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { writeLedgerEntry } from "../ledger";
import { computeTotalLeaveDays, type DayPart } from "../dayCount";
import { leaveDaysFor, sandwichTotal } from "../policyLimits";
import { resetPolicy, setPolicy } from "../../policySettings/__tests__/policyTestHelpers";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const SAT_SUN = [0, 6];

describe("sandwich rule, the count itself", () => {
  it("counts week-offs and holidays between two leave days of the request, never before the first or after the last", () => {
    expect(sandwichTotal(d("2026-12-04"), d("2026-12-07"), "FULL", "FULL", new Set(), SAT_SUN).toString()).toBe("4");
    expect(sandwichTotal(d("2026-12-05"), d("2026-12-07"), "FULL", "FULL", new Set(), SAT_SUN).toString()).toBe("1");
    expect(sandwichTotal(d("2026-12-04"), d("2026-12-06"), "FULL", "FULL", new Set(), SAT_SUN).toString()).toBe("1");
    expect(sandwichTotal(d("2026-12-24"), d("2026-12-28"), "FULL", "SECOND_HALF", new Set(["2026-12-25"]), SAT_SUN).toString()).toBe("4.5");
    expect(sandwichTotal(d("2026-12-05"), d("2026-12-06"), "FULL", "FULL", new Set(), SAT_SUN).toString()).toBe("0");
  });

  it("GOLDEN: while the rule is off, the days are byte-for-byte the plain count for every range and day part", async () => {
    const parts: DayPart[] = ["FULL", "FIRST_HALF", "SECOND_HALF"];
    const holidays = new Set(["2026-12-25", "2027-01-01"]);
    let checked = 0;
    for (let start = 0; start < 14; start += 1) {
      for (let len = 0; len < 12; len += 1) {
        const from = new Date(Date.UTC(2026, 11, 20 + start));
        const to = new Date(Date.UTC(2026, 11, 20 + start + len));
        for (const fp of parts) for (const tp of parts) {
          const plain = computeTotalLeaveDays(from, to, fp, tp, holidays, SAT_SUN).toString();
          expect((await leaveDaysFor("PL", from, to, fp, tp, holidays, SAT_SUN)).toString()).toBe(plain);
          checked += 1;
        }
      }
    }
    expect(checked).toBe(14 * 12 * 9);
  });
});

// LV-19 / LV-20 (M session block 2) end to end: off by default; on only after two directors.
describe("leave request limits and the sandwich rule", () => {
  let org: TestOrgMasters;
  const ids: string[] = [];
  const t: Record<string, string> = {};
  const e: Record<string, string> = {};
  let plId = "";
  const apply = (who: string, fromDate: string, toDate: string, employeeId?: string) => request(app).post("/api/leave/requests").set(...authHeader(t[who]!)).send({ leaveTypeId: plId, fromDate, toDate, fromDayPart: "FULL", toDayPart: "FULL", ...(employeeId ? { employeeId } : {}) });

  beforeAll(async () => {
    setBusinessTodayForTests(d("2026-12-01"));
    org = await createEmployeeTestOrgMasters();
    for (const [k, roleCode] of [["d1", "SUPER_ADMIN"], ["d2", "SUPER_ADMIN"], ["emp", undefined], ["hr", "HR_ADMIN"]] as const) {
      const x = await createFullTestEmployee(org, roleCode ? { roleCode } : {});
      ids.push(x.employeeId);
      e[k] = x.employeeId;
      t[k] = await loginAs(x.employeeCode);
    }
    plId = (await prisma.leaveType.findUniqueOrThrow({ where: { code: "PL" } })).id;
    await writeLedgerEntry(prisma, { employeeId: e.emp!, leaveTypeId: plId, leaveYear: 2026, entryDate: d("2026-01-01"), entryType: "ACCRUAL", days: 30 });
  });
  afterAll(async () => {
    await resetPolicy("policy.sandwich", t.d1!, t.d2!);
    await resetPolicy("policy.leaveLimits", t.d1!, t.d2!);
    setBusinessTodayForTests(null);
    await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: ids } } });
    for (const id of ids) await cleanupFullTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("off (the default): Friday to Monday is 2 days, a long request and short notice are accepted", async () => {
    expect((await apply("emp", "2026-12-04", "2026-12-07")).body.totalDays).toBe(2);
    expect((await apply("emp", "2026-12-02", "2026-12-02")).status).toBe(201);
  });

  it("the sandwich rule on for PL: Friday to Monday is 4 days", async () => {
    await setPolicy("policy.sandwich", { active: true, leaveTypes: ["PL"] }, t.d1!, t.d2!);
    expect((await apply("emp", "2026-12-11", "2026-12-14")).body.totalDays).toBe(4);
    expect((await apply("emp", "2026-12-19", "2026-12-21")).body.totalDays).toBe(1); // Saturday start: not between two leave days
  });

  it("limits on for PL (3 days, 7 days' notice): too long and too soon are refused; HR applying on someone's behalf is not held to notice", async () => {
    await setPolicy("policy.leaveLimits", { active: true, rules: ["PL | 3 | 7"] }, t.d1!, t.d2!);
    expect((await apply("emp", "2027-01-11", "2027-01-15")).body.error.code).toBe("LEAVE_LIMIT_DAYS");
    expect((await apply("emp", "2026-12-03", "2026-12-03")).body.error.code).toBe("LEAVE_LIMIT_NOTICE");
    expect((await apply("emp", "2026-12-08", "2026-12-08")).status).toBe(201);
    expect((await apply("hr", "2026-12-03", "2026-12-03", e.emp)).status).toBe(201);
  });
});
