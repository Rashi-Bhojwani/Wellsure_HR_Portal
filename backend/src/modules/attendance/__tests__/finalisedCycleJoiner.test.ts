import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteWithDependents, purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupEmployeesByCode, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { computeAttendance } from "../compute";

// A joiner dated inside a finalised cycle (user, 2026-10-16): HR is not blocked from recording a real joining, and the
// engine does not write days inside a finalised cycle; the Finalisation screen says who has days waiting so HR can unlock,
// reprocess and finalise again on purpose. April 1989 is a cycle only this file's people were employed in.
const FROM = "1989-04-01";
const TO = "1989-04-30";
const JOIN = "1989-04-10"; // a Monday: 21 days left in the cycle
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const tag = Date.now().toString(36).slice(-5);

describe("a joiner dated inside a finalised cycle", () => {
  let org: TestOrgMasters;
  let a: { employeeId: string; employeeCode: string; userId: string };
  let hr: { employeeId: string; employeeCode: string; userId: string };
  let sup: { employeeId: string; employeeCode: string; userId: string };
  let hrToken = "";
  let supToken = "";
  let shiftId = "";
  let policyId = "";
  let joinerId = "";
  const codes: string[] = [];

  const api = (t: string) => ({
    get: (path: string) => request(app).get(`/api/attendance${path}`).set(...authHeader(t)),
    post: (path: string, b: object = {}) => request(app).post(`/api/attendance${path}`).set(...authHeader(t)).send(b),
  });
  const periodRow = async () => ((await api(hrToken).get(`/finalisation/periods?asOf=${TO}`)).body.periods as Array<{ from: string; status: string; lockedDays: number; unprocessed: { employees: number; days: number; people: Array<{ employeeCode: string; days: number }> } | null }>).find((x) => x.from === FROM)!;
  const rows = (id: string) => prisma.dailyAttendance.count({ where: { employeeId: id, date: { gte: d(FROM), lte: d(TO) } } });

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    a = await createFullTestEmployee(org);
    hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    sup = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    hrToken = await loginAs(hr.employeeCode);
    supToken = await loginAs(sup.employeeCode);
    await prisma.employee.update({ where: { id: a.employeeId }, data: { dateOfJoining: d("1989-01-01") } });
    await prisma.attendanceAssignment.updateMany({ where: { employeeId: a.employeeId }, data: { effectiveFrom: d("1989-01-01") } });
    await prisma.deviceUserMapping.updateMany({ where: { employeeId: a.employeeId }, data: { validFrom: d("1989-01-01") } });
    shiftId = (await prisma.shift.create({ data: { code: `JN${tag}`, name: "Confirmed shift", startTime: "10:00", endTime: "19:00", sessions: { create: [{ sortOrder: 1, kind: "WORK", label: "Day", startTime: "10:00", endTime: "19:00" }] } } })).id;
    policyId = (await prisma.attendancePolicy.create({ data: { code: `JN${tag}`, name: "Confirmed policy", fullDayMinMinutes: 450, halfDayMinMinutes: 225 } })).id;
    await prisma.attendanceAssignment.updateMany({ where: { employeeId: a.employeeId }, data: { shiftId, policyId } });
    await computeAttendance([a.employeeId], FROM, TO);
  });

  afterAll(async () => {
    await purgeAppendOnly("AuditLog", { entityId: `${FROM}..${TO}` });
    await deleteWithDependents("AttendancePeriodLock", (await prisma.attendancePeriodLock.findMany({ where: { periodStart: d(FROM) }, select: { id: true } })).map((r) => r.id));
    await cleanupEmployeesByCode(codes);
    for (const x of [a, hr, sup]) await cleanupFullTestEmployee(x.employeeId);
    await deleteWithDependents("Shift", [shiftId]);
    await deleteWithDependents("AttendancePolicy", [policyId]);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("the cycle is finalised with nobody waiting", async () => {
    const res = await api(hrToken).post("/finalisation", { from: FROM, to: TO, confirm: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ locked: 30 });
    expect(await periodRow()).toMatchObject({ status: "FINALISED", lockedDays: 30, unprocessed: { employees: 0, days: 0, people: [] } });
  });

  it("HR can still record the joining; the engine writes nothing inside the locked cycle; the screen says who is waiting", async () => {
    const suffix = randomUUID().slice(0, 8);
    const code = `JOIN-${suffix}`;
    codes.push(code);
    const res = await request(app)
      .post("/api/employees")
      .set(...authHeader(hrToken))
      .send({
        official: { deviceUserId: code, employeeCode: code, dateOfJoining: JOIN, departmentId: org.departmentId, designationId: org.designationId, locationId: org.locationId, employmentType: "PERMANENT", attendanceCapture: "DEVICE" },
        personal: { fullName: `Joiner ${suffix}`, dateOfBirth: "1965-06-01", gender: "MALE", personalEmail: `joiner.${suffix}@gmail.com`, mobile: "9876543210", currentAddress: "Some address", permanentAddress: "Some address", emergencyContactName: "Emergency Contact", emergencyContactPhone: "9876543211", emergencyContactRelation: "Parent" },
      });
    expect(res.status).toBe(201); // not refused because the cycle is locked
    joinerId = res.body.id;

    const r = await computeAttendance([joinerId], FROM, TO);
    expect(await rows(joinerId)).toBe(0);
    expect(r.locked).toBe(30); // skipped because the cycle is finalised, not because they have a row
    expect(r.changed).toBe(0);

    const row = await periodRow();
    expect(row.status).toBe("FINALISED");
    expect(row.unprocessed).toMatchObject({ employees: 1, days: 21, people: [{ employeeCode: code, days: 21 }] });
  });

  it("the people already locked are untouched, and a later cycle is still computed normally", async () => {
    expect(await prisma.dailyAttendance.count({ where: { employeeId: a.employeeId, isLocked: true, date: { gte: d(FROM), lte: d(TO) } } })).toBe(30);
    await computeAttendance([joinerId], "1989-05-01", "1989-05-05");
    expect(await rows(joinerId)).toBe(0); // April still empty
    expect(await prisma.dailyAttendance.count({ where: { employeeId: joinerId, date: { gte: d("1989-05-01"), lte: d("1989-05-05") } } })).toBe(5);
  });

  it("unlock, reprocess and finalise again brings them in; nobody is waiting afterwards", async () => {
    expect((await api(supToken).post("/finalisation/unlock", { from: FROM, to: TO, reason: "A joiner was recorded inside the cycle", confirm: true })).status).toBe(200);
    expect((await periodRow()).unprocessed).toBeNull(); // not finalised any more: nothing to report
    // the joiner has the company defaults (placeholder values), which would block; the confirmed rules stand in for HR's values
    await prisma.attendanceAssignment.updateMany({ where: { employeeId: joinerId }, data: { shiftId, policyId } });
    await computeAttendance([joinerId], FROM, TO);
    expect(await rows(joinerId)).toBe(21);
    const again = await api(hrToken).post("/finalisation", { from: FROM, to: TO, confirm: true });
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ locked: 51 });
    expect(await periodRow()).toMatchObject({ status: "FINALISED", lockedDays: 51, unprocessed: { employees: 0, days: 0 } });
  });
});
