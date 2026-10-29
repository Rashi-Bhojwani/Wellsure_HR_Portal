import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { HR_CAPABILITIES, HR_CAPABILITY_IDS, SPLIT_KEYS } from "@shared/constants/hrCapabilities";
import { PERMISSION_KEYS } from "@shared/constants/permissions";
import { HR_FORBIDDEN_KEYS } from "@shared/constants/sensitiveData";
import { closeHrCapabilityQueue, hrCapabilityQueue } from "../../../jobs/hrCapabilityQueue";
import { purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { applyCapabilities, capabilityState, type SwitchRow } from "../../../lib/hrCapabilities";
import { resolveAccess } from "../../../lib/permissions";
import { prisma } from "../../../lib/prisma";
import { SYSTEM_ROLES } from "../../../lib/systemRoles";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";

// The HR capability switches (docs/plans/HR_CAPABILITIES.md §1B): what they say, who may change them, and that a change is in force on the very next request.

const at = (s: string) => new Date(s);
const row = (capability: string, subjectKind: string, subjectKey: string, state: string, effectiveFrom: string): SwitchRow => ({ capability, subjectKind, subjectKey, state, effectiveFrom: at(effectiveFrom) });
const NOW = at("2026-10-29T12:00:00Z");

describe("the catalog", () => {
  it("only names real permissions, never a hard-locked one, and has no key under two capabilities", () => {
    const all = HR_CAPABILITIES.flatMap((c) => [...c.keys]);
    for (const k of all) {
      expect((PERMISSION_KEYS as readonly string[]).includes(k), k).toBe(true);
      expect((HR_FORBIDDEN_KEYS as readonly string[]).includes(k), `${k} is hard-locked`).toBe(false);
    }
    expect(new Set(all).size).toBe(all.length);
    expect(HR_CAPABILITIES.map((c) => c.id)).toEqual([...HR_CAPABILITY_IDS]);
  });

  it("every split key is held by exactly the default roles that hold its parent", () => {
    for (const role of SYSTEM_ROLES.filter((r) => r.code !== "SUPER_ADMIN")) {
      for (const { child, parent } of SPLIT_KEYS) expect(role.permissions.includes(child), `${role.code} ${child}`).toBe(role.permissions.includes(parent));
    }
  });
});

describe("what the rows say", () => {
  const roles = ["HR_ADMIN"];
  it("no row, or a DEFAULT row, says nothing: the role's own permissions decide", () => {
    expect(capabilityState([], "APPROVE_LEAVE", "u1", roles, NOW)).toBeNull();
    expect(capabilityState([row("APPROVE_LEAVE", "ROLE", "HR_ADMIN", "OFF", "2026-10-01T00:00:00Z"), row("APPROVE_LEAVE", "ROLE", "HR_ADMIN", "DEFAULT", "2026-10-02T00:00:00Z")], "APPROVE_LEAVE", "u1", roles, NOW)).toBeNull();
  });

  it("the latest row in force wins for one subject; a row that has not started yet is ignored, and counts from its own moment", () => {
    const rows = [row("APPROVE_LEAVE", "ROLE", "HR_ADMIN", "OFF", "2026-10-01T00:00:00Z"), row("APPROVE_LEAVE", "ROLE", "HR_ADMIN", "ON", "2026-10-29T12:00:01Z")];
    expect(capabilityState(rows, "APPROVE_LEAVE", "u1", roles, NOW)).toBe("OFF");
    expect(capabilityState(rows, "APPROVE_LEAVE", "u1", roles, at("2026-10-29T12:00:01Z"))).toBe("ON"); // starts exactly then
    expect(capabilityState(rows, "APPROVE_LEAVE", "u1", roles, at("2026-10-29T12:00:00.999Z"))).toBe("OFF");
  });

  it("a named person beats the role, in both directions", () => {
    expect(capabilityState([row("EDIT_MUSTER", "ROLE", "HR_ADMIN", "OFF", "2026-10-01T00:00:00Z"), row("EDIT_MUSTER", "USER", "u1", "ON", "2026-10-02T00:00:00Z")], "EDIT_MUSTER", "u1", roles, NOW)).toBe("ON");
    expect(capabilityState([row("EDIT_MUSTER", "ROLE", "HR_ADMIN", "ON", "2026-10-01T00:00:00Z"), row("EDIT_MUSTER", "USER", "u1", "OFF", "2026-10-02T00:00:00Z")], "EDIT_MUSTER", "u1", roles, NOW)).toBe("OFF");
    // ...and only for that person.
    expect(capabilityState([row("EDIT_MUSTER", "ROLE", "HR_ADMIN", "OFF", "2026-10-01T00:00:00Z"), row("EDIT_MUSTER", "USER", "u1", "ON", "2026-10-02T00:00:00Z")], "EDIT_MUSTER", "u2", roles, NOW)).toBe("OFF");
  });

  it("at the same level, OFF beats ON: a person holding both HR roles", () => {
    const both = ["HR_ADMIN", "HR_EXECUTIVE"];
    const rows = [row("FINALISE_MONTH", "ROLE", "HR_ADMIN", "ON", "2026-10-01T00:00:00Z"), row("FINALISE_MONTH", "ROLE", "HR_EXECUTIVE", "OFF", "2026-10-01T00:00:00Z")];
    expect(capabilityState(rows, "FINALISE_MONTH", "u1", both, NOW)).toBe("OFF");
    expect(capabilityState(rows, "FINALISE_MONTH", "u1", ["HR_ADMIN"], NOW)).toBe("ON");
  });

  it("OFF removes the capability's keys, ON adds them, and a switch can never add a hard-locked key", () => {
    const keys = new Set(["attendance.view", "attendance.swipes.view", "leave.approve"]);
    applyCapabilities(keys, [row("VIEW_ATTENDANCE", "ROLE", "HR_ADMIN", "OFF", "2026-10-01T00:00:00Z"), row("FINALISE_MONTH", "ROLE", "HR_ADMIN", "ON", "2026-10-01T00:00:00Z")], "u1", roles, NOW);
    expect([...keys].sort()).toEqual(["attendance.finalise", "leave.approve"]);
    // Every capability ON for HR: still none of the locked keys.
    const all = new Set<string>();
    applyCapabilities(all, HR_CAPABILITIES.map((c) => row(c.id, "ROLE", "HR_ADMIN", "ON", "2026-10-01T00:00:00Z")), "u1", roles, NOW);
    expect([...all].filter((k) => (HR_FORBIDDEN_KEYS as readonly string[]).includes(k))).toEqual([]);
    expect(all.size).toBe(HR_CAPABILITIES.flatMap((c) => c.keys).length);
    // And whatever pay key a stale row put in the set is gone after the switches are applied.
    const stale = new Set(["payroll.run", "reports.liability.view", "attendance.view"]);
    applyCapabilities(stale, [], "u1", roles, NOW);
    expect([...stale]).toEqual(["attendance.view"]);
  });
});

describe("the switches, end to end", () => {
  let org: TestOrgMasters;
  const p = {} as Record<"director" | "hrAdmin" | "hrExec" | "hrExec2" | "employee" | "outsider", { employeeId: string; employeeCode: string; userId: string }>;
  const tok = {} as Record<keyof typeof p, string>;
  const put = (who: keyof typeof p, body: object) => request(app).put("/api/hr-capabilities").set(...authHeader(tok[who])).send(body);
  const get = (who: keyof typeof p, path: string) => request(app).get(path).set(...authHeader(tok[who]));
  const post = (who: keyof typeof p, path: string, body: object = {}) => request(app).post(path).set(...authHeader(tok[who])).send(body);
  const roleSwitch = (capability: string, roleCode: string, state: string, extra: object = {}) => put("director", { capability, subject: { kind: "ROLE", roleCode }, state, reason: "test", ...extra });
  const personSwitch = (capability: string, who: keyof typeof p, state: string) => put("director", { capability, subject: { kind: "USER", employeeId: p[who].employeeId }, state, reason: "test" });

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    p.director = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.hrAdmin = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.hrExec = await createFullTestEmployee(org, { roleCode: "HR_EXECUTIVE" });
    p.hrExec2 = await createFullTestEmployee(org, { roleCode: "HR_EXECUTIVE" });
    p.employee = await createFullTestEmployee(org);
    p.outsider = await createFullTestEmployee(org);
    for (const k of Object.keys(p) as Array<keyof typeof p>) tok[k] = await loginAs(p[k].employeeCode);
  });
  afterEach(async () => {
    await purgeAppendOnly("HrCapabilitySwitch", { createdByUserId: p.director.userId });
    await hrCapabilityQueue().obliterate({ force: true });
  });
  afterAll(async () => {
    await closeHrCapabilityQueue();
    for (const k of Object.keys(p) as Array<keyof typeof p>) await cleanupFullTestEmployee(p[k].employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("today's behaviour is the default: HR holds every switchable capability its role always held", async () => {
    const admin = await resolveAccess(p.hrAdmin.userId);
    for (const c of HR_CAPABILITIES) for (const k of c.keys) expect(admin.permissions.has(k), `${c.id} ${k}`).toBe(true);
    const exec = await resolveAccess(p.hrExec.userId);
    expect(exec.permissions.has("attendance.view")).toBe(true);
    expect(exec.permissions.has("attendance.finalise")).toBe(false); // an HR Executive never held it
    expect(exec.permissions.has("leave.approve")).toBe(true);
  });

  it("only a director can read or change the switches", async () => {
    for (const who of ["hrAdmin", "hrExec", "employee"] as const) {
      expect((await get(who, "/api/hr-capabilities")).status, who).toBe(403);
      expect((await put(who, { capability: "APPROVE_LEAVE", subject: { kind: "ROLE", roleCode: "HR_ADMIN" }, state: "OFF", reason: "not allowed" })).status, who).toBe(403);
    }
    expect((await get("director", "/api/hr-capabilities")).status).toBe(200);
    expect(await prisma.hrCapabilitySwitch.count({ where: { subjectKey: "HR_ADMIN" } })).toBe(0);
  });

  it("the database itself refuses a switch written by anyone who is not a Super Admin, and refuses to change or delete one", async () => {
    await expect(prisma.hrCapabilitySwitch.create({ data: { capability: "APPROVE_LEAVE", subjectKind: "ROLE", subjectKey: "HR_ADMIN", state: "OFF", effectiveFrom: new Date(), reason: "raw", createdByUserId: p.hrAdmin.userId } })).rejects.toThrow(/HR_SWITCHES_DIRECTORS_ONLY/);
    const made = await prisma.hrCapabilitySwitch.create({ data: { capability: "APPROVE_LEAVE", subjectKind: "ROLE", subjectKey: "HR_ADMIN", state: "OFF", effectiveFrom: new Date(), reason: "raw", createdByUserId: p.director.userId } });
    await expect(prisma.$executeRawUnsafe(`UPDATE "hr_capability_switches" SET "state" = 'ON' WHERE "id" = '${made.id}'`)).rejects.toThrow(/HR_SWITCHES_APPEND_ONLY/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "hr_capability_switches" WHERE "id" = '${made.id}'`)).rejects.toThrow(/HR_SWITCHES_APPEND_ONLY/);
    await expect(prisma.$executeRawUnsafe('TRUNCATE "hr_capability_switches"')).rejects.toThrow(/HR_SWITCHES_APPEND_ONLY/);
    await expect(prisma.hrCapabilitySwitch.create({ data: { capability: "APPROVE_LEAVE", subjectKind: "ROLE", subjectKey: "MANAGER", state: "OFF", effectiveFrom: new Date(), reason: "raw", createdByUserId: p.director.userId } })).rejects.toThrow();
  });

  it("refuses a missing reason, an unknown capability, a director as the target, and someone who holds no HR role", async () => {
    expect((await roleSwitch("APPROVE_LEAVE", "HR_ADMIN", "OFF", { reason: "" })).status).toBe(400);
    expect((await roleSwitch("PAYROLL_RUNS", "HR_ADMIN", "ON")).status).toBe(400);
    expect((await roleSwitch("APPROVE_LEAVE", "MANAGER", "OFF")).status).toBe(400);
    expect([(await personSwitch("APPROVE_LEAVE", "director", "OFF")).status, (await personSwitch("APPROVE_LEAVE", "director", "OFF")).body.error.code]).toEqual([409, "SWITCH_NOT_APPLICABLE"]);
    expect([(await personSwitch("APPROVE_LEAVE", "employee", "OFF")).status]).toEqual([409]);
    expect((await roleSwitch("APPROVE_LEAVE", "HR_ADMIN", "OFF", { effectiveFrom: "2020-01-01T00:00:00Z" })).status).toBe(400);
  });

  it("switching a role OFF takes effect on the very next request, for that role only, and ON (or DEFAULT) brings it back", async () => {
    expect((await get("hrAdmin", "/api/attendance/who-is-in")).status).toBe(200);
    expect((await roleSwitch("VIEW_ATTENDANCE", "HR_ADMIN", "OFF")).status).toBe(200);
    expect((await get("hrAdmin", "/api/attendance/who-is-in")).status).toBe(403); // the same token, the next request
    expect((await get("hrAdmin", `/api/attendance/employees/${p.employee.employeeId}/month?month=2026-10`)).status).toBe(403);
    expect((await get("hrAdmin", "/api/attendance/swipes")).status).toBe(403);
    expect((await get("hrExec", "/api/attendance/who-is-in")).status).toBe(200); // the other HR role is untouched
    expect((await get("director", "/api/attendance/who-is-in")).status).toBe(200); // a director is never affected
    expect((await get("employee", "/api/attendance/who-is-in")).status).toBe(403); // and a plain employee never had it
    expect((await roleSwitch("VIEW_ATTENDANCE", "HR_ADMIN", "DEFAULT")).status).toBe(200);
    expect((await get("hrAdmin", "/api/attendance/who-is-in")).status).toBe(200);
  });

  it("a named person beats the role, in both directions, and only that person is affected", async () => {
    // Role ON, one person OFF.
    await roleSwitch("FINALISE_MONTH", "HR_EXECUTIVE", "ON");
    expect((await get("hrExec", "/api/attendance/finalisation/periods")).status).toBe(200);
    expect((await get("hrExec2", "/api/attendance/finalisation/periods")).status).toBe(200);
    await personSwitch("FINALISE_MONTH", "hrExec2", "OFF");
    expect((await get("hrExec2", "/api/attendance/finalisation/periods")).status).toBe(403);
    expect((await get("hrExec", "/api/attendance/finalisation/periods")).status).toBe(200);
    // Role OFF (HR Admin), one person ON would need the person to hold an HR role: use the executive who is otherwise off.
    await roleSwitch("FINALISE_MONTH", "HR_EXECUTIVE", "OFF");
    await personSwitch("FINALISE_MONTH", "hrExec", "ON");
    expect((await get("hrExec", "/api/attendance/finalisation/periods")).status).toBe(200);
    expect((await get("hrExec2", "/api/attendance/finalisation/periods")).status).toBe(403);
  });

  it("each capability governs exactly its own routes: roster, exceptions, and the muster upload (which also needs Edit muster)", async () => {
    // Defaults: allowed in (a bad body is a 400, a missing permission a 403).
    expect((await post("hrAdmin", "/api/attendance/roster/preview")).status).toBe(400);
    expect((await get("hrAdmin", "/api/attendance/exceptions")).status).toBe(200);
    expect((await get("hrAdmin", "/api/attendance/muster/template?locationId=x")).status).not.toBe(403);
    await roleSwitch("SHIFT_ROSTER", "HR_ADMIN", "OFF");
    expect((await post("hrAdmin", "/api/attendance/roster/preview")).status).toBe(403);
    expect((await get("hrAdmin", "/api/attendance/exceptions")).status).toBe(200); // another capability, untouched
    await roleSwitch("EXCEPTIONS_QUEUE", "HR_ADMIN", "OFF");
    expect((await get("hrAdmin", "/api/attendance/exceptions")).status).toBe(403);
    await roleSwitch("UPLOAD_MANUAL_MUSTER", "HR_ADMIN", "OFF");
    expect((await get("hrAdmin", "/api/attendance/muster/template?locationId=x")).status).toBe(403);
    expect((await post("hrAdmin", "/api/attendance/muster/mark-present", {})).status).not.toBe(403); // Edit muster is still on
    await roleSwitch("UPLOAD_MANUAL_MUSTER", "HR_ADMIN", "DEFAULT");
    await roleSwitch("EDIT_MUSTER", "HR_ADMIN", "OFF");
    expect((await get("hrAdmin", "/api/attendance/muster/template?locationId=x")).status).toBe(403); // upload is a form of editing
    expect((await post("hrAdmin", "/api/attendance/muster/entries", {})).status).toBe(403);
  });

  it("approving leave and regularizations are separate, and corrections cover both bulk correction and manual override", async () => {
    expect((await get("hrAdmin", "/api/attendance/regularizations")).status).toBe(200);
    await roleSwitch("APPROVE_REGULARIZATIONS", "HR_ADMIN", "OFF");
    expect((await get("hrAdmin", "/api/attendance/regularizations")).status).toBe(403);
    expect((await post("hrAdmin", "/api/attendance/regularizations/some-id/approve")).status).toBe(403);
    const access = await resolveAccess(p.hrAdmin.userId);
    expect(access.permissions.has("leave.approve")).toBe(true);
    await roleSwitch("APPROVE_LEAVE", "HR_ADMIN", "OFF");
    expect((await resolveAccess(p.hrAdmin.userId)).permissions.has("leave.approve")).toBe(false);
    expect((await resolveAccess(p.hrAdmin.userId)).permissions.has("leave.view")).toBe(true); // seeing leave is not "approve leave"
    const lop = await prisma.leaveType.findFirstOrThrow({ where: { code: "LOP" } });
    const pending = await prisma.leaveRequest.create({ data: { employeeId: p.employee.employeeId, leaveTypeId: lop.id, fromDate: new Date("2026-11-02T00:00:00Z"), toDate: new Date("2026-11-02T00:00:00Z"), totalDays: 1, status: "PENDING", appliedByUserId: p.employee.userId } });
    try {
      const refused = await post("hrAdmin", `/api/leave/requests/${pending.id}/approve`);
      expect([refused.status, refused.body.error.message]).toEqual([403, "Missing permission: leave.approve"]);
      expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("PENDING"); // nothing happened to it
      expect((await post("hrExec", `/api/leave/requests/${pending.id}/approve`)).status).toBe(200); // the other HR role still can
    } finally {
      await prisma.leaveRequest.deleteMany({ where: { id: pending.id } });
    }
    await roleSwitch("CORRECTIONS", "HR_ADMIN", "OFF");
    expect((await post("hrAdmin", "/api/attendance/overrides/preview")).status).toBe(403);
    expect((await post("hrAdmin", "/api/attendance/regularizations/bulk/preview")).status).toBe(403);
  });

  it("switching everything ON for HR gives it no pay data: the hard lock is stripped last", async () => {
    for (const c of HR_CAPABILITIES) await roleSwitch(c.id, "HR_EXECUTIVE", "ON");
    const a = await resolveAccess(p.hrExec.userId);
    expect([...a.permissions].filter((k) => (HR_FORBIDDEN_KEYS as readonly string[]).includes(k))).toEqual([]);
    for (const path of ["/api/payroll/runs", "/api/payroll/salary/employees", "/api/payroll/rules"]) expect((await get("hrExec", path)).status, path).toBe(403);
    expect((await get("hrExec", "/api/attendance/finalisation/periods")).status).toBe(200); // ON did give it what it asked for
  });

  it("writes nothing when nothing changes, and records who, why and when otherwise", async () => {
    expect((await roleSwitch("APPROVE_LEAVE", "HR_ADMIN", "DEFAULT")).body.changed).toBe(false);
    expect((await roleSwitch("APPROVE_LEAVE", "HR_ADMIN", "OFF", { reason: "Directors will approve leave themselves this quarter" })).body.changed).toBe(true);
    expect((await roleSwitch("APPROVE_LEAVE", "HR_ADMIN", "OFF")).body.changed).toBe(false);
    const history = await get("director", "/api/hr-capabilities/history?capability=APPROVE_LEAVE");
    expect(history.body.rows).toHaveLength(1);
    expect(history.body.rows[0]).toMatchObject({ capability: "APPROVE_LEAVE", state: "OFF", reason: "Directors will approve leave themselves this quarter", subject: { roleCode: "HR_ADMIN" }, changedBy: { employeeCode: p.director.employeeCode } });
    const audit = await prisma.auditLog.findFirst({ where: { action: "hr.capability.switched", actorUserId: p.director.userId }, orderBy: { createdAt: "desc" } });
    expect(audit?.after).toMatchObject({ capability: "APPROVE_LEAVE", state: "OFF", reason: "Directors will approve leave themselves this quarter" });
  });

  it("a switch planned for later changes nothing until its moment", async () => {
    const later = new Date(Date.now() + 3600_000).toISOString(); // allow-clock: an instant
    const r = await roleSwitch("VIEW_ATTENDANCE", "HR_ADMIN", "OFF", { effectiveFrom: later });
    expect([r.status, r.body.changed]).toEqual([200, true]);
    expect((await get("hrAdmin", "/api/attendance/who-is-in")).status).toBe(200);
    const view = (await get("director", "/api/hr-capabilities")).body.capabilities.find((c: { id: string }) => c.id === "VIEW_ATTENDANCE");
    expect(view.roles.find((x: { roleCode: string }) => x.roleCode === "HR_ADMIN")).toMatchObject({ state: "DEFAULT", pending: { state: "OFF" } });
    // (That the row takes effect at its own moment is the pure-function test above: nothing is cached or scheduled for access itself.)
  });
});
