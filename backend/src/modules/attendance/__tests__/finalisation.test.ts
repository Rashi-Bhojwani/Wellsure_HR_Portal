import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteWithDependents, purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { computeAttendance } from "../compute";
import { finalisationBlockers, finalisePeriod } from "../finalisation";

// The finalisation gate (user, 2026-10-09): placeholder rule values, NM/NS days
// and days not up to date block finalising a period — a hard block with a
// clear message. Days come from the real engine. Uses March 1990, a period only this file's employee was
// employed in, so the seeded company doesn't affect the result.
const FROM = "1990-03-01";
const TO = "1990-03-31";
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const tag = Date.now().toString(36).slice(-5);

describe("period finalisation gate", () => {
  let org: TestOrgMasters;
  let who: { employeeId: string; employeeCode: string; userId: string };
  let hr: { employeeId: string; employeeCode: string; userId: string };
  let emp: { employeeId: string; employeeCode: string; userId: string };
  let shiftId = "";
  let policyId = "";
  const holidayIds: string[] = [];
  const meta = () => ({ actorUserId: hr.userId, ipAddress: null, userAgent: null });

  const compute = () => computeAttendance([who.employeeId], FROM, TO);
  const codes = async () => (await finalisationBlockers(FROM, TO)).map((b) => b.code);
  const assign = (shift: string, policy: string) => prisma.attendanceAssignment.updateMany({ where: { employeeId: who.employeeId }, data: { shiftId: shift, policyId: policy } });

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    who = await createFullTestEmployee(org);
    hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    emp = await createFullTestEmployee(org, { roleCode: "EMPLOYEE" });
    await prisma.employee.update({ where: { id: who.employeeId }, data: { dateOfJoining: d("1990-01-01") } });
    await prisma.attendanceAssignment.updateMany({ where: { employeeId: who.employeeId }, data: { effectiveFrom: d("1990-01-01") } });
    await prisma.deviceUserMapping.updateMany({ where: { employeeId: who.employeeId }, data: { validFrom: d("1990-01-01") } }); // device capture
    shiftId = (
      await prisma.shift.create({
        data: { code: `F${tag}`, name: "Confirmed shift", startTime: "10:00", endTime: "19:00", sessions: { create: [{ sortOrder: 1, kind: "WORK", label: "Day", startTime: "10:00", endTime: "19:00" }] } },
      })
    ).id;
    policyId = (await prisma.attendancePolicy.create({ data: { code: `F${tag}`, name: "Confirmed policy", fullDayMinMinutes: 450, halfDayMinMinutes: 225 } })).id;
  });

  afterAll(async () => {
    await purgeAppendOnly("AuditLog", { entityId: `${FROM}..${TO}` });
    await deleteWithDependents("Holiday", holidayIds);
    for (const x of [who, hr, emp]) await cleanupFullTestEmployee(x.employeeId);
    await deleteWithDependents("Shift", [shiftId]);
    await deleteWithDependents("AttendancePolicy", [policyId]);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("the seeded default policy's thresholds are fail-safe placeholders (6 h / 3 h) — and they block finalisation by name", async () => {
    const def = await prisma.attendancePolicy.findUniqueOrThrow({ where: { id: "policy_default" } });
    expect([def.fullDayMinMinutes, def.halfDayMinMinutes]).toEqual([360, 180]);
    expect(def.placeholderFields).toEqual(["fullDayMinMinutes", "halfDayMinMinutes"]);

    // `who` is on the company default (GEN, DEFAULT) — both still placeholders
    await compute();
    const blockers = await finalisationBlockers(FROM, TO);
    expect(blockers.map((b) => b.code)).toEqual(["PLACEHOLDER_RULES"]);
    const rules = blockers[0]!.code === "PLACEHOLDER_RULES" ? blockers[0]!.rules : [];
    expect(rules.map((r) => [r.kind, r.id, r.fields])).toEqual([
      ["POLICY", "policy_default", ["fullDayMinMinutes", "halfDayMinMinutes"]],
      ["SHIFT", "shift_gen", ["graceInMinutes", "graceOutMinutes"]],
    ]);
    expect(blockers[0]!.message).toContain('policy "Default policy" (full-day minimum and half-day minimum)');
  });

  it("finalisePeriod refuses with 409 FINALISATION_BLOCKED, every blocker in details, and locks nothing", async () => {
    await expect(finalisePeriod(FROM, TO, meta())).rejects.toMatchObject({ status: 409, code: "FINALISATION_BLOCKED", message: expect.stringContaining("still placeholders"), details: { blockers: [{ code: "PLACEHOLDER_RULES" }] } });
    expect(await prisma.dailyAttendance.count({ where: { employeeId: who.employeeId, isLocked: true } })).toBe(0);
  });

  it("moving to confirmed rules isn't enough: days computed under the placeholders block until re-processed", async () => {
    await assign(shiftId, policyId);
    // the days still record GEN / DEFAULT, and the engine would now give them the new rules
    expect(await codes()).toEqual(["PLACEHOLDER_RULES", "NOT_UP_TO_DATE"]);
    await compute();
    expect(await finalisationBlockers(FROM, TO)).toEqual([]);
  });

  it("anything changed since computing (here a holiday added) blocks until re-processed, naming the days", async () => {
    const holiday = await prisma.holiday.create({ data: { date: d("1990-03-14"), name: `Finalisation test ${tag}` } });
    holidayIds.push(holiday.id);
    const blockers = await finalisationBlockers(FROM, TO);
    expect(blockers.map((b) => b.code)).toEqual(["NOT_UP_TO_DATE"]);
    expect(blockers[0]!.code === "NOT_UP_TO_DATE" && blockers[0]!.days.map((x) => x.date)).toEqual(["1990-03-14"]);
    await compute();
    expect(await codes()).toEqual([]);
  });

  it("NM days (manual capture, nothing entered) block, listing the days", async () => {
    await prisma.deviceUserMapping.updateMany({ where: { employeeId: who.employeeId }, data: { validFrom: d("1990-03-20") } });
    await compute();
    const blockers = await finalisationBlockers(FROM, TO);
    expect(blockers.map((b) => b.code)).toEqual(["NOT_MARKED"]);
    const nm = blockers[0]!;
    expect(nm.code === "NOT_MARKED" && nm.count).toBe(15); // 1–19 March less three Sundays (4, 11, 18) and the 14th, now a holiday
    expect(nm.code === "NOT_MARKED" && nm.days[0]).toEqual({ employeeId: who.employeeId, employeeName: expect.any(String), date: "1990-03-01" });
    await prisma.deviceUserMapping.updateMany({ where: { employeeId: who.employeeId }, data: { validFrom: d("1990-01-01") } });
    await compute();
    expect(await codes()).toEqual([]);
  });

  it("a period that hasn't ended can't be finalised; a check is at most a year", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const in10 = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    expect((await finalisationBlockers(today, in10)).map((b) => b.code)).toContain("PERIOD_NOT_OVER");
    await expect(finalisationBlockers("1990-03-01", "1991-03-02")).rejects.toMatchObject({ status: 400, message: "Check at most 366 days at a time." });
  });

  it("once nothing blocks, finalisePeriod locks the period's days and audits it", async () => {
    expect(await finalisePeriod(FROM, TO, meta())).toEqual({ locked: 31 });
    expect(await prisma.dailyAttendance.count({ where: { employeeId: who.employeeId, isLocked: true } })).toBe(31);
    expect(await prisma.auditLog.count({ where: { action: "attendance.period.finalised", entityId: `${FROM}..${TO}` } })).toBe(1);
  });

  it("GET /api/attendance/finalisation/readiness: HR sees the blockers; an employee is refused", async () => {
    await assign("shift_gen", "policy_default");
    const res = await request(app).get(`/api/attendance/finalisation/readiness?from=${FROM}&to=${TO}`).set(...authHeader(await loginAs(hr.employeeCode)));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ from: FROM, to: TO, ready: false, blockers: [{ code: "PLACEHOLDER_RULES" }] });
    const denied = await request(app).get(`/api/attendance/finalisation/readiness?from=${FROM}&to=${TO}`).set(...authHeader(await loginAs(emp.employeeCode)));
    expect(denied.status).toBe(403);
  });

  it("guard: finalisation.ts is the only code that sets is_locked", () => {
    const root = path.resolve(import.meta.dirname, "../../..");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
          if (name !== "__tests__") walk(full);
        } else if (/\.ts$/.test(name) && !name.endsWith(".test.ts")) {
          const src = readFileSync(full, "utf8");
          const writesFlag = /data:\s*\{[^}]*\bisLocked:\s*true/s.test(src) || /is_locked\s*=\s*true/i.test(src);
          if (writesFlag && path.relative(root, full) !== path.join("modules", "attendance", "finalisation.ts")) offenders.push(path.relative(root, full));
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
    expect(readFileSync(path.join(root, "modules/attendance/finalisation.ts"), "utf8")).toMatch(/await assertCanFinalise\(fromDate, toDate\);\n\s*const \{ count \} = await prisma\.dailyAttendance\.updateMany/);
  });
});
