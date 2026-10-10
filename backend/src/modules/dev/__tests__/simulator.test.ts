import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiMountsFor } from "../../../app";
import { prisma } from "../../../lib/prisma";
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
import { computeAttendance } from "../../attendance/compute";

// The punch simulator's read-only helpers (P2-G G2): what the roster says about
// the people it can plan, who it refuses to plan and why, who may ask, and that
// none of it exists in a production build.
describe("dev simulator endpoints", () => {
  let org: TestOrgMasters;
  const people = {} as Record<"hr" | "emp" | "plain" | "moved" | "penalty", { employeeId: string; employeeCode: string; userId: string }>;
  let hrToken = "";
  let empToken = "";
  const from = "2026-09-07";
  const to = "2026-09-13";
  let penaltyPolicyId = "";

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    for (const k of ["hr", "emp", "plain", "moved", "penalty"] as const) people[k] = await createFullTestEmployee(org, { roleCode: k === "hr" ? "HR_ADMIN" : "EMPLOYEE" });
    hrToken = await loginAs(people.hr.employeeCode);
    empToken = await loginAs(people.emp.employeeCode);
    // "moved" changes shift inside the range; "penalty" is on a policy the simulator does not model.
    await prisma.attendanceAssignment.updateMany({ where: { employeeId: people.moved.employeeId }, data: { effectiveTo: new Date("2026-09-10") } });
    await prisma.attendanceAssignment.create({
      data: {
        employeeId: people.moved.employeeId,
        shiftId: "shift_gen",
        weekOffPatternId: "wop_sun",
        policyId: "policy_default",
        effectiveFrom: new Date("2026-09-10"),
        createdByUserId: people.hr.userId,
      },
    });
    const policy = await prisma.attendancePolicy.create({
      data: { code: `DEV-PEN-${Date.now().toString(36)}`, name: "with penalties", fullDayMinMinutes: 420, halfDayMinMinutes: 240, penaltyRules: [{ x: 1 }] },
    });
    penaltyPolicyId = policy.id;
    await prisma.attendanceAssignment.updateMany({ where: { employeeId: people.penalty.employeeId }, data: { policyId: penaltyPolicyId } });
    await computeAttendance([people.plain.employeeId], from, to);
  });

  afterAll(async () => {
    for (const k of Object.keys(people) as Array<keyof typeof people>) await cleanupFullTestEmployee(people[k].employeeId);
    const { deleteWithDependents } = await import("../../../lib/__tests__/cleanup");
    await deleteWithDependents("AttendancePolicy", [penaltyPolicyId]);
    await cleanupEmployeeTestOrgMasters(org);
  });

  const get = (path: string, token: string) =>
    request(app)
      .get(path)
      .set(...authHeader(token));

  it("is read-only help for people who manage devices, nobody else", async () => {
    expect((await request(app).get(`/api/dev/simulator/roster?from=${from}&to=${to}`)).status).toBe(401);
    expect((await get(`/api/dev/simulator/roster?from=${from}&to=${to}`, empToken)).status).toBe(403);
    expect((await get(`/api/dev/simulator/days?from=${from}&to=${to}&codes=x`, empToken)).status).toBe(403);
    expect((await get(`/api/dev/simulator/roster?from=${to}&to=${from}`, hrToken)).status).toBe(400);
    expect((await get(`/api/dev/simulator/roster?from=2026-01-01&to=2026-12-31`, hrToken)).status).toBe(400);
  });

  it("describes a person the simulator can plan, with the shift, policy and week-off that apply", async () => {
    const r = await get(`/api/dev/simulator/roster?from=${from}&to=${to}&seed=7`, hrToken);
    expect(r.status).toBe(200);
    expect(r.body.appEnv).toBe("development");
    const roster = r.body.roster;
    expect(roster.seed).toBe(7);
    const me = roster.employees.find((e: { code: string }) => e.code === people.plain.employeeCode);
    expect(me).toMatchObject({ deviceUserId: people.plain.employeeCode, shift: "GEN", policy: "DEFAULT", weekOff: "SUN", capture: "DEVICE" });
    const gen = roster.masters.shifts.find((s: { code: string }) => s.code === "GEN");
    expect(gen.sessions.length).toBeGreaterThanOrEqual(3);
    expect(roster.masters.policies.find((p: { code: string }) => p.code === "DEFAULT")).toBeTruthy();
    expect(roster.masters.weekOffs.find((w: { code: string }) => w.code === "SUN")).toBeTruthy();
  });

  it("names the people it will not plan and why, rather than planning them wrongly", async () => {
    const r = await get(`/api/dev/simulator/roster?from=${from}&to=${to}`, hrToken);
    const codes = r.body.roster.employees.map((e: { code: string }) => e.code);
    expect(codes).not.toContain(people.moved.employeeCode);
    expect(codes).not.toContain(people.penalty.employeeCode);
    const why = (c: string) => r.body.skipped.find((s: { employeeCode: string }) => s.employeeCode === c)?.reason as string;
    expect(why(people.moved.employeeCode)).toMatch(/changes inside this range/);
    expect(why(people.penalty.employeeCode)).toMatch(/penalty rules/);
  });

  it("returns the stored days in the replay's vocabulary", async () => {
    const r = await get(`/api/dev/simulator/days?from=${from}&to=${to}&codes=${people.plain.employeeCode}`, hrToken);
    expect(r.status).toBe(200);
    const sunday = r.body.days[`${people.plain.employeeCode}|2026-09-13`];
    expect(sunday).toMatchObject({ status: "O", source: "WEEK_OFF", capture: "DEVICE", flags: [], shiftCode: "GEN" });
    const monday = r.body.days[`${people.plain.employeeCode}|2026-09-07`];
    expect(monday.status).toBe("A");
    expect(Object.keys(monday)).toEqual(expect.arrayContaining(["lateInMinutes", "actualMinutes", "collapsedPunches", "outsideWindowPunches", "firstIn"]));
  });

  it("does not exist in a production build: the path is a plain 404", () => {
    const has = (env: string) => apiMountsFor(env).some((m) => m.path.startsWith("/api/dev"));
    expect(has("production")).toBe(false);
    expect(has("development")).toBe(true);
    expect(has("staging")).toBe(true);
  });
});
