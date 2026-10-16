import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { computeAttendance } from "../compute";

// The cut-over guard (Phase 1.5, commit A): until attendance.engineStartDate the days belong to greytHR, and the engine, Process Attendance and the
// nightly job must never compute, overwrite or delete them. February 1988 is a month only this file's person was employed in.
const KEY = "attendance.engineStartDate";
const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("attendance.engineStartDate", () => {
  let org: TestOrgMasters;
  let person: { employeeId: string; employeeCode: string; userId: string };
  let sup: { employeeId: string; employeeCode: string; userId: string };
  let supToken = "";
  const days = (from: string, to: string) => prisma.dailyAttendance.findMany({ where: { employeeId: person.employeeId, date: { gte: d(from), lte: d(to) } }, orderBy: { date: "asc" }, select: { date: true } });

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    person = await createFullTestEmployee(org);
    sup = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    supToken = await loginAs(sup.employeeCode);
    await prisma.employee.update({ where: { id: person.employeeId }, data: { dateOfJoining: d("1988-01-01") } });
    await prisma.attendanceAssignment.updateMany({ where: { employeeId: person.employeeId }, data: { effectiveFrom: d("1988-01-01") } });
    await prisma.deviceUserMapping.updateMany({ where: { employeeId: person.employeeId }, data: { validFrom: d("1988-01-01") } });
    await prisma.systemSetting.deleteMany({ where: { key: KEY } });
  });

  afterAll(async () => {
    await prisma.systemSetting.deleteMany({ where: { key: KEY } });
    await purgeAppendOnly("AuditLog", { entityId: KEY });
    await cleanupFullTestEmployee(person.employeeId);
    await cleanupFullTestEmployee(sup.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("with no date set the engine writes any day (no guard)", async () => {
    const r = await computeAttendance([person.employeeId], "1988-02-10", "1988-02-20");
    expect(r.beforeEngineStart).toBe(0);
    expect(await days("1988-02-10", "1988-02-20")).toHaveLength(11);
  });

  it("setting the date is audited, and is refused when it is not a real date", async () => {
    const bad = await request(app).put("/api/attendance/config/engine-start").set(...authHeader(supToken)).send({ date: "1988-13-45" });
    expect(bad.status).toBe(400);
    const ok = await request(app).put("/api/attendance/config/engine-start").set(...authHeader(supToken)).send({ date: "1988-02-15" });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ date: "1988-02-15" });
    expect((await request(app).get("/api/attendance/config/engine-start").set(...authHeader(supToken))).body).toEqual({ date: "1988-02-15" });
    expect(await prisma.auditLog.count({ where: { action: "attendance.engine_start.updated", entityId: KEY } })).toBe(1);
  });

  it("days before the date are neither recomputed nor deleted, even when the recompute would delete them", async () => {
    // Employment now ends on the 11th: every day from the 12th on is "not employed", so a recompute would delete those rows.
    await prisma.employee.update({ where: { id: person.employeeId }, data: { lastWorkingDate: d("1988-02-11") } });
    const r = await computeAttendance([person.employeeId], "1988-02-10", "1988-02-20");
    expect(r.beforeEngineStart).toBe(5); // 10th to 14th: greytHR's
    expect(r.deleted).toBe(6); // 15th to 20th: this system's, and no longer valid
    const left = (await days("1988-02-10", "1988-02-20")).map((x) => x.date.toISOString().slice(0, 10));
    expect(left).toEqual(["1988-02-10", "1988-02-11", "1988-02-12", "1988-02-13", "1988-02-14"]); // untouched, including 12th-14th
  });

  it("nothing is written before the date even for a day that has no row", async () => {
    await prisma.employee.update({ where: { id: person.employeeId }, data: { lastWorkingDate: null } });
    await prisma.dailyAttendance.deleteMany({ where: { employeeId: person.employeeId, date: { gte: d("1988-02-10"), lte: d("1988-02-14") } } });
    const r = await computeAttendance([person.employeeId], "1988-02-10", "1988-02-20");
    expect(r.beforeEngineStart).toBe(5);
    expect((await days("1988-02-10", "1988-02-14"))).toHaveLength(0);
    expect((await days("1988-02-15", "1988-02-20"))).toHaveLength(6);
  });

  it("Process Attendance refuses a range wholly before the date, and says so for one that straddles it", async () => {
    const before = await request(app).post("/api/attendance/process").set(...authHeader(supToken)).send({ fromDate: "1988-02-01", toDate: "1988-02-10", reason: "cut-over test" });
    expect(before.status, JSON.stringify(before.body)).toBe(400);
    expect(JSON.stringify(before.body)).toContain("BEFORE_ENGINE_START");
    expect(JSON.stringify(before.body)).toContain("1988-02-15");
    const straddle = await request(app).post("/api/attendance/process").set(...authHeader(supToken)).send({ fromDate: "1988-02-10", toDate: "1988-02-20", reason: "cut-over test" });
    expect(straddle.status).toBeLessThan(300);
    const audit = await prisma.auditLog.findFirst({ where: { action: "attendance.process.requested", entityId: straddle.body.id } });
    expect(audit?.after).toMatchObject({ engineStartDate: "1988-02-15", daysBeforeEngineStartSkipped: 5 });
    await prisma.attendanceProcessRun.deleteMany({ where: { id: { in: [straddle.body.id] } } });
    await purgeAppendOnly("AuditLog", { entityId: straddle.body.id });
  });

  it("clearing the date removes the guard", async () => {
    const r = await request(app).put("/api/attendance/config/engine-start").set(...authHeader(supToken)).send({ date: null });
    expect(r.body).toEqual({ date: null });
    expect((await computeAttendance([person.employeeId], "1988-02-10", "1988-02-14")).beforeEngineStart).toBe(0);
  });
});
