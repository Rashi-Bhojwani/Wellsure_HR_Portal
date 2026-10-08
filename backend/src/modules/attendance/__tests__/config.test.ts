import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { grantManager } from "../../../lib/__tests__/testHelpers";
import { addCalendarDays, businessToday } from "../../../lib/businessDate";
import { closeHistoryOnLeaving } from "../../../lib/effectiveDating";
import { ATTENDANCE_SETTING_KEYS, FALLBACK_ATTENDANCE_DEFAULTS } from "../../../lib/attendanceSettings";
import { setSetting } from "../../../lib/settings";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";

// Attendance Settings (Phase 2 commit P2-A, docs/plans/PHASE_2.md §2.1, §4.6).
type Person = { employeeId: string; employeeCode: string; userId: string };
const iso = (d: Date) => d.toISOString().slice(0, 10);
const inDays = (n: number) => iso(addCalendarDays(businessToday(), n));
const GEN_SESSIONS = [
  { kind: "WORK", label: "First session", startTime: "10:00", endTime: "14:00" },
  { kind: "BREAK", label: "Lunch", startTime: "14:00", endTime: "14:45" },
  { kind: "WORK", label: "Second session", startTime: "14:45", endTime: "19:00" },
];

describe("Attendance Settings (P2-A)", () => {
  let org: TestOrgMasters;
  const p = {} as Record<"hrAdmin" | "hrExec" | "mgr" | "emp" | "emp2", Person>;
  const tok = {} as Record<"hrAdmin" | "hrExec" | "mgr" | "emp", string>;
  const created = { shifts: [] as string[], patterns: [] as string[], policies: [] as string[], cycles: [] as string[] };

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    p.hrAdmin = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.hrExec = await createFullTestEmployee(org, { roleCode: "HR_EXECUTIVE" });
    p.mgr = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    p.emp = await createFullTestEmployee(org, { roleCode: "EMPLOYEE", managerId: p.mgr.employeeId });
    p.emp2 = await createFullTestEmployee(org, { roleCode: "EMPLOYEE", managerId: p.mgr.employeeId });
    await grantManager(p.mgr.userId, ["attendance.manual.enter"]);
    for (const k of ["hrAdmin", "hrExec", "mgr", "emp"] as const) tok[k] = await loginAs(p[k].employeeCode);
  });

  afterEach(async () => {
    await setSetting(ATTENDANCE_SETTING_KEYS.defaults, FALLBACK_ATTENDANCE_DEFAULTS, null);
  });

  afterAll(async () => {
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await deleteWithDependents("AttendanceCycleRule", created.cycles);
    await deleteWithDependents("Shift", created.shifts);
    await deleteWithDependents("WeekOffPattern", created.patterns);
    await deleteWithDependents("AttendancePolicy", created.policies);
    await cleanupEmployeeTestOrgMasters(org);
  });

  const api = (t: string) => ({
    get: (path: string) => request(app).get(`/api/attendance/config${path}`).set(...authHeader(t)),
    post: (path: string, b: object = {}) => request(app).post(`/api/attendance/config${path}`).set(...authHeader(t)).send(b),
    patch: (path: string, b: object) => request(app).patch(`/api/attendance/config${path}`).set(...authHeader(t)).send(b),
    put: (path: string, b: object) => request(app).put(`/api/attendance/config${path}`).set(...authHeader(t)).send(b),
  });
  const audit = (action: string, entityId: string) => prisma.auditLog.findFirst({ where: { action, entityId }, orderBy: { createdAt: "desc" } });

  describe("what HR confirmed is seeded on every database by the migration", () => {
    it("GEN 10:00–19:00 in two sessions with lunch; grace a placeholder", async () => {
      const res = await api(tok.hrAdmin).get("/shifts");
      expect(res.status).toBe(200);
      const gen = res.body.shifts.find((s: { code: string }) => s.code === "GEN");
      expect(gen).toMatchObject({ startTime: "10:00", endTime: "19:00", crossesMidnight: false, workMinutes: 495, breakMinutes: 45, isDefault: true, isActive: true });
      expect(gen.sessions).toEqual(GEN_SESSIONS);
      expect(gen.placeholderFields).toEqual(["graceInMinutes", "graceOutMinutes"]);
    });

    it("Sunday off; the default policy with no penalty rules, thresholds placeholders; calendar-month cycle", async () => {
      const patterns = (await api(tok.hrAdmin).get("/week-off-patterns")).body.patterns;
      expect(patterns.find((x: { code: string }) => x.code === "SUN")).toMatchObject({ rules: [{ weekday: 0 }], summary: "Sunday", isDefault: true });
      const policy = (await api(tok.hrAdmin).get("/policies")).body.policies.find((x: { code: string }) => x.code === "DEFAULT");
      expect(policy).toMatchObject({ penaltyRules: [], halfDayMinNotMetLopDays: 1, nearDuplicateSeconds: 120, inferBreakPairing: false, futureToleranceMinutes: 10, maxPunchAgeDays: 45 });
      expect(policy.placeholderFields).toEqual(["fullDayMinMinutes", "halfDayMinMinutes"]);
      // fail-safe placeholders: well below the General Shift's 8 h 15 m of work
      expect([policy.fullDayMinMinutes, policy.halfDayMinMinutes]).toEqual([360, 180]);
      const cycle = (await api(tok.hrAdmin).get("/cycle")).body;
      expect(cycle.current.startDay).toBe(1);
      expect(cycle.current.start.slice(8)).toBe("01");
      const defaults = (await api(tok.hrAdmin).get("/defaults")).body;
      expect([defaults.shift.code, defaults.weekOffPattern.code, defaults.policy.code]).toEqual(["GEN", "SUN", "DEFAULT"]);
    });
  });

  describe("who may read and change it", () => {
    it("HR Admin changes it; HR Executive and Payroll Admin read it; an employee can't reach it", async () => {
      expect((await api(tok.hrExec).get("/shifts")).status).toBe(200);
      expect((await api(tok.hrExec).patch("/shifts/shift_gen", { name: "x" })).status).toBe(403);
      expect((await api(tok.emp).get("/shifts")).status).toBe(403);
      const payroll = await prisma.role.findUniqueOrThrow({ where: { code: "PAYROLL_ADMIN" }, include: { permissions: { include: { permission: true } } } });
      expect(payroll.permissions.map((x) => x.permission.key).filter((k) => k.startsWith("attendance."))).toEqual(["attendance.view"]);
    });

    it("a manager granted manual entry still can't read or change company configuration", async () => {
      expect((await api(tok.mgr).get("/shifts")).status).toBe(403);
      expect((await api(tok.mgr).get("/manual-branches")).status).toBe(403);
      expect((await api(tok.mgr).put(`/manual-branches/${p.mgr.userId}`, { locationIds: [org.locationId] })).status).toBe(403);
    });
  });

  describe("shifts", () => {
    it("creates a shift with sessions, refuses broken session structures, audits", async () => {
      const bad = await api(tok.hrAdmin).post("/shifts", { code: "T1", name: "Test", startTime: "09:00", endTime: "18:00", graceInMinutes: 0, graceOutMinutes: 0, windowBeforeMinutes: 240, windowAfterMinutes: 360, sessions: GEN_SESSIONS });
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe("INVALID_SESSIONS");
      const code = `T${Date.now() % 100000}`;
      const res = await api(tok.hrAdmin).post("/shifts", {
        code,
        name: "Night",
        startTime: "22:00",
        endTime: "06:00",
        graceInMinutes: 10,
        graceOutMinutes: 5,
        windowBeforeMinutes: 120,
        windowAfterMinutes: 240,
        sessions: [
          { kind: "WORK", label: "A", startTime: "22:00", endTime: "02:00" },
          { kind: "BREAK", label: "Meal", startTime: "02:00", endTime: "02:30" },
          { kind: "WORK", label: "B", startTime: "02:30", endTime: "06:00" },
        ],
      });
      expect(res.status).toBe(201);
      created.shifts.push(res.body.id);
      expect(res.body).toMatchObject({ crossesMidnight: true, workMinutes: 450, breakMinutes: 30, placeholderFields: [], employeeCount: 0 });
      expect(await audit("attendance.shift.created", res.body.id)).not.toBeNull();
      expect((await api(tok.hrAdmin).post("/shifts", { ...res.body, code, sessions: res.body.sessions })).status).toBe(409);
    });

    it("grace stays a placeholder until HR's value is entered or confirmed", async () => {
      const before = await prisma.shift.findUniqueOrThrow({ where: { id: "shift_gen" } });
      try {
        const renamed = await api(tok.hrAdmin).patch("/shifts/shift_gen", { name: "General Shift", graceInMinutes: 0 });
        expect(renamed.body.placeholderFields).toEqual(["graceInMinutes", "graceOutMinutes"]); // same value isn't a confirmation
        const set = await api(tok.hrAdmin).patch("/shifts/shift_gen", { graceInMinutes: 15 });
        expect(set.body.placeholderFields).toEqual(["graceOutMinutes"]);
        const confirmed = await api(tok.hrAdmin).patch("/shifts/shift_gen", { confirmPlaceholders: ["graceOutMinutes"] });
        expect(confirmed.body.placeholderFields).toEqual([]);
        expect(await audit("attendance.shift.updated", "shift_gen")).not.toBeNull();
      } finally {
        await prisma.shift.update({ where: { id: "shift_gen" }, data: { name: before.name, graceInMinutes: before.graceInMinutes, graceOutMinutes: before.graceOutMinutes, placeholderFields: before.placeholderFields as string[] } });
      }
    });

    it("editing the sessions re-validates them against the shift times", async () => {
      const res = await api(tok.hrAdmin).patch("/shifts/shift_gen", { endTime: "18:00" });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/must end when the shift ends \(18:00\)/);
    });

    it("the company default, or a shift someone is on, can't be deactivated", async () => {
      const dflt = await api(tok.hrAdmin).patch("/shifts/shift_gen", { isActive: false });
      expect(dflt.status).toBe(409);
      expect(dflt.body.error.message).toMatch(/company default shift/);
      const shiftId = created.shifts[0]!;
      await api(tok.hrAdmin).post(`/assignments/${p.emp2.employeeId}`, { shiftId, effectiveFrom: inDays(30) });
      const inUse = await api(tok.hrAdmin).patch(`/shifts/${shiftId}`, { isActive: false });
      expect(inUse.status).toBe(409);
      expect(inUse.body.error.message).toMatch(/1 person is on this shift now or from a scheduled date/);
      const history = (await api(tok.hrAdmin).get(`/assignments/${p.emp2.employeeId}`)).body.history;
      await api(tok.hrAdmin).post(`/assignments/${p.emp2.employeeId}/${history[0].id}/cancel`);
      const ok = await api(tok.hrAdmin).patch(`/shifts/${shiftId}`, { isActive: false });
      expect(ok.status).toBe(200);
      expect(await audit("attendance.shift.deactivated", shiftId)).not.toBeNull();
    });
  });

  describe("week-off patterns and policies", () => {
    it("creates a 2nd-and-4th-Saturday pattern and refuses a weekday listed twice", async () => {
      const code = `W${Date.now() % 100000}`;
      const res = await api(tok.hrAdmin).post("/week-off-patterns", { code, name: "Alt Sat", rules: [{ weekday: 0 }, { weekday: 6, weeks: [2, 4] }] });
      expect(res.status).toBe(201);
      created.patterns.push(res.body.id);
      expect((await api(tok.hrAdmin).post("/week-off-patterns", { code: `${code}X`, name: "Bad", rules: [{ weekday: 0 }, { weekday: 0 }] })).status).toBe(400);
      expect((await api(tok.hrAdmin).patch("/week-off-patterns/wop_sun", { isActive: false })).status).toBe(409);
    });

    it("a policy's half-day minimum can't exceed its full-day minimum; HR's values clear the placeholders", async () => {
      const code = `P${Date.now() % 100000}`;
      const fields = { name: "Test", fullDayMinMinutes: 480, halfDayMinMinutes: 240, halfDayMinNotMetLopDays: 1, nearDuplicateSeconds: 120, inferBreakPairing: false, futureToleranceMinutes: 10, maxPunchAgeDays: 45 };
      expect((await api(tok.hrAdmin).post("/policies", { ...fields, code, halfDayMinMinutes: 500 })).status).toBe(400);
      const res = await api(tok.hrAdmin).post("/policies", { ...fields, code });
      expect(res.status).toBe(201);
      created.policies.push(res.body.id);
      const before = await prisma.attendancePolicy.findUniqueOrThrow({ where: { id: "policy_default" } });
      try {
        const upd = await api(tok.hrAdmin).patch("/policies/policy_default", { fullDayMinMinutes: 450 });
        expect(upd.body.placeholderFields).toEqual(["halfDayMinMinutes"]);
      } finally {
        await prisma.attendancePolicy.update({ where: { id: "policy_default" }, data: { fullDayMinMinutes: before.fullDayMinMinutes, placeholderFields: before.placeholderFields as string[] } });
      }
    });

    it("the company default can be changed to another active set, audited", async () => {
      const res = await api(tok.hrAdmin).put("/defaults", { shiftId: "shift_gen", weekOffPatternId: created.patterns[0], policyId: created.policies[0] });
      expect(res.status).toBe(200);
      expect(res.body.weekOffPattern.id).toBe(created.patterns[0]);
      expect(await audit("attendance.defaults.updated", ATTENDANCE_SETTING_KEYS.defaults)).not.toBeNull();
      expect((await api(tok.hrAdmin).put("/defaults", { shiftId: created.shifts[0], weekOffPatternId: "wop_sun", policyId: "policy_default" })).status).toBe(400); // deactivated above
    });
  });

  describe("the attendance cycle", () => {
    it("a change applies only from a future boundary, one at a time, and can be cancelled before it starts", async () => {
      const cur = (await api(tok.hrAdmin).get("/cycle")).body.current;
      const tooSoon = await api(tok.hrAdmin).post("/cycle", { effectiveFrom: cur.start, startDay: 1 });
      expect(tooSoon.status).toBe(400);
      expect(tooSoon.body.error.message).toMatch(/keeps its boundaries/);
      const end = new Date(`${cur.end}T00:00:00Z`);
      const next26 = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 26));
      const ok = await api(tok.hrAdmin).post("/cycle", { effectiveFrom: iso(next26), startDay: 26 });
      expect(ok.status).toBe(200);
      const scheduled = ok.body.rules.filter((r: { status: string }) => r.status === "scheduled");
      expect(scheduled).toHaveLength(1);
      created.cycles.push(scheduled[0].id);
      expect(ok.body.current).toEqual(cur); // the current cycle didn't move
      const cancel = await api(tok.hrAdmin).post(`/cycle/${scheduled[0].id}/cancel`);
      expect(cancel.status).toBe(200);
      expect(cancel.body.rules.some((r: { status: string }) => r.status === "scheduled")).toBe(false);
      expect(await audit("attendance.cycle.cancelled", scheduled[0].id)).not.toBeNull();
    });
  });

  describe("assignments (effective-dated)", () => {
    it("lists everyone with today's assignment and capture; filters by capture", async () => {
      await prisma.deviceUserMapping.deleteMany({ where: { employeeId: p.emp2.employeeId } }); // emp2 becomes manual capture
      const res = await api(tok.hrAdmin).get(`/assignments?search=${p.emp.employeeCode}`);
      expect(res.status).toBe(200);
      expect(res.body.employees).toHaveLength(1);
      expect(res.body.employees[0]).toMatchObject({ employeeId: p.emp.employeeId, capture: "DEVICE", current: { shift: { code: "GEN" }, weekOffPattern: { summary: "Sunday" }, status: "current" }, scheduled: null });
      const manual = (await api(tok.hrAdmin).get("/assignments?capture=MANUAL")).body.employees.map((e: { employeeId: string }) => e.employeeId);
      expect(manual).toContain(p.emp2.employeeId);
      expect(manual).not.toContain(p.emp.employeeId);
    });

    it("a change dated ahead is scheduled; today's assignment holds until then; cancelling reopens it", async () => {
      const res = await api(tok.hrAdmin).post(`/assignments/${p.emp.employeeId}`, { weekOffPatternId: created.patterns[0], effectiveFrom: inDays(10), changeReason: "moves to alternate Saturdays" });
      expect(res.status).toBe(200);
      expect(res.body.history.map((h: { status: string; weekOffPattern: { id: string } }) => [h.status, h.weekOffPattern.id])).toEqual([
        ["scheduled", created.patterns[0]],
        ["current", "wop_sun"],
      ]);
      expect(res.body.history[0].shift.code).toBe("GEN"); // unchanged fields carry over
      const list = (await api(tok.hrAdmin).get(`/assignments?search=${p.emp.employeeCode}`)).body.employees[0];
      expect([list.current.weekOffPattern.id, list.scheduled.weekOffPattern.id, list.scheduled.effectiveFrom]).toEqual(["wop_sun", created.patterns[0], inDays(10)]);
      const earlier = await api(tok.hrAdmin).post(`/assignments/${p.emp.employeeId}`, { policyId: created.policies[0], effectiveFrom: inDays(5) });
      expect(earlier.status).toBe(409);
      expect(earlier.body.error.code).toBe("HISTORY_SCHEDULED_EXISTS");
      const cancel = await api(tok.hrAdmin).post(`/assignments/${p.emp.employeeId}/${res.body.history[0].id}/cancel`);
      expect(cancel.body.history.map((h: { status: string; effectiveTo: string | null }) => [h.status, h.effectiveTo])).toEqual([["current", null]]);
      expect(await audit("attendance.assignment.scheduled_change_cancelled", p.emp.employeeId)).not.toBeNull();
    });

    it("history is never rewritten: a change before the latest period is refused", async () => {
      const res = await api(tok.hrAdmin).post(`/assignments/${p.emp.employeeId}`, { policyId: created.policies[0], effectiveFrom: "2023-06-01" });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("HISTORY_BEFORE_LATEST");
    });

    it("bulk: all or nothing, and each person audited", async () => {
      const refused = await api(tok.hrAdmin).post("/assignments/bulk", { employeeIds: [p.emp.employeeId, p.emp2.employeeId], policyId: created.policies[0], effectiveFrom: "2023-06-01" });
      expect(refused.status).toBe(400);
      expect(refused.body.error.message).toMatch(/Nothing was changed/);
      const ok = await api(tok.hrAdmin).post("/assignments/bulk", { employeeIds: [p.emp.employeeId, p.emp2.employeeId], policyId: created.policies[0], effectiveFrom: inDays(3) });
      expect(ok.body).toEqual({ changed: 2 });
      for (const e of [p.emp, p.emp2]) {
        const h = (await api(tok.hrAdmin).get(`/assignments/${e.employeeId}`)).body.history;
        expect(h[0]).toMatchObject({ status: "scheduled", policy: { id: created.policies[0] }, effectiveFrom: inDays(3) });
        await api(tok.hrAdmin).post(`/assignments/${e.employeeId}/${h[0].id}/cancel`);
        expect(await audit("attendance.assignment.changed", e.employeeId)).not.toBeNull();
      }
    });

    it("leaving ends the assignment the day after the last working day and drops a scheduled one", async () => {
      await api(tok.hrAdmin).post(`/assignments/${p.emp2.employeeId}`, { policyId: created.policies[0], effectiveFrom: inDays(20) });
      const lwd = addCalendarDays(businessToday(), 5);
      await prisma.$transaction((tx) => closeHistoryOnLeaving(tx, p.emp2.employeeId, lwd));
      const h = (await api(tok.hrAdmin).get(`/assignments/${p.emp2.employeeId}`)).body.history;
      expect(h.map((x: { effectiveTo: string | null; lastDay: string | null }) => [x.effectiveTo, x.lastDay])).toEqual([[inDays(6), inDays(5)]]);
      const after = await api(tok.hrAdmin).post(`/assignments/${p.emp2.employeeId}`, { policyId: created.policies[0], effectiveFrom: inDays(10) });
      expect(after.status).toBe(409);
      expect(after.body.error.code).toBe("HISTORY_CLOSED");
    });
  });

  describe("manual-entry branches (D4)", () => {
    it("lists holders: HR (company-wide) marks every branch; a manager only what's assigned", async () => {
      const holders = (await api(tok.hrAdmin).get("/manual-branches")).body.holders;
      expect(holders.find((h: { userId: string }) => h.userId === p.hrExec.userId)).toMatchObject({ allBranches: true });
      expect(holders.find((h: { userId: string }) => h.userId === p.mgr.userId)).toMatchObject({ allBranches: false, branches: [] });
    });

    it("assigns branches to a holder, audited; refuses someone without the permission", async () => {
      const res = await api(tok.hrAdmin).put(`/manual-branches/${p.mgr.userId}`, { locationIds: [org.locationId] });
      expect(res.status).toBe(200);
      expect(res.body.branches.map((b: { id: string }) => b.id)).toEqual([org.locationId]);
      expect(await audit("attendance.manual_branches.updated", p.mgr.userId)).not.toBeNull();
      const cleared = await api(tok.hrAdmin).put(`/manual-branches/${p.mgr.userId}`, { locationIds: [] });
      expect(cleared.body.branches).toEqual([]);
      const refused = await api(tok.hrAdmin).put(`/manual-branches/${p.emp.userId}`, { locationIds: [org.locationId] });
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe("PERMISSION_NOT_HELD");
    });
  });
});
