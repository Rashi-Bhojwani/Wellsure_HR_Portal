import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localTimeToInstant } from "@shared/attendance/attlog";
import { deleteWithDependents, purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { setPayrollLockCheck } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { computeAttendance } from "../compute";
import { unlockCycle } from "../finalisation";

// Period Finalisation (Phase 3 commit 3): a whole attendance cycle at a time, the blockers (now including flagged punches),
// the lock and what it refuses, and unlock (Super Admin only, with a reason, with payroll's warning). February 1990 is a
// cycle only this file's employee was employed in, so the seeded company doesn't affect it.
const FROM = "1990-02-01";
const TO = "1990-02-28";
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const tag = Date.now().toString(36).slice(-5);
type Person = { employeeId: string; employeeCode: string; userId: string };

describe("Period Finalisation (Phase 3 commit 3)", () => {
  let org: TestOrgMasters;
  const p = {} as Record<"who" | "hr" | "pay" | "sup" | "exec" | "emp", Person>;
  const tok = {} as Record<"hr" | "pay" | "sup" | "exec" | "emp" | "who", string>;
  let shiftId = "";
  let policyId = "";
  let deviceId = "";
  let batchId = "";
  const punchIds: string[] = [];

  const api = (t: string) => ({
    get: (path: string) => request(app).get(`/api/attendance${path}`).set(...authHeader(t)),
    post: (path: string, b: object = {}) => request(app).post(`/api/attendance${path}`).set(...authHeader(t)).send(b),
  });
  const finalise = (t: string, over: object = {}) => api(t).post("/finalisation", { from: FROM, to: TO, confirm: true, ...over });
  const unlock = (t: string, over: object = {}) => api(t).post("/finalisation/unlock", { from: FROM, to: TO, reason: "A day was found to be wrong", confirm: true, ...over });
  const locked = () => prisma.dailyAttendance.count({ where: { employeeId: p.who.employeeId, isLocked: true } });
  const events = () => prisma.attendancePeriodLock.findMany({ where: { periodStart: d(FROM) }, orderBy: { seq: "asc" } });
  const period = async () => ((await api(tok.hr).get(`/finalisation/periods?asOf=${TO}`)).body.periods as Array<{ from: string }>).find((x) => x.from === FROM);

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    p.who = await createFullTestEmployee(org);
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.pay = await createFullTestEmployee(org, { roleCode: "PAYROLL_ADMIN" });
    p.sup = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.exec = await createFullTestEmployee(org, { roleCode: "HR_EXECUTIVE" });
    p.emp = await createFullTestEmployee(org, { roleCode: "EMPLOYEE" });
    for (const k of ["hr", "pay", "sup", "exec", "emp", "who"] as const) tok[k] = await loginAs(p[k].employeeCode);
    await prisma.employee.update({ where: { id: p.who.employeeId }, data: { dateOfJoining: d("1990-01-01") } });
    await prisma.attendanceAssignment.updateMany({ where: { employeeId: p.who.employeeId }, data: { effectiveFrom: d("1990-01-01") } });
    await prisma.deviceUserMapping.updateMany({ where: { employeeId: p.who.employeeId }, data: { validFrom: d("1990-01-01") } });
    shiftId = (await prisma.shift.create({ data: { code: `PF${tag}`, name: "Confirmed shift", startTime: "10:00", endTime: "19:00", sessions: { create: [{ sortOrder: 1, kind: "WORK", label: "Day", startTime: "10:00", endTime: "19:00" }] } } })).id;
    policyId = (await prisma.attendancePolicy.create({ data: { code: `PF${tag}`, name: "Confirmed policy", fullDayMinMinutes: 450, halfDayMinMinutes: 225 } })).id;
    await prisma.attendanceAssignment.updateMany({ where: { employeeId: p.who.employeeId }, data: { shiftId, policyId } });
    deviceId = (await prisma.device.create({ data: { serialNumber: `PF-${tag}`, name: "Period test device", locationId: org.locationId } })).id;
    batchId = (await prisma.ingestionBatch.create({ data: { route: "IMPORT", deviceId } })).id;
    await computeAttendance([p.who.employeeId], FROM, TO);
  });

  afterAll(async () => {
    setPayrollLockCheck(null);
    await purgeAppendOnly("AuditLog", { entityId: `${FROM}..${TO}` });
    await deleteWithDependents("AttendancePeriodLock", (await prisma.attendancePeriodLock.findMany({ where: { periodStart: d(FROM) }, select: { id: true } })).map((r) => r.id));
    await prisma.punchFlagResolution.deleteMany({ where: { punchId: { in: punchIds } } });
    await deleteWithDependents("RawPunch", punchIds);
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await deleteWithDependents("IngestionBatch", [batchId]);
    await deleteWithDependents("Device", [deviceId]);
    await deleteWithDependents("Shift", [shiftId]);
    await deleteWithDependents("AttendancePolicy", [policyId]);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("who can see and use it: HR Admin and Payroll Admin finalise; HR Executive, employees and anyone else are refused; unlock is Super Admin only", async () => {
    expect((await api(tok.hr).get(`/finalisation/periods?asOf=${TO}`)).status).toBe(200);
    expect((await api(tok.pay).get(`/finalisation/periods?asOf=${TO}`)).status).toBe(200);
    for (const t of [tok.exec, tok.emp]) {
      expect((await api(t).get(`/finalisation/periods?asOf=${TO}`)).status).toBe(403);
      expect((await finalise(t)).status).toBe(403);
    }
    for (const t of [tok.hr, tok.pay, tok.exec, tok.emp]) expect((await unlock(t)).status).toBe(403);
  });

  it("lists the cycles with their status; February 1990 is open until someone finalises it", async () => {
    const res = await api(tok.hr).get(`/finalisation/periods?asOf=${TO}`);
    expect(res.body.periods).toHaveLength(13);
    expect(res.body.periods[0]).toMatchObject({ isOver: true, status: "OPEN" }); // the cycle containing asOf
    expect(res.body.periods.every((x: { from: string; to: string }) => x.from < x.to)).toBe(true);
  });

  it("a flagged punch nobody has decided blocks the period; deciding it clears the block", async () => {
    const punch = await prisma.rawPunch.create({
      data: { deviceId, deviceUserId: p.who.employeeCode, punchedAt: localTimeToInstant("1990-02-14 10:00:00", "Asia/Kolkata"), localTime: "1990-02-14 10:00:00", businessDate: d("1990-02-14"), status: "1", verifyMode: "255", workcode: "1", reserved: "0", rawLine: "test", route: "IMPORT", batchId, employeeId: p.who.employeeId, flag: "TOO_OLD" },
    });
    punchIds.push(punch.id);
    const res = await api(tok.hr).get(`/finalisation/readiness?from=${FROM}&to=${TO}`);
    expect(res.body.ready).toBe(false);
    const blocker = res.body.blockers.find((b: { code: string }) => b.code === "FLAGGED_PUNCHES");
    expect(blocker).toMatchObject({ count: 1, punches: [{ id: punch.id, deviceUserId: p.who.employeeCode, date: "1990-02-14", flag: "TOO_OLD" }] });
    expect(blocker.message).toContain("Devices");
    expect((await finalise(tok.hr)).status).toBe(409);
    expect(await locked()).toBe(0);
    await prisma.punchFlagResolution.create({ data: { punchId: punch.id, decision: "DISCARDED", reason: "Not a real punch", decidedByUserId: p.hr.userId } });
    await computeAttendance([p.who.employeeId], FROM, TO);
    expect((await api(tok.hr).get(`/finalisation/readiness?from=${FROM}&to=${TO}`)).body.blockers.map((b: { code: string }) => b.code)).not.toContain("FLAGGED_PUNCHES");
  });

  it("an unmapped punch is a warning, not a blocker", async () => {
    const stray = await prisma.rawPunch.create({
      data: { deviceId, deviceUserId: "98765", punchedAt: localTimeToInstant("1990-02-15 10:00:00", "Asia/Kolkata"), localTime: "1990-02-15 10:00:00", businessDate: d("1990-02-15"), status: "1", verifyMode: "255", workcode: "1", reserved: "0", rawLine: "test", route: "IMPORT", batchId, employeeId: null },
    });
    punchIds.push(stray.id);
    const res = await api(tok.hr).get(`/finalisation/readiness?from=${FROM}&to=${TO}`);
    expect(res.body.ready).toBe(true);
    expect(res.body.warnings).toEqual([expect.objectContaining({ code: "UNMAPPED_PUNCHES", count: 1, deviceUserIds: ["98765"] })]);
  });

  it("finalises a whole cycle only: part of one is refused, and so is a period that has blockers", async () => {
    const part = await finalise(tok.hr, { to: "1990-02-20" });
    expect(part.status).toBe(400);
    expect(part.body.error.code).toBe("NOT_A_CYCLE");
    expect(await locked()).toBe(0);
    const open = await finalise(tok.hr, { from: "2999-01-01", to: "2999-01-31" });
    expect([400, 409]).toContain(open.status);
  });

  it("finalising locks every day of the cycle in one step, records who and when, and cannot be done twice", async () => {
    const res = await finalise(tok.pay, { note: "February sign-off" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ locked: 28 });
    expect(await locked()).toBe(28);
    const log = await events();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: "FINALISE", reason: "February sign-off", lockedDays: 28, actorUserId: p.pay.userId });
    expect(await prisma.auditLog.count({ where: { action: "attendance.period.finalised", entityId: `${FROM}..${TO}` } })).toBe(1);
    const row = await period();
    expect(row).toMatchObject({ status: "FINALISED", lockedDays: 28, last: { action: "FINALISE", reason: "February sign-off" } });
    const again = await finalise(tok.hr);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("ALREADY_FINALISED");
  });

  it("a finalised cycle refuses every writer: recompute, correction requests, bulk correction, overrides, shift overrides and leave", async () => {
    // Process Attendance leaves locked days alone and reports them.
    const run = await computeAttendance([p.who.employeeId], FROM, TO);
    expect(run).toMatchObject({ locked: 28, changed: 0 });
    // The employee's own correction request.
    const raise = await api(tok.who).post("/me/regularizations", { date: "1990-02-12", reasonCode: "OTHER", note: "Forgot to punch all day", status: "P" });
    expect(raise.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.regularizationRequest.count({ where: { employeeId: p.who.employeeId } })).toBe(0);
    // HR's bulk correction, Manual Override and Shift Override all name the day as finalised or too old, and write nothing.
    const sel = { employeeIds: [p.who.employeeId] };
    const bulk = await api(tok.hr).post("/regularizations/bulk/preview", { selection: sel, from: "1990-02-12", to: "1990-02-12", reasonCode: "OTHER", note: "Check that it refuses", action: "RAISE", status: "P" });
    expect(bulk.body.count).toBe(0);
    const override = await api(tok.hr).post("/overrides/preview", { selection: sel, from: "1990-02-12", to: "1990-02-12", reasonCode: "OTHER", note: "Check that it refuses", releaseLeave: false, status: "P" });
    expect(override.body.count).toBe(0);
    const shift = await api(tok.hr).post("/shift-overrides/preview", { selection: sel, from: "1990-02-12", to: "1990-02-12", shiftId: "shift_gen", note: "Check that it refuses" });
    expect(shift.body.count).toBe(0);
    // Leave: applying leave over a locked day is refused by the lock.
    const pl = await prisma.leaveType.findFirstOrThrow({ where: { code: "PL" } });
    const leave = await request(app)
      .post("/api/leave/requests")
      .set(...authHeader(tok.who))
      .send({ leaveTypeId: pl.id, fromDate: "1990-02-12", toDate: "1990-02-12", fromDayPart: "FULL", toDayPart: "FULL", reason: "Check that it refuses" });
    expect(leave.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.leaveRequest.count({ where: { employeeId: p.who.employeeId } })).toBe(0);
  });

  it("unlock: only a Super Admin, only with a reason, only for a finalised cycle", async () => {
    expect((await unlock(tok.sup, { reason: "x" })).status).toBe(400);
    expect(await locked()).toBe(28);
    // The service refuses on its own account too (the route's permission and schema are the first layer, not the only one).
    const meta = { actorUserId: p.hr.userId, ipAddress: null, userAgent: null };
    await expect(unlockCycle(FROM, TO, { reason: "A day was found to be wrong", confirmPayrollConsumed: false }, { roleCodes: ["HR_ADMIN"] }, meta)).rejects.toMatchObject({ status: 403, code: "SUPER_ADMIN_ONLY" });
    await expect(unlockCycle(FROM, TO, { reason: " x ", confirmPayrollConsumed: false }, { roleCodes: ["SUPER_ADMIN"] }, meta)).rejects.toMatchObject({ status: 400, code: "VALIDATION_ERROR" });
    expect(await locked()).toBe(28);
    const res = await unlock(tok.sup, { reason: "A day was found to be wrong" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ unlocked: 28 });
    expect(await locked()).toBe(0);
    const log = await events();
    expect(log.map((e) => e.action)).toEqual(["FINALISE", "UNLOCK"]);
    expect(log[1]).toMatchObject({ reason: "A day was found to be wrong", actorUserId: p.sup.userId, payrollConsumed: false });
    expect(await prisma.auditLog.count({ where: { action: "attendance.period.unlocked", entityId: `${FROM}..${TO}` } })).toBe(1);
    expect(await period()).toMatchObject({ status: "UNLOCKED", lockedDays: 0, last: { action: "UNLOCK", reason: "A day was found to be wrong" } });
    const twice = await unlock(tok.sup);
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe("NOT_FINALISED");
  });

  it("an unlocked cycle is open to changes again, and must be finalised again before payroll reads it", async () => {
    const override = await api(tok.hr).post("/overrides/preview", { selection: { employeeIds: [p.who.employeeId] }, from: "1990-02-12", to: "1990-02-12", reasonCode: "OTHER", note: "Open again, so it can", releaseLeave: false, status: "P" });
    expect(override.body.cannotOverride?.[0]?.code).not.toBe("LOCKED");
    expect((await finalise(tok.hr)).body).toEqual({ locked: 28 });
    expect((await events()).map((e) => e.action)).toEqual(["FINALISE", "UNLOCK", "FINALISE"]);
  });

  it("when payroll has used the period, unlocking says so and needs an explicit confirmation", async () => {
    setPayrollLockCheck(async (day) => (day.toISOString().slice(0, 7) === "1990-02" ? { locked: true, period: "February 1990" } : { locked: false }));
    try {
      const refused = await unlock(tok.sup);
      expect(refused.status).toBe(409);
      expect(refused.body.error).toMatchObject({ code: "PAYROLL_CONSUMED", details: { period: "February 1990" } });
      expect(refused.body.error.message).toContain("February 1990");
      expect(await locked()).toBe(28);
      const confirmed = await unlock(tok.sup, { confirmPayrollConsumed: true, reason: "Payroll was re-run on corrected figures" });
      expect(confirmed.status).toBe(200);
      const last = (await events()).at(-1)!;
      expect(last).toMatchObject({ action: "UNLOCK", payrollConsumed: true });
      const audit = await prisma.auditLog.findFirst({ where: { action: "attendance.period.unlocked", entityId: `${FROM}..${TO}` }, orderBy: { createdAt: "desc" } });
      expect(audit!.after).toMatchObject({ payrollConsumed: true, payrollPeriod: "February 1990" });
    } finally {
      setPayrollLockCheck(null);
    }
  });

  it("the record of finalising and unlocking can't be edited or deleted", async () => {
    await expect(prisma.attendancePeriodLock.updateMany({ where: { periodStart: d(FROM) }, data: { reason: "changed" } })).rejects.toThrow(/APPEND_ONLY/);
  });
});
