import ExcelJS from "exceljs";
import request from "supertest";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../../lib/prisma";
import { EncashmentRateNotConfiguredError, getEncashmentRateProvider, setEncashmentRateProvider } from "../../leave/encashmentRate";
import { writeLedgerEntry } from "../../leave/ledger";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupFullTestEmployee,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  loginAs,
  type TestOrgMasters,
} from "../../employee/__tests__/employeeTestHelpers";

// Core reports (Phase 5 commit F, docs/plans/PHASE_5.md §F) — the numbers
// on a fixture of our own, isolated from seed data by filtering on this
// file's department. Manager scope per report lives in managerReach.test.ts.
type Person = { employeeId: string; employeeCode: string; userId: string };
const D = (s: string) => new Date(`${s}T00:00:00Z`);

describe("Core reports (F)", () => {
  let org: TestOrgMasters;
  let other: TestOrgMasters;
  const p = {} as Record<"director" | "hrAdmin" | "hrExec" | "plain" | "a" | "b" | "c" | "d" | "e" | "f", Person>;
  const tok = {} as Record<"director" | "hrAdmin" | "hrExec" | "plain", string>;
  const created = { separations: [] as string[], requests: [] as string[], ledger: [] as string[] };
  let pl: { id: string };

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    other = await createEmployeeTestOrgMasters();
    p.director = await createFullTestEmployee(other, { roleCode: "SUPER_ADMIN" });
    p.hrAdmin = await createFullTestEmployee(other, { roleCode: "HR_ADMIN" });
    p.hrExec = await createFullTestEmployee(other, { roleCode: "HR_EXECUTIVE" });
    p.plain = await createFullTestEmployee(other, { roleCode: "EMPLOYEE" });
    for (const k of ["a", "b", "c", "d", "e", "f"] as const) p[k] = await createFullTestEmployee(org);
    for (const k of ["director", "hrAdmin", "hrExec", "plain"] as const) tok[k] = await loginAs(p[k].employeeCode);

    // a: joined 2024-01-01, born on 29 Feb.
    await prisma.employeePersonal.update({ where: { employeeId: p.a.employeeId }, data: { dateOfBirth: D("2000-02-29") } });
    // b: joined 2025-06-10.
    await prisma.employee.update({ where: { id: p.b.employeeId }, data: { dateOfJoining: D("2025-06-10") } });
    await prisma.employeeJobHistory.updateMany({ where: { employeeId: p.b.employeeId }, data: { effectiveFrom: D("2025-06-10") } });
    // c: left — last working day 2025-03-31.
    await prisma.employee.update({ where: { id: p.c.employeeId }, data: { status: "SEPARATED", lastWorkingDate: D("2025-03-31") } });
    created.separations.push((await prisma.separation.create({ data: { employeeId: p.c.employeeId, lastWorkingDate: D("2025-03-31"), reason: "Better opportunity", status: "COMPLETED", completedAt: D("2025-03-31"), initiatedByUserId: p.hrAdmin.userId } })).id);
    // e: imported leaver — separated with a last working day, no Separation row.
    await prisma.employee.update({ where: { id: p.e.employeeId }, data: { status: "SEPARATED", lastWorkingDate: D("2025-06-30"), exitReason: "Moved city" } });
    // f: separated with no last working day recorded — can't be placed in time, never counted.
    await prisma.employee.update({ where: { id: p.f.employeeId }, data: { status: "SEPARATED" } });
    // d: moved to the other department on 2025-01-01 (effective-dated).
    const dJob = await prisma.employeeJobHistory.findFirstOrThrow({ where: { employeeId: p.d.employeeId } });
    await prisma.employeeJobHistory.update({ where: { id: dJob.id }, data: { effectiveTo: D("2025-01-01") } });
    await prisma.employeeJobHistory.create({ data: { employeeId: p.d.employeeId, departmentId: other.departmentId, designationId: other.designationId, locationId: other.locationId, effectiveFrom: D("2025-01-01"), createdByUserId: p.hrAdmin.userId } });

    // a's PL: +5 on 2025-01-01, −2 on 2025-02-01.
    pl = await prisma.leaveType.findFirstOrThrow({ where: { code: "PL" } });
    for (const [date, days] of [["2025-01-01", 5], ["2025-02-01", -2]] as const) {
      created.ledger.push((await writeLedgerEntry(prisma, { employeeId: p.a.employeeId, leaveTypeId: pl.id, leaveYear: 2025, entryDate: D(date), entryType: days > 0 ? "GRANT" : "CONSUMED", days, createdByUserId: p.hrAdmin.userId })).id);
    }
    // b: approved LOP Wed 30 Jul → Mon 4 Aug 2025 (first half on the 4th).
    const lop = await prisma.leaveType.findFirstOrThrow({ where: { code: "LOP" } });
    created.requests.push(
      (await prisma.leaveRequest.create({ data: { employeeId: p.b.employeeId, leaveTypeId: lop.id, fromDate: D("2025-07-30"), toDate: D("2025-08-04"), toDayPart: "FIRST_HALF", totalDays: 3.5, status: "APPROVED", appliedByUserId: p.b.userId } })).id,
    );
  });

  afterAll(async () => {
    await prisma.leaveRequest.deleteMany({ where: { id: { in: created.requests } } });
    await prisma.separation.deleteMany({ where: { id: { in: created.separations } } });
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
    await cleanupEmployeeTestOrgMasters(other);
  });

  const get = (t: string, path: string) => request(app).get(path).set(...authHeader(t));
  const run = async (key: string, qs: string, t = tok.hrAdmin) => {
    const res = await get(t, `/api/reports/${key}?departmentId=${org.departmentId}${qs}`);
    if (res.status !== 200) throw new Error(`${key}: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body as { rows: Array<Record<string, unknown>>; summary: Array<{ label: string; value: unknown }>; warnings: string[]; rateProvisional?: boolean; scope: string; notes: string[] };
  };
  const codes = (body: { rows: Array<Record<string, unknown>> }) => body.rows.map((r) => r.employeeCode).sort();
  const sorted = (...people: Person[]) => people.map((x) => x.employeeCode).sort();
  const summary = (body: { summary: Array<{ label: string; value: unknown }> }, label: string) => body.summary.find((s) => s.label === label)?.value;

  it("needs reports.view: a plain employee is refused", async () => {
    expect((await get(tok.plain, "/api/reports")).status).toBe(403);
    expect((await get(tok.plain, "/api/reports/headcount")).status).toBe(403);
  });

  it("headcount on a date: who was employed, with the department they held that day", async () => {
    expect(codes(await run("headcount", "&asOf=2024-06-01"))).toEqual(sorted(p.a, p.c, p.d, p.e));
    expect(codes(await run("headcount", "&asOf=2025-03-31"))).toEqual(sorted(p.a, p.c, p.e)); // c's last day counts; d had moved
    expect(codes(await run("headcount", "&asOf=2025-04-01"))).toEqual(sorted(p.a, p.e));
    const company = await run("headcount", "&asOf=2025-07-01");
    expect(company.scope).toBe("company");
    expect(summary(company, "Headcount on 2025-07-01")).toBe(2); // a, b
  });

  it("joiners in a range", async () => {
    expect(codes(await run("joiners", "&from=2025-06-01&to=2025-06-30"))).toEqual(sorted(p.b));
    expect(codes(await run("joiners", "&from=2025-07-01&to=2025-07-31"))).toEqual([]);
    expect((await get(tok.hrAdmin, "/api/reports/joiners?from=2025-07-01&to=2025-06-01")).status).toBe(400);
  });

  it("leavers and attrition: leavers ÷ average of opening and closing headcount", async () => {
    const r = await run("leavers", "&from=2025-01-01&to=2025-12-31");
    expect(codes(r)).toEqual(sorted(p.c, p.e)); // e was imported: no Separation row, still a leaver
    expect(r.rows.find((x) => x.employeeCode === p.c.employeeCode)).toMatchObject({ lastWorkingDate: "2025-03-31", tenureYears: 1.2, reason: "Better opportunity" });
    expect(r.rows.find((x) => x.employeeCode === p.e.employeeCode)).toMatchObject({ lastWorkingDate: "2025-06-30", reason: "Moved city" }); // the imported reason
    expect(summary(r, "Headcount on 2025-01-01")).toBe(3); // a, c, e (d moved that day; f never counts)
    expect(summary(r, "Headcount on 2025-12-31")).toBe(2); // a, b
    expect(summary(r, "Attrition")).toBe(0.8); // 2 ÷ 2.5
  });

  it("birthdays: 29 Feb falls on 28 Feb in other years, day and month only; anniversaries from 1 year", async () => {
    const bdays = await run("celebrations", "&from=2027-02-25&to=2027-03-02&kind=birthday");
    expect(bdays.rows).toEqual([expect.objectContaining({ date: "2027-02-28", kind: "Birthday", employeeCode: p.a.employeeCode, detail: "28 February" })]);
    expect(JSON.stringify(bdays.rows)).not.toContain("2000");
    const leap = await run("celebrations", "&from=2028-02-25&to=2028-03-02&kind=birthday");
    expect(leap.rows[0]).toMatchObject({ date: "2028-02-29" });
    expect(codes(await run("celebrations", "&from=2026-06-01&to=2026-06-30&kind=anniversary"))).toEqual(sorted(p.b));
    expect(codes(await run("celebrations", "&from=2025-06-01&to=2025-06-30&kind=anniversary"))).toEqual([]); // not a year yet
    expect((await get(tok.hrAdmin, "/api/reports/celebrations?from=2025-01-01&to=2026-06-01")).status).toBe(400);
  });

  it("leave balance on a date — the ledger sum, as the Balances screen computes it", async () => {
    const at = (asOf: string) => run("leave-balance", `&asOf=${asOf}&leaveTypeId=${pl.id}`);
    expect((await at("2025-01-15")).rows.find((r) => r.employeeCode === p.a.employeeCode)?.lt_PL).toBe(5);
    expect((await at("2025-03-01")).rows.find((r) => r.employeeCode === p.a.employeeCode)?.lt_PL).toBe(3);
  });

  describe("leave liability", () => {
    it("balance × the encashment rate, flagged provisional; a director sees it, neither HR role does (Stage 1: it is in rupees)", async () => {
      const original = getEncashmentRateProvider();
      setEncashmentRateProvider({ getDailyRate: async () => ({ amount: new Prisma.Decimal(1000), source: "MANUAL_SETTING", isFinal: false }) });
      try {
        const r = await run("leave-liability", "&asOf=2025-03-01", tok.director);
        expect(r.rows.find((x) => x.employeeCode === p.a.employeeCode)).toMatchObject({ leaveType: "PL", balance: 3, dailyRate: 1000, liability: 3000 });
        expect(r.rateProvisional).toBe(true);
        expect((await get(tok.hrExec, "/api/reports/leave-liability")).status).toBe(403);
        expect((await get(tok.hrExec, "/api/reports")).body.reports.map((x: { key: string }) => x.key)).not.toContain("leave-liability");
        expect((await get(tok.hrAdmin, "/api/reports/leave-liability")).status).toBe(403);
        expect((await get(tok.hrAdmin, "/api/reports")).body.reports.map((x: { key: string }) => x.key)).not.toContain("leave-liability");
        expect((await get(tok.director, "/api/reports")).body.reports.map((x: { key: string }) => x.key)).toContain("leave-liability");
      } finally {
        setEncashmentRateProvider(original);
      }
    });

    it("with no rate configured: days only, and a warning", async () => {
      const original = getEncashmentRateProvider();
      setEncashmentRateProvider({
        getDailyRate: async () => {
          throw new EncashmentRateNotConfiguredError();
        },
      });
      try {
        const r = await run("leave-liability", "&asOf=2025-03-01", tok.director);
        expect(r.rows.find((x) => x.employeeCode === p.a.employeeCode)).toMatchObject({ balance: 3, dailyRate: null, liability: null });
        expect(summary(r, "Total liability")).toBeNull();
        expect(r.warnings.join(" ")).toMatch(/No encashment daily rate is configured/);
      } finally {
        setEncashmentRateProvider(original);
      }
    });
  });

  it("LOP: only the days inside the range, holidays and week-offs out, half-days as half", async () => {
    const august = await run("lop", "&from=2025-08-01&to=2025-08-31");
    expect(august.rows).toEqual([expect.objectContaining({ employeeCode: p.b.employeeCode, lopDays: 1.5, requests: 1 })]); // Fri 1 + Mon 4 (first half)
    const july = await run("lop", "&from=2025-07-01&to=2025-07-31");
    expect(july.rows[0]).toMatchObject({ lopDays: 2 }); // Wed 30, Thu 31
    expect(august.notes.join(" ")).toMatch(/Phase 3/);
    const existing = await prisma.holiday.findUnique({ where: { date: D("2025-08-01") } });
    const holiday = existing ?? (await prisma.holiday.create({ data: { date: D("2025-08-01"), name: "Test holiday" } }));
    try {
      expect((await run("lop", "&from=2025-08-01&to=2025-08-31")).rows[0]).toMatchObject({ lopDays: 0.5 });
    } finally {
      if (!existing) await prisma.holiday.delete({ where: { id: holiday.id } });
    }
  });

  it("export: the same rows through the shared helper, plus summary and breakdown sheets; audited", async () => {
    const res = await get(tok.hrAdmin, `/api/reports/leavers/export?departmentId=${org.departmentId}&from=2025-01-01&to=2025-12-31`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/leavers-\d{4}-\d{2}-\d{2}\.xlsx/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as unknown as ExcelJS.Buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Leavers & attrition", "Summary", "By month", "By reason", "By department"]);
    const sheet = wb.worksheets[0]!;
    expect(sheet.getRow(1).getCell(1).value).toBe("Employee Code");
    expect([sheet.getRow(2).getCell(1).value, sheet.getRow(3).getCell(1).value]).toEqual([p.c.employeeCode, p.e.employeeCode]);
    expect(sheet.getColumn(7).numFmt).toBe("dd-mmm-yyyy"); // Last Working Day is a real date
    const summarySheet = wb.getWorksheet("Summary")!;
    expect(summarySheet.getColumn(2).values).toContain("80.0%");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "report.exported", actorUserId: p.hrAdmin.userId, entityId: "leavers" } });
    expect(audit.after).toMatchObject({ report: "leavers", scope: "company", rowCount: 2 });
  });
});
