import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OFFICE_GRANT_REASON } from "@shared/constants/peeps";
import { SENSITIVE_PERMISSION_KEYS } from "@shared/constants/sensitiveData";
import { purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { resolveAccess } from "../../../lib/permissions";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { listApiRoutes } from "../../managers/__tests__/routeList";
import { applyDueChanges, currentMembers, officeGrantDrift } from "../office";
import { appoint, clearPeepsSettings, directorActor, removeMember } from "./peepsTestKit";
import { proposeChange, confirmChange } from "../office";

// The Wellsure Office workspace (D-30): membership proposed by a director and confirmed by a different one, applied as labelled per-person grants (at once
// or by the scheduled job), re-appointment moving the grants in one step, drift detection, and the refusal of HR, managers, non-members and the
// Developer on every office route. Members never reach pay, bank or statutory data.

type Who = "director" | "director2" | "member" | "member2" | "hrAdmin" | "hrExec" | "manager" | "employee" | "developer";
type Person = { employeeId: string; employeeCode: string; userId: string };

const OFFICE_ROUTES: Array<[string, string, object?]> = [
  ["GET", "/api/peeps/settings"],
  ["POST", "/api/peeps/settings/unmute.sessionMinutes", { value: 30 }],
  ["POST", "/api/peeps/settings/unmute.sessionMinutes/confirm", { version: 1 }],
  ["GET", "/api/peeps/office/members"],
  ["GET", "/api/peeps/office/people?q="],
  ["GET", "/api/peeps/office/drift"],
  ["POST", "/api/peeps/office/changes", {}],
  ["POST", "/api/peeps/office/changes/x/confirm", {}],
  ["GET", "/api/unmute/host/slots"],
  ["POST", "/api/unmute/host/slots", {}],
  ["POST", "/api/unmute/host/slots/x/withdraw", {}],
  ["POST", "/api/unmute/host/bookings/x/cancel", {}],
  ["POST", "/api/unmute/host/bookings/x/complete", {}],
  ["GET", "/api/unmute/admin/hosts"],
  ["POST", "/api/unmute/admin/hosts", {}],
  ["POST", "/api/unmute/admin/hosts/x/revoke", {}],
  ["GET", "/api/unmute/admin/bookings"],
  ["GET", "/api/unmute/admin/bookings/x"],
  ["GET", "/api/unmute/admin/affected"],
  ["GET", "/api/unmute/admin/free-slots"],
  ["POST", "/api/unmute/admin/bookings/x/reassign", {}],
  ["POST", "/api/unmute/admin/bookings/x/cancel", {}],
  ["GET", "/api/assets"],
  ["GET", "/api/assets/lists"],
  ["GET", "/api/assets/settings"],
  ["POST", "/api/assets", {}],
];

describe("Wellsure Office workspace", () => {
  let org: TestOrgMasters;
  const p = {} as Record<Who, Person>;
  const tok = {} as Record<Who, string>;
  const call = (who: Who, method: string, path: string, body?: object) => {
    const r = method === "GET" ? request(app).get(path) : request(app).post(path).send(body ?? {});
    return r.set(...authHeader(tok[who]));
  };
  const grants = async (who: Who) => (await prisma.userPermissionOverride.findMany({ where: { userId: p[who].userId, reason: OFFICE_GRANT_REASON }, include: { permission: true } })).map((o) => o.permission.key).sort();

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    p.director = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.director2 = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.member = await createFullTestEmployee(org);
    p.member2 = await createFullTestEmployee(org);
    p.hrAdmin = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.hrExec = await createFullTestEmployee(org, { roleCode: "HR_EXECUTIVE" });
    p.manager = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    p.employee = await createFullTestEmployee(org);
    p.developer = await createFullTestEmployee(org, { roleCode: "DEVELOPER" });
    for (const k of Object.keys(p) as Who[]) tok[k] = await loginAs(p[k].employeeCode);
  });

  afterAll(async () => {
    await clearPeepsSettings();
    const changeIds = (await prisma.officeMembershipChange.findMany({ where: { employeeId: { in: Object.values(p).map((x) => x.employeeId) } }, select: { id: true } })).map((c) => c.id);
    await purgeAppendOnly("AuditLog", { entityId: { in: changeIds } });
    for (const k of Object.keys(p) as Who[]) await cleanupFullTestEmployee(p[k].employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  describe("membership", () => {
    it("only a director proposes; the same director cannot confirm; a different director confirms and the grants appear at once, labelled", async () => {
      for (const who of ["hrAdmin", "manager", "employee", "developer"] as const) {
        expect((await call(who, "POST", "/api/peeps/office/changes", { kind: "APPOINT", employeeId: p.member.employeeId, capabilities: ["MANAGE_ASSETS"], reason: "test" })).status, who).toBe(403);
      }
      const proposed = await call("director", "POST", "/api/peeps/office/changes", { kind: "APPOINT", employeeId: p.member.employeeId, capabilities: ["MANAGE_ASSETS", "PREPARE_SETTINGS"], reason: "test appointment" });
      expect(proposed.status, JSON.stringify(proposed.body)).toBe(201);
      expect(await grants("member")).toEqual([]); // nothing before confirmation
      expect((await call("director", "POST", `/api/peeps/office/changes/${proposed.body.id}/confirm`)).status).toBe(403);
      const confirmed = await call("director2", "POST", `/api/peeps/office/changes/${proposed.body.id}/confirm`);
      expect(confirmed.body).toEqual({ applied: true });
      expect(await grants("member")).toEqual(["assets.manage", "assets.settings.manage", "assets.view", "office.workspace", "peeps.settings.manage"]);
      expect((await resolveAccess(p.member.userId)).permissions.has("office.workspace")).toBe(true);
      expect((await call("member", "GET", "/api/peeps/me")).body).toMatchObject({ isMember: true, isDirector: false, officeName: "Wellsure Office" });
      expect((await call("employee", "GET", "/api/peeps/me")).body).toMatchObject({ isMember: false });
      expect(await officeGrantDrift()).toEqual([]);
      const audit = await prisma.auditLog.findMany({ where: { entityId: proposed.body.id } });
      expect(audit.map((a) => a.action).sort()).toEqual(["office.membership.applied", "office.membership.confirmed", "office.membership.proposed"]);
    });

    it("the database refuses a non-director proposal, a same-director confirmation and applying an unconfirmed change", async () => {
      await expect(prisma.officeMembershipChange.create({ data: { kind: "APPOINT", employeeId: p.employee.employeeId, effectiveFrom: new Date(), reason: "raw", proposedByUserId: p.hrAdmin.userId } })).rejects.toThrow(/OFFICE_DIRECTORS_ONLY/);
      const raw = await prisma.officeMembershipChange.create({ data: { kind: "APPOINT", employeeId: p.employee.employeeId, effectiveFrom: new Date(), reason: "raw", proposedByUserId: p.director.userId } });
      await expect(prisma.officeMembershipApplication.create({ data: { changeId: raw.id, grantsAdded: 0, grantsRemoved: 0 } })).rejects.toThrow(/OFFICE_NOT_CONFIRMED/);
      await expect(prisma.officeMembershipConfirmation.create({ data: { changeId: raw.id, confirmedByUserId: p.director.userId } })).rejects.toThrow(/OFFICE_SAME_DIRECTOR/);
      await expect(prisma.officeMembershipChange.update({ where: { id: raw.id }, data: { reason: "rewritten" } })).rejects.toThrow(/PEEPS_APPEND_ONLY/);
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SELECT set_config('app.audit_purge', 'test', true)");
        await tx.officeMembershipChange.delete({ where: { id: raw.id } });
      });
    });

    it("a dated change waits for its time and is applied by the scheduled job, once", async () => {
      const at = new Date(Date.now() + 3_600_000);
      const change = await proposeChange({ kind: "UPDATE", employeeId: p.member.employeeId, capabilities: ["MANAGE_ASSETS", "PREPARE_SETTINGS", "GIVE_BADGES"], effectiveFrom: at.toISOString(), reason: "dated" }, directorActor(p.director), { actorUserId: p.director.userId, ipAddress: null, userAgent: null });
      expect((await confirmChange(change.id, directorActor(p.director2), { actorUserId: p.director2.userId, ipAddress: null, userAgent: null })).applied).toBe(false);
      expect(await grants("member")).not.toContain("badges.give");
      expect(await applyDueChanges(new Date())).toBe(0);
      expect(await applyDueChanges(new Date(at.getTime() + 1000))).toBe(1);
      expect(await applyDueChanges(new Date(at.getTime() + 2000))).toBe(0);
      expect(await grants("member")).toContain("badges.give");
    });

    it("re-appointing moves the capabilities and grants from one person to another in one step", async () => {
      const before = await grants("member");
      const change = await call("director", "POST", "/api/peeps/office/changes", { kind: "REPLACE", fromEmployeeId: p.member.employeeId, employeeId: p.member2.employeeId, reason: "handover" });
      expect(change.status, JSON.stringify(change.body)).toBe(201);
      await call("director2", "POST", `/api/peeps/office/changes/${change.body.id}/confirm`);
      expect(await grants("member")).toEqual([]);
      expect(await grants("member2")).toEqual(before);
      const members = await currentMembers();
      expect(members.has(p.member.employeeId)).toBe(false);
      expect(members.has(p.member2.employeeId)).toBe(true);
      // and back again, for the tests below
      const back = await proposeChange({ kind: "REPLACE", fromEmployeeId: p.member2.employeeId, employeeId: p.member.employeeId, reason: "back" }, directorActor(p.director), { actorUserId: p.director.userId, ipAddress: null, userAgent: null });
      await confirmChange(back.id, directorActor(p.director2), { actorUserId: p.director2.userId, ipAddress: null, userAgent: null });
      expect(await grants("member")).toEqual(before);
    });

    it("drift: a labelled grant removed by hand, or an office key granted to a non-member, is reported", async () => {
      const row = await prisma.userPermissionOverride.findFirstOrThrow({ where: { userId: p.member.userId, reason: OFFICE_GRANT_REASON, permission: { key: "office.workspace" } } });
      await prisma.userPermissionOverride.delete({ where: { id: row.id } });
      const perm = await prisma.permission.findUniqueOrThrow({ where: { key: "office.workspace" } });
      await prisma.userPermissionOverride.create({ data: { userId: p.employee.userId, permissionId: perm.id, effect: "GRANT", reason: "given by hand", createdByUserId: p.director.userId } });
      const drift = await officeGrantDrift();
      expect(drift).toContainEqual({ employeeId: p.member.employeeId, key: "office.workspace", problem: "MISSING" });
      expect(drift).toContainEqual({ employeeId: p.employee.employeeId, key: "office.workspace", problem: "UNEXPECTED" });
      // A grant made by hand opens nothing: the routes check the membership.
      const employeeTok = await loginAs(p.employee.employeeCode);
      expect((await request(app).get("/api/peeps/settings").set(...authHeader(employeeTok))).status).toBe(403);
      await prisma.userPermissionOverride.deleteMany({ where: { userId: p.employee.userId, permissionId: perm.id } });
      await prisma.userPermissionOverride.create({ data: { userId: p.member.userId, permissionId: perm.id, effect: "GRANT", reason: OFFICE_GRANT_REASON, createdByUserId: p.director2.userId } });
      expect(await officeGrantDrift()).toEqual([]);
    });
  });

  describe("who reaches the workspace", () => {
    it("HR, a manager, a non-member employee and the Developer are refused on every office route", async () => {
      for (const who of ["hrAdmin", "hrExec", "manager", "employee", "developer"] as const) {
        for (const [method, path, body] of OFFICE_ROUTES) expect((await call(who, method, path, body)).status, `${who} ${method} ${path}`).toBe(403);
      }
    });

    it("the directors reach every office route", async () => {
      // The confirm route is tried by the other director: the one who entered a setting is refused confirming it, by design. The /host/* routes are a
      // host acting on their own slots (a director is not a host); the directors see every slot and booking through /admin/* (unmute.test.ts).
      for (const [method, path, body] of OFFICE_ROUTES.filter(([, path]) => !path.startsWith("/api/unmute/host/"))) expect((await call(path.endsWith("/confirm") && path.includes("/settings/") ? "director2" : "director", method, path, body)).status, `${method} ${path}`).not.toBe(403);
    });

    it("a removed member is refused at once and loses the grants", async () => {
      await removeMember(p.member2.employeeId, p.director, p.director2).catch(() => undefined); // not a member: nothing to remove
      await appoint(p.member2.employeeId, [], p.director, p.director2);
      expect((await call("member2", "GET", "/api/peeps/settings")).status).toBe(200);
      await removeMember(p.member2.employeeId, p.director, p.director2);
      expect((await call("member2", "GET", "/api/peeps/settings")).status).toBe(403);
      expect(await grants("member2")).toEqual([]);
    });
  });

  describe("no pay, bank or statutory data for members", () => {
    it("a member holds no sensitive key, and every route gated by one refuses them; the reveal routes refuse them for anyone", async () => {
      await appoint(p.member2.employeeId, ["MANAGE_ASSETS", "PREPARE_SETTINGS", "GIVE_BADGES", "SEND_NUDGES"], p.director, p.director2);
      const tokMember = await loginAs(p.member2.employeeCode);
      const access = await resolveAccess(p.member2.userId);
      expect([...access.permissions].filter((k) => SENSITIVE_PERMISSION_KEYS.includes(k as never))).toEqual([]);
      const sensitive = new Set<string>(SENSITIVE_PERMISSION_KEYS);
      const gated = listApiRoutes().filter((r) => r.gateKeys.length > 0 && r.gateKeys.every((k) => sensitive.has(k)));
      expect(gated.length).toBeGreaterThan(10);
      for (const r of gated) {
        const [method, path] = r.id.split(" ") as [string, string];
        const url = path.replace(/:[A-Za-z]+/g, p.employee.employeeId);
        const res = await (method === "GET" ? request(app).get(url) : method === "DELETE" ? request(app).delete(url) : method === "PATCH" ? request(app).patch(url).send({}) : method === "PUT" ? request(app).put(url).send({}) : request(app).post(url).send({})).set(...authHeader(tokMember));
        expect(res.status, r.id).toBe(403);
      }
      for (const path of [`/api/employees/${p.employee.employeeId}/bank/reveal?reason=test`, `/api/employees/${p.employee.employeeId}/statutory/reveal?reason=test`]) {
        expect((await request(app).get(path).set(...authHeader(tokMember))).status, path).toBe(403);
      }
    });
  });
});
