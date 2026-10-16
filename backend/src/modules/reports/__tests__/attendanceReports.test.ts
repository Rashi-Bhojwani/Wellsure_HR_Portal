import ExcelJS from "exceljs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteWithDependents, purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { prisma } from "../../../lib/prisma";
import { setSetting } from "../../../lib/settings";
import { EXCESS_HOURS_SETTING_KEY } from "../../../lib/excessHoursSettings";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";

// The four attendance reports (Phase 3 commit 4): late coming, excess hours, exception summary, attendance summary. Days are
// inserted directly (the point is what the reports make of them); the engine's own figures are covered by the engine tests.
// September 2025 is a period only this file's people count in once filtered to their department. Manager scope per report is in
// managerReach.test.ts.
type Person = { employeeId: string; employeeCode: string; userId: string };
const D = (s: string) => new Date(`${s}T00:00:00Z`);
const Q = "from=2025-09-01&to=2025-09-30";
const ist = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);

describe("Attendance reports (Phase 3 commit 4)", () => {
  let org: TestOrgMasters;
  let other: TestOrgMasters;
  const p = {} as Record<"hr" | "sup" | "plain" | "a" | "b" | "c", Person>;
  const tok = {} as Record<"hr" | "sup" | "plain", string>;
  let shiftId = "";
  let placeholderShiftId = "";
  let deviceId = "";
  let batchId = "";

  const day = (who: Person, date: string, over: Record<string, unknown> = {}) =>
    prisma.dailyAttendance.create({ data: { employeeId: who.employeeId, date: D(date), status: "P", source: "DEVICE", capture: "DEVICE", engineVersion: 1, exceptionFlags: [], shiftId, shiftCode: "T9", shiftStart: "10:00", shiftEnd: "19:00", ...over } as never });

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    other = await createEmployeeTestOrgMasters();
    p.hr = await createFullTestEmployee(other, { roleCode: "HR_ADMIN" });
    p.sup = await createFullTestEmployee(other, { roleCode: "SUPER_ADMIN" });
    p.plain = await createFullTestEmployee(other, { roleCode: "EMPLOYEE" });
    for (const k of ["a", "b"] as const) p[k] = await createFullTestEmployee(org);
    p.c = await createFullTestEmployee(other); // a different department and branch
    tok.hr = await loginAs(p.hr.employeeCode);
    tok.sup = await loginAs(p.sup.employeeCode);
    tok.plain = await loginAs(p.plain.employeeCode);
    shiftId = (await prisma.shift.create({ data: { code: `RP${Date.now().toString(36).slice(-5)}`, name: "Report shift", startTime: "10:00", endTime: "19:00", sessions: { create: [{ sortOrder: 1, kind: "WORK", label: "Day", startTime: "10:00", endTime: "19:00" }] } } })).id;
    placeholderShiftId = (await prisma.shift.create({ data: { code: `RQ${Date.now().toString(36).slice(-5)}`, name: "Unconfirmed shift", startTime: "10:00", endTime: "19:00", placeholderFields: ["graceInMinutes"], sessions: { create: [{ sortOrder: 1, kind: "WORK", label: "Day", startTime: "10:00", endTime: "19:00" }] } } })).id;

    // a: late on the 1st (device), late on the 2nd (correction approved), late on the 3rd (set by HR) with a shift set by HR,
    // late on the 4th (marked by hand in the muster); excess on the 5th (90 min), the 8th (30 min) and a provisional 9th (120 min).
    await day(p.a, "2025-09-01", { lateInMinutes: 12, firstIn: ist("2025-09-01", "10:12"), exceptionFlags: ["LATE_IN"] });
    await day(p.a, "2025-09-02", { lateInMinutes: 20, firstIn: ist("2025-09-02", "10:20"), overrideKind: "REGULARIZATION", exceptionFlags: ["LATE_IN"] });
    await day(p.a, "2025-09-03", { lateInMinutes: 5, firstIn: ist("2025-09-03", "10:05"), overrideKind: "MANUAL_OVERRIDE", shiftOverrideRef: "so1" });
    await day(p.a, "2025-09-04", { lateInMinutes: 30, firstIn: ist("2025-09-04", "10:30"), capture: "MANUAL", source: "MANUAL" });
    await day(p.a, "2025-09-05", { excessMinutes: 90, lastOut: ist("2025-09-05", "20:30") });
    await day(p.a, "2025-09-08", { excessMinutes: 30, lastOut: ist("2025-09-08", "19:30") });
    await day(p.a, "2025-09-09", { excessMinutes: 120, lastOut: ist("2025-09-09", "21:00"), provisional: true });
    // exceptions and muster statuses for a
    await day(p.a, "2025-09-10", { status: "A", lopDays: "0.5", exceptionFlags: ["MISSING_PUNCH"] });
    await day(p.a, "2025-09-11", { status: "HD", lopDays: "0.5", exceptionFlags: ["SHORTFALL", "CLOCK_FLAGGED"] });
    await day(p.a, "2025-09-12", { status: "PL", source: "LEAVE" });
    await day(p.a, "2025-09-13", { status: "O", source: "WEEK_OFF" });
    await day(p.a, "2025-09-14", { status: "H", source: "HOLIDAY" });
    await day(p.a, "2025-09-15", { status: "PL:P", firstHalfStatus: "PL", secondHalfStatus: "P", source: "LEAVE" });
    // b: one late day on a shift whose values HR has not confirmed, and a no-shift day
    await day(p.b, "2025-09-01", { lateInMinutes: 8, firstIn: ist("2025-09-01", "10:08"), shiftId: placeholderShiftId, exceptionFlags: ["LATE_IN"] });
    await day(p.b, "2025-09-03", { lateInMinutes: 0, firstIn: ist("2025-09-03", "09:58") }); // on time: a zero is not late
    await day(p.b, "2025-09-02", { status: "NS", shiftId: null, shiftCode: null, shiftStart: null, shiftEnd: null, exceptionFlags: ["NO_SHIFT"] });
    // c: elsewhere (other department)
    await day(p.c, "2025-09-01", { lateInMinutes: 40, firstIn: ist("2025-09-01", "10:40"), exceptionFlags: ["LATE_IN"] });
    // an unmapped device ID in the range (company-wide only)
    deviceId = (await prisma.device.create({ data: { serialNumber: `RPT-${Date.now().toString(36)}`, name: "Reports test device", locationId: org.locationId } })).id;
    batchId = (await prisma.ingestionBatch.create({ data: { route: "IMPORT", deviceId } })).id;
    await prisma.rawPunch.create({ data: { deviceId, deviceUserId: "55555", punchedAt: ist("2025-09-03", "10:00"), localTime: "2025-09-03 10:00:00", businessDate: D("2025-09-03"), status: "1", verifyMode: "255", workcode: "1", reserved: "0", rawLine: "test", route: "IMPORT", batchId, employeeId: null } });
  });

  afterAll(async () => {
    await setSetting(EXCESS_HOURS_SETTING_KEY, { minMinutes: 0 }, p.sup.userId);
    await purgeAppendOnly("AuditLog", { actorUserId: { in: [p.hr.userId, p.sup.userId] }, action: { in: ["report.exported", "settings.updated"] } });
    await deleteWithDependents("RawPunch", (await prisma.rawPunch.findMany({ where: { deviceId }, select: { id: true } })).map((r) => r.id));
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await deleteWithDependents("IngestionBatch", [batchId]);
    await deleteWithDependents("Device", [deviceId]);
    await deleteWithDependents("Shift", [shiftId, placeholderShiftId]);
    await cleanupEmployeeTestOrgMasters(org);
    await cleanupEmployeeTestOrgMasters(other);
  });

  const get = (t: string, path: string) => request(app).get(path).set(...authHeader(t));
  type Body = { rows: Array<Record<string, unknown>>; summary: Array<{ label: string; value: unknown }>; warnings: string[]; notes: string[]; scope: string; columns: Array<{ key: string; header: string }> };
  const run = async (key: string, qs = "", dept = org.departmentId) => {
    const res = await get(tok.hr, `/api/reports/${key}?departmentId=${dept}&${Q}${qs}`);
    if (res.status !== 200) throw new Error(`${key}: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body as Body;
  };
  const summary = (b: Body, label: string) => b.summary.find((s) => s.label === label)?.value;

  it("the catalog lists them, and an employee is refused", async () => {
    const res = await get(tok.hr, "/api/reports");
    expect(res.body.reports.map((r: { key: string }) => r.key)).toEqual(expect.arrayContaining(["late-coming", "excess-hours", "exception-summary", "attendance-muster"]));
    for (const k of ["late-coming", "excess-hours", "exception-summary", "attendance-muster"]) expect((await get(tok.plain, `/api/reports/${k}?${Q}`)).status).toBe(403);
  });

  it("late coming: each late day, with how the day was set (device, correction, HR, shift by HR, muster)", async () => {
    const r = await run("late-coming");
    expect(r.scope).toBe("company");
    const byKey = (rows: unknown[][]) => [...rows].sort((x, y) => `${x[0]}|${x[1]}`.localeCompare(`${y[0]}|${y[1]}`)); // listed by employee code, which is random here
    expect(byKey(r.rows.map((x) => [x.employeeCode, x.date, x.lateBy, x.origin]))).toEqual(byKey([
      [p.a.employeeCode, "2025-09-01", 12, "Device"],
      [p.a.employeeCode, "2025-09-02", 20, "Correction approved (~)"],
      [p.a.employeeCode, "2025-09-03", 5, "Set by HR (#), shift set by HR (^)"],
      [p.a.employeeCode, "2025-09-04", 30, "Marked by hand (muster)"],
      [p.b.employeeCode, "2025-09-01", 8, "Device"],
    ]));
    expect(r.rows.find((x) => x.employeeCode === p.a.employeeCode && x.date === "2025-09-01")).toMatchObject({ firstIn: "10:12", shift: "T9", shiftStart: "10:00", status: "P" });
    expect(summary(r, "Late days")).toBe(5);
    expect(summary(r, "People")).toBe(2);
    expect(summary(r, "Total late (min)")).toBe(75);
    expect(summary(r, "Average late (min)")).toBe(15);
    expect(summary(r, "Days set by hand")).toBe(3);
    expect(r.columns.map((c) => c.header)).toContain("How The Day Was Set");
  });

  it("filters apply per day: another department's late day appears only for that department; a range over 93 days is refused", async () => {
    const elsewhere = await run("late-coming", "", other.departmentId);
    expect(elsewhere.rows.map((x) => x.employeeCode)).toEqual([p.c.employeeCode]);
    const wide = await get(tok.hr, `/api/reports/late-coming?from=2025-01-01&to=2025-12-31`);
    expect(wide.status).toBe(400);
    expect(wide.body.error.code).toBe("TOO_WIDE");
  });

  it("every report warns when a figure rests on rule values HR has not confirmed", async () => {
    const r = await run("late-coming");
    expect(r.warnings.join(" ")).toContain("HR has not confirmed");
    expect(r.warnings.join(" ")).toContain("shift RQ");
    const clean = await run("late-coming", "&employmentType=CONTRACT"); // no one of that type: no days, no warning
    expect(clean.rows).toEqual([]);
    expect(clean.warnings).toEqual([]);
  });

  it("excess hours: not overtime, says so, honours the smallest-excess setting, leaves out days still open", async () => {
    const r = await run("excess-hours");
    expect(r.rows.map((x) => [x.date, x.excessMinutes, x.excess, x.lastOut])).toEqual([
      ["2025-09-05", 90, "1:30", "20:30"],
      ["2025-09-08", 30, "0:30", "19:30"],
    ]); // the provisional 9th is not listed
    expect(summary(r, "Excess hours")).toBe(2);
    expect(summary(r, "Smallest excess listed (min)")).toBe(1);
    expect(r.warnings.join(" ")).toContain("Overtime is not defined yet");
    // The smallest excess listed is a company setting (System Settings → Attendance → Excess hours), edited by an admin.
    const set = await request(app).put("/api/settings/excess-hours").set(...authHeader(tok.sup)).send({ minMinutes: 45 });
    expect(set.status).toBe(200);
    try {
      const filtered = await run("excess-hours");
      expect(filtered.rows.map((x) => x.date)).toEqual(["2025-09-05"]);
      expect(summary(filtered, "Smallest excess listed (min)")).toBe(45);
      expect((await request(app).put("/api/settings/excess-hours").set(...authHeader(tok.plain)).send({ minMinutes: 5 })).status).toBe(403);
    } finally {
      await request(app).put("/api/settings/excess-hours").set(...authHeader(tok.sup)).send({ minMinutes: 0 });
    }
    expect(await prisma.auditLog.count({ where: { action: "settings.updated", entityId: "excessHours", actorUserId: p.sup.userId } })).toBe(2);
  });

  it("exception summary: per person counts by reason, a day with two reasons under both, the unmapped IDs (company-wide only)", async () => {
    const r = await run("exception-summary");
    const a = r.rows.find((x) => x.employeeCode === p.a.employeeCode)!;
    const b = r.rows.find((x) => x.employeeCode === p.b.employeeCode)!;
    expect(a).toMatchObject({ MISSING_PUNCH: 1, SHORTFALL: 1, CLOCK_FLAGGED: 1, total: 2, byHand: 0 });
    expect(b).toMatchObject({ NO_SHIFT: 1, total: 1 });
    expect(summary(r, "Days with an exception")).toBe(3);
    expect(summary(r, "Short of the full day")).toBe(1);
    expect(summary(r, "Unmapped device IDs")).toBeUndefined(); // a department filter: unmapped IDs have no department
    const company = (await get(tok.hr, `/api/reports/exception-summary?${Q}&locationId=${org.locationId}`)).body as Body;
    expect(summary(company, "Unmapped device IDs")).toBe(1); // the one ID punched at this branch's device
    expect(summary(company, "Days with an exception")).toBe(3);
  });

  it("attendance summary: days by what the computed day says (halves count half), LOP, late days, excess hours, and how many days were not the device's", async () => {
    const r = await run("attendance-muster");
    const a = r.rows.find((x) => x.employeeCode === p.a.employeeCode)!;
    // P: 1,2,3,4,5,8,9 (7 days) + half of the 15th = 7.5; HD on the 11th adds 0.5; absent: the 10th + half of the 11th = 1.5
    expect(a).toMatchObject({ present: 8, absent: 1.5, leave: 1.5, holiday: 1, weekOff: 1, notMarked: 0, noShift: 0, lop: 1, lateDays: 4, request: 1, hr: 1, hand: 1, shift: 1 });
    expect(a.excessHours).toBe(2); // 90 + 30, the open day left out
    expect(r.rows.find((x) => x.employeeCode === p.b.employeeCode)).toMatchObject({ present: 2, noShift: 1 });
    expect(summary(r, "People")).toBe(2);
    expect(summary(r, "Days not from the device")).toBe(3);
  });

  it("export: the same rows, the marker column, and the warnings in the file's footer; audited", async () => {
    const res = await get(tok.hr, `/api/reports/excess-hours/export?departmentId=${org.departmentId}&${Q}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as unknown as ExcelJS.Buffer);
    const sheet = wb.worksheets[0]!;
    const headers = (sheet.getRow(1).values as unknown[]).slice(1);
    expect(headers).toContain("How The Day Was Set");
    const text: string[] = [];
    sheet.eachRow((row) => row.eachCell((c) => typeof c.value === "string" && text.push(c.value)));
    expect(text.join(" ")).toContain("Overtime is not defined yet");
    expect(text.join(" ")).toContain("Correction approved (~)");
    expect(await prisma.auditLog.count({ where: { action: "report.exported", actorUserId: p.hr.userId, entityId: "excess-hours" } })).toBe(1);
  });
});
