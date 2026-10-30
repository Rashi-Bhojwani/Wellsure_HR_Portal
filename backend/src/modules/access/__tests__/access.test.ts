import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MANAGER_GRANTABLE_KEYS, PERMISSION_KEYS } from "@shared/constants/permissions";
import { ensureAccessCatalog } from "../../../lib/accessCatalog";
import { resolveAccess } from "../../../lib/permissions";
import { prisma } from "../../../lib/prisma";
import { getSocketServer, setSocketServer, type RoomEmitter } from "../../../realtime/emit";
import { processScheduledSeparations } from "../../employee/separations";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupEmployeesByCode,
  cleanupFullTestEmployee,
  cleanupTestRole,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  grantPermissions,
  loginAs,
  type TestOrgMasters,
} from "../../employee/__tests__/employeeTestHelpers";
import { purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { AdminCliRefusal, assertBootstrapAllowed, bootstrapSuperAdmin, provisionSuperAdmin } from "../bootstrap";

// Roles & permissions (Phase 5 commit E1) — rules 1–8 of docs/plans/PHASE_5.md §E1.
// Uses the SEEDED system roles, so the matrix under test is the real one.
// Role definitions are only ever edited on a throwaway test role.
type Person = { employeeId: string; employeeCode: string; userId: string };
const RAW_ROLE = "TEST_RAW_BANK_VIEW_ALL";

describe("Roles & permissions (E1)", () => {
  let org: TestOrgMasters;
  const people = {} as Record<"sa" | "sa2" | "hrAdmin" | "manager" | "employee", Person>;
  const tokens = {} as Record<"sa" | "hrAdmin" | "manager" | "employee", string>;
  const TEST_ROLE = `E1TEST_${randomUUID().slice(0, 6).toUpperCase()}`;
  const extraEmployeeCodes: string[] = [];

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    people.sa = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    people.sa2 = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    people.hrAdmin = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    people.manager = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    people.employee = await createFullTestEmployee(org, { roleCode: "EMPLOYEE" });
    for (const k of ["sa", "hrAdmin", "manager", "employee"] as const) tokens[k] = await loginAs(people[k].employeeCode);
    await prisma.role.create({ data: { code: TEST_ROLE, name: "E1 test role", dataScope: "SELF" } });
  });

  afterAll(async () => {
    // Test Super Admins are deleted while the seeded ones are active again,
    // so the last-Super-Admin triggers never see a drop to zero.
    for (const p of Object.values(people)) await cleanupFullTestEmployee(p.employeeId);
    await cleanupEmployeesByCode(extraEmployeeCodes);
    await cleanupTestRole(TEST_ROLE);
    await cleanupEmployeeTestOrgMasters(org);
  });

  const api = (token: string) => ({
    get: (p: string) => request(app).get(p).set(...authHeader(token)),
    put: (p: string, b: object) => request(app).put(p).set(...authHeader(token)).send(b),
    post: (p: string, b: object = {}) => request(app).post(p).set(...authHeader(token)).send(b),
    del: (p: string, b: object = {}) => request(app).delete(p).set(...authHeader(token)).send(b),
  });
  const auditCount = (action: string, entityId: string) => prisma.auditLog.count({ where: { action, entityId } });

  // ── Resolution ─────────────────────────────────────────────────────────

  describe("access resolution", () => {
    it("a Super Admin holds every permission with scope ALL, computed in code — even with the role's rows deleted", async () => {
      const role = await prisma.role.findUniqueOrThrow({ where: { code: "SUPER_ADMIN" }, include: { permissions: true } });
      const saved = role.permissions.map((p) => ({ roleId: p.roleId, permissionId: p.permissionId }));
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
      try {
        const a = await resolveAccess(people.sa.userId);
        expect(a.isSuperAdmin).toBe(true);
        expect([...a.permissions].sort()).toEqual([...PERMISSION_KEYS].sort());
        expect(a.dataScope).toBe("ALL");
      } finally {
        await prisma.rolePermission.createMany({ data: saved, skipDuplicates: true });
      }
    });

    it("everyone else: union of roles, plus GRANTs, minus REVOKEs (a revoke beats a role), widest scope across roles", async () => {
      const u = people.employee.userId;
      const perm = (key: string) => prisma.permission.findUniqueOrThrow({ where: { key } });
      const approver = await prisma.role.findUniqueOrThrow({ where: { code: "APPROVER" } }); // leave.approve + leave.view, scope ALL
      await prisma.userRole.create({ data: { userId: u, roleId: approver.id } });
      try {
        let a = await resolveAccess(u);
        expect(a.dataScope).toBe("ALL"); // EMPLOYEE (SELF) + APPROVER (ALL) → widest
        expect(a.permissions.has("leave.view")).toBe(true);
        await prisma.userPermissionOverride.createMany({
          data: [
            { userId: u, permissionId: (await perm("leave.view")).id, effect: "REVOKE", reason: "test", createdByUserId: people.sa.userId },
            { userId: u, permissionId: (await perm("helpdesk.manage")).id, effect: "GRANT", reason: "test", createdByUserId: people.sa.userId },
          ],
        });
        a = await resolveAccess(u);
        expect(a.permissions.has("leave.view")).toBe(false);
        expect(a.permissions.has("helpdesk.manage")).toBe(true);
      } finally {
        await prisma.userPermissionOverride.deleteMany({ where: { userId: u } });
        await prisma.userRole.delete({ where: { userId_roleId: { userId: u, roleId: approver.id } } });
      }
    });

    it("E2: a manager's access is clipped to the manager-grantable list and TEAM scope, whatever the rows say", async () => {
      const u = people.manager.userId;
      const perm = (key: string) => prisma.permission.findUniqueOrThrow({ where: { key } });
      // A role with bank view and leave view at scope ALL (it used to be PAYROLL_ADMIN; the payroll roles are for directors only and the database refuses them here).
      await grantPermissions(RAW_ROLE, ["employee.bank.view", "leave.view"]);
      await prisma.role.update({ where: { code: RAW_ROLE }, data: { dataScope: "ALL" } });
      const payroll = await prisma.role.findUniqueOrThrow({ where: { code: RAW_ROLE } });
      // Raw rows the API would refuse: another role, and a non-grantable GRANT.
      await prisma.userRole.create({ data: { userId: u, roleId: payroll.id } });
      await prisma.userPermissionOverride.create({ data: { userId: u, permissionId: (await perm("helpdesk.manage")).id, effect: "GRANT", reason: "raw", createdByUserId: people.sa.userId } });
      try {
        const a = await resolveAccess(u);
        expect(a.dataScope).toBe("TEAM");
        expect(a.permissions.has("employee.bank.view")).toBe(false);
        expect(a.permissions.has("helpdesk.manage")).toBe(false);
        expect([...a.permissions].every((k) => (MANAGER_GRANTABLE_KEYS as readonly string[]).includes(k))).toBe(true);
        expect(a.permissions.has("leave.view")).toBe(true); // grantable (from the raw role row), so it survives the cap
        expect(a.permissions.has("leave.approve")).toBe(false); // nothing grants it: the MANAGER role itself is empty (2026-10-03)
      } finally {
        await prisma.userPermissionOverride.deleteMany({ where: { userId: u } });
        await prisma.userRole.delete({ where: { userId_roleId: { userId: u, roleId: payroll.id } } });
        await cleanupTestRole(RAW_ROLE);
      }
    });

    it("an override on a Super Admin changes nothing (and the API refuses to create one)", async () => {
      const res = await api(tokens.hrAdmin).put(`/api/access/employees/${people.sa.employeeId}/overrides/leave.view`, { effect: "REVOKE", reason: "should fail" });
      expect(res.status).toBe(403);
      const p = await prisma.permission.findUniqueOrThrow({ where: { key: "leave.view" } });
      await prisma.userPermissionOverride.create({ data: { userId: people.sa2.userId, permissionId: p.id, effect: "REVOKE", reason: "raw row", createdByUserId: people.sa.userId } });
      try {
        expect((await resolveAccess(people.sa2.userId)).permissions.has("leave.view")).toBe(true);
      } finally {
        await prisma.userPermissionOverride.deleteMany({ where: { userId: people.sa2.userId } });
      }
    });
  });

  // ── Role definitions (rules 1–4) ──────────────────────────────────────

  describe("role definitions", () => {
    it("lists roles; Super Admin shows every permission and is locked; role.view may read, others may not", async () => {
      expect((await api(tokens.hrAdmin).get("/api/access/roles")).status).toBe(403); // Stage 1: who holds which role is a director's to see, not HR's
      const res = await api(tokens.sa).get("/api/access/roles");
      expect(res.status).toBe(200);
      const sa = res.body.roles.find((r: { code: string }) => r.code === "SUPER_ADMIN");
      expect(sa.locked).toBe(true);
      expect(sa.dataScope).toBe("ALL");
      expect(sa.permissions.length).toBe(PERMISSION_KEYS.length);
      expect((await api(tokens.manager).get("/api/access/roles")).status).toBe(403);
      expect((await api(tokens.employee).get("/api/access/roles")).status).toBe(403);
    });

    it("rule 1: nobody — not even a Super Admin — can edit the Super Admin role", async () => {
      const res = await api(tokens.sa).put("/api/access/roles/SUPER_ADMIN", { dataScope: "SELF" });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("SUPER_ADMIN_LOCKED");
    });

    it("rule 2: only a Super Admin changes a role", async () => {
      const res = await api(tokens.hrAdmin).put(`/api/access/roles/${TEST_ROLE}`, { permissions: ["leave.view"] });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("SUPER_ADMIN_ONLY");
    });

    it("the Manager role is locked empty — nothing is ever granted to all managers at once, not even by a Super Admin (2026-10-03)", async () => {
      const manager = (await api(tokens.sa).get("/api/access/roles")).body.roles.find((r: { code: string }) => r.code === "MANAGER");
      expect(manager).toMatchObject({ permissions: [], managerLocked: true });
      for (const body of [{ permissions: ["user.security.manage"] }, { permissions: ["leave.approve"] }, { dataScope: "SELF" }]) {
        const res = await api(tokens.sa).put("/api/access/roles/MANAGER", body);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("MANAGER_ROLE_LOCKED");
      }
    });

    it("unknown keys are rejected", async () => {
      expect((await api(tokens.sa).put(`/api/access/roles/${TEST_ROLE}`, { permissions: ["not.a.key"] })).status).toBe(400);
    });

    it("a Super Admin edits a role: saved, audited with before/after, and holders are told live", async () => {
      const holder = await createFullTestEmployee(org, { roleCode: TEST_ROLE });
      const emitter = capturingEmitter();
      const previous = getSocketServer();
      setSocketServer(emitter);
      try {
        const role = await prisma.role.findUniqueOrThrow({ where: { code: TEST_ROLE } });
        const res = await api(tokens.sa).put(`/api/access/roles/${TEST_ROLE}`, { permissions: ["leave.view", "employee.view"], dataScope: "TEAM" });
        expect(res.status).toBe(200);
        expect(res.body.role.permissions).toEqual(["employee.view", "leave.view"]);
        expect(res.body.role.dataScope).toBe("TEAM");
        const a = await resolveAccess(holder.userId);
        expect(a.permissions.has("leave.view")).toBe(true);
        expect(a.dataScope).toBe("TEAM");
        const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "access.role.updated", entityId: role.id }, orderBy: { createdAt: "desc" } });
        expect((log.after as { permissions: string[] }).permissions).toEqual(["employee.view", "leave.view"]);
        expect(emitter.emits.some((e) => e.rooms.includes(`user:${holder.employeeId}`) && e.event === "permissions.changed")).toBe(true);
        expect(emitter.joins.some((j) => j.room === `user:${holder.employeeId}` && j.joined.includes("perm:leave.view"))).toBe(true);
      } finally {
        setSocketServer(previous);
        await cleanupFullTestEmployee(holder.employeeId);
      }
    });
  });

  // ── One person's access (rules 3, 5, 6, 8) ────────────────────────────

  describe("per-person access", () => {
    it("shows effective permissions with where each comes from; can-flags match the viewer", async () => {
      const res = await api(tokens.sa).get(`/api/access/employees/${people.manager.employeeId}`);
      expect(res.status).toBe(200);
      const leaveApprove = res.body.permissions.find((p: { key: string }) => p.key === "leave.approve");
      // A manager has nothing by default (2026-10-03): not from the role, not from anywhere.
      expect(leaveApprove).toMatchObject({ effective: false, inheritedFrom: [], override: null });
      expect(res.body.can).toEqual({ editRoles: true, editOverrides: true, securityActions: true });
      const asHr = await api(tokens.hrAdmin).get(`/api/access/employees/${people.manager.employeeId}`);
      expect(asHr.body.can).toEqual({ editRoles: false, editOverrides: true, securityActions: false }); // E2: HR holds manager.permissions.manage; the sign-in security actions are the directors' (hard lock)
      const ofSa = await api(tokens.hrAdmin).get(`/api/access/employees/${people.sa.employeeId}`);
      expect(ofSa.body.can.securityActions).toBe(false);
      expect((await api(tokens.employee).get(`/api/access/employees/${people.manager.employeeId}`)).status).toBe(403);
      expect((await api(tokens.sa).get("/api/access/employees/does-not-exist")).status).toBe(404);
    });

    it("override rules: never yourself, never a Super Admin, not by a non-Super-Admin; a GRANT needs a reason", async () => {
      const path = (e: string) => `/api/access/employees/${e}/overrides/helpdesk.manage`;
      expect((await api(tokens.sa).put(path(people.sa.employeeId), { effect: "REVOKE", reason: "self" })).body.error.code).toBe("SELF");
      expect((await api(tokens.sa).put(path(people.sa2.employeeId), { effect: "REVOKE", reason: "other sa" })).body.error.code).toBe("SUPER_ADMIN_LOCKED");
      expect((await api(tokens.hrAdmin).put(path(people.manager.employeeId), { effect: "GRANT", reason: "hr tries" })).status).toBe(403);
      expect((await api(tokens.sa).put(path(people.employee.employeeId), { effect: "GRANT" })).status).toBe(400);
      expect((await api(tokens.sa).put(path(people.employee.employeeId), { effect: "GRANT", reason: "x" })).status).toBe(400);
    });

    it("rule 4 / E2 per person: nothing outside the manager-grantable list reaches a manager — not even from a Super Admin", async () => {
      for (const key of ["user.security.manage", "employee.bank.view", "helpdesk.manage"]) {
        const res = await api(tokens.sa).put(`/api/access/employees/${people.manager.employeeId}/overrides/${key}`, { effect: "GRANT", reason: "should be refused" });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("NOT_MANAGER_GRANTABLE");
      }
    });

    it("set and clear an override: takes effect, audited with the reason, and the person is told live", async () => {
      const emitter = capturingEmitter();
      const previous = getSocketServer();
      setSocketServer(emitter);
      const path = `/api/access/employees/${people.employee.employeeId}/overrides/helpdesk.manage`;
      try {
        const set = await api(tokens.sa).put(path, { effect: "GRANT", reason: "covering the helpdesk this month" });
        expect(set.status).toBe(200);
        expect(set.body.permissions.find((p: { key: string }) => p.key === "helpdesk.manage")).toMatchObject({ effective: true, override: { effect: "GRANT", reason: "covering the helpdesk this month" } });
        expect((await resolveAccess(people.employee.userId)).permissions.has("helpdesk.manage")).toBe(true);
        expect(await auditCount("access.override.set", people.employee.userId)).toBeGreaterThan(0);
        expect(emitter.emits.some((e) => e.event === "permissions.changed" && e.rooms.includes(`user:${people.employee.employeeId}`))).toBe(true);
        expect(emitter.joins.some((j) => j.joined.includes("perm:helpdesk.manage"))).toBe(true);

        const cleared = await api(tokens.sa).del(path, { reason: "back from cover" });
        expect(cleared.status).toBe(200);
        expect((await resolveAccess(people.employee.userId)).permissions.has("helpdesk.manage")).toBe(false);
        expect(await auditCount("access.override.cleared", people.employee.userId)).toBeGreaterThan(0);
        expect(emitter.leaves.some((l) => l.left.includes("perm:helpdesk.manage"))).toBe(true);
        expect((await api(tokens.sa).del(path, { reason: "nothing there" })).status).toBe(404);
      } finally {
        setSocketServer(previous);
        await prisma.userPermissionOverride.deleteMany({ where: { userId: people.employee.userId } });
      }
    });

    it("rule 6: only a Super Admin assigns roles; assigning and removing are audited", async () => {
      expect((await api(tokens.hrAdmin).post(`/api/access/employees/${people.employee.employeeId}/roles`, { code: "HR_EXECUTIVE" })).status).toBe(403);
      const add = await api(tokens.sa).post(`/api/access/employees/${people.employee.employeeId}/roles`, { code: "HR_EXECUTIVE" });
      expect(add.status).toBe(200);
      expect(add.body.roles.map((r: { code: string }) => r.code)).toContain("HR_EXECUTIVE");
      expect(await auditCount("access.role.assigned", people.employee.userId)).toBeGreaterThan(0);
      const remove = await api(tokens.sa).del(`/api/access/employees/${people.employee.employeeId}/roles/HR_EXECUTIVE`);
      expect(remove.status).toBe(200);
      expect(await auditCount("access.role.removed", people.employee.userId)).toBeGreaterThan(0);
    });

    it("rule 4 / E2 via roles: someone holding a non-grantable grant can't be made a manager", async () => {
      const p = await prisma.permission.findUniqueOrThrow({ where: { key: "user.security.manage" } });
      await prisma.userPermissionOverride.create({ data: { userId: people.employee.userId, permissionId: p.id, effect: "GRANT", reason: "t", createdByUserId: people.sa.userId } });
      try {
        const res = await api(tokens.sa).post(`/api/access/employees/${people.employee.employeeId}/roles`, { code: "MANAGER" });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("NOT_MANAGER_GRANTABLE"); // E2 supersedes rule 4: any non-grantable grant blocks it
      } finally {
        await prisma.userPermissionOverride.deleteMany({ where: { userId: people.employee.userId } });
      }
    });

    it("security actions: a director on an employee yes, HR never (hard lock), on a Super Admin only by another director, on yourself no", async () => {
      await prisma.user.update({ where: { id: people.employee.userId }, data: { failedLoginAttempts: 5, lockedUntil: new Date(Date.now() + 60_000) } });
      const unlock = await api(tokens.sa).post(`/api/access/employees/${people.employee.employeeId}/unlock`, { reason: "locked out after typos" });
      expect(unlock.status).toBe(200);
      expect(unlock.body.locked).toBe(false);
      expect(await auditCount("auth.unlocked_by_admin", people.employee.userId)).toBe(1);

      await prisma.user.update({ where: { id: people.employee.userId }, data: { totpEnabled: true } });
      const reset = await api(tokens.sa).post(`/api/access/employees/${people.employee.employeeId}/reset-2fa`, { reason: "lost phone, verified in person" });
      expect(reset.status).toBe(200);
      expect(reset.body.totpEnabled).toBe(false);
      expect(await prisma.refreshToken.count({ where: { userId: people.employee.userId, revokedAt: null } })).toBe(0);

      const pw = await api(tokens.sa).post(`/api/access/employees/${people.employee.employeeId}/password-reset`, { reason: "forgot it" });
      expect(pw.status).toBe(200);
      expect(await prisma.passwordResetToken.count({ where: { userId: people.employee.userId } })).toBeGreaterThan(0);

      for (const action of ["unlock", "reset-2fa", "password-reset"]) expect((await api(tokens.hrAdmin).post(`/api/access/employees/${people.employee.employeeId}/${action}`, { reason: "hr tries" })).status, action).toBe(403);
      expect((await api(tokens.hrAdmin).post(`/api/access/employees/${people.sa.employeeId}/reset-2fa`, { reason: "try on SA" })).status).toBe(403);
      expect((await api(tokens.sa).post(`/api/access/employees/${people.sa.employeeId}/reset-2fa`, { reason: "on myself" })).body.error.code).toBe("SELF");
      // Recovery step 1: another Super Admin can.
      expect((await api(tokens.sa).post(`/api/access/employees/${people.sa2.employeeId}/unlock`, { reason: "locked out after typos" })).status).toBe(200);
      // Outside the manager's TEAM scope: 404, never confirming the person exists.
      expect((await api(tokens.manager).post(`/api/access/employees/${people.employee.employeeId}/unlock`, { reason: "should not work" })).status).toBe(404);
    });
  });

  // ── The last active Super Admin (rule 7) ──────────────────────────────

  describe("the last active Super Admin is never lost", () => {
    // Every OTHER active Super Admin (the seeded ones, sa2) is suspended for
    // the duration, so people.sa is the only one; restored afterwards.
    let suspended: string[] = [];
    beforeAll(async () => {
      const others = await prisma.user.findMany({ where: { status: "ACTIVE", id: { not: people.sa.userId }, roles: { some: { role: { code: "SUPER_ADMIN" } } } }, select: { id: true } });
      suspended = others.map((u) => u.id);
      await prisma.user.updateMany({ where: { id: { in: suspended } }, data: { status: "SUSPENDED" } });
    });
    afterAll(async () => {
      await prisma.user.updateMany({ where: { id: { in: suspended } }, data: { status: "ACTIVE" } });
    });

    it("removing the Super Admin role from the last one is refused (API)", async () => {
      const res = await api(tokens.sa).del(`/api/access/employees/${people.sa.employeeId}/roles/SUPER_ADMIN`);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("LAST_SUPER_ADMIN");
    });

    it("the database refuses too — deactivating, suspending or demoting the last one by any path", async () => {
      await expect(prisma.user.update({ where: { id: people.sa.userId }, data: { status: "DEACTIVATED" } })).rejects.toThrow(/LAST_SUPER_ADMIN/);
      await expect(prisma.user.update({ where: { id: people.sa.userId }, data: { status: "SUSPENDED" } })).rejects.toThrow(/LAST_SUPER_ADMIN/);
      const role = await prisma.role.findUniqueOrThrow({ where: { code: "SUPER_ADMIN" } });
      await expect(prisma.userRole.delete({ where: { userId_roleId: { userId: people.sa.userId, roleId: role.id } } })).rejects.toThrow(/LAST_SUPER_ADMIN/);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: people.sa.userId } })).status).toBe("ACTIVE");
    });

    it("a database-level refusal reaches the API as a 409, not a 500", async () => {
      // Separation is the HTTP path; deactivation has no endpoint of its own.
      const res = await api(tokens.sa).post(`/api/employees/${people.sa.employeeId}/separations`, { lastWorkingDate: "2026-12-31", reason: "Resigned" });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("LAST_SUPER_ADMIN");
    });

    it("with a second active Super Admin, either can be removed", async () => {
      await prisma.user.update({ where: { id: people.sa2.userId }, data: { status: "ACTIVE" } });
      try {
        const res = await api(tokens.sa).del(`/api/access/employees/${people.sa2.employeeId}/roles/SUPER_ADMIN`);
        expect(res.status).toBe(200);
        // …and now people.sa is the last again.
        expect((await api(tokens.sa).del(`/api/access/employees/${people.sa.employeeId}/roles/SUPER_ADMIN`)).status).toBe(409);
      } finally {
        const role = await prisma.role.findUniqueOrThrow({ where: { code: "SUPER_ADMIN" } });
        await prisma.userRole.upsert({ where: { userId_roleId: { userId: people.sa2.userId, roleId: role.id } }, create: { userId: people.sa2.userId, roleId: role.id }, update: {} });
        await prisma.user.update({ where: { id: people.sa2.userId }, data: { status: "SUSPENDED" } });
      }
    });

    it("two Super Admins can't separate each other: one already leaving doesn't count", async () => {
      await prisma.user.update({ where: { id: people.sa2.userId }, data: { status: "ACTIVE" } });
      const first = await api(tokens.sa).post(`/api/employees/${people.sa2.employeeId}/separations`, { lastWorkingDate: "2026-12-31", reason: "Resigned" });
      try {
        expect(first.status).toBe(201);
        const second = await api(tokens.sa).post(`/api/employees/${people.sa.employeeId}/separations`, { lastWorkingDate: "2026-12-31", reason: "Resigned" });
        expect(second.status).toBe(409);
        expect(second.body.error.code).toBe("LAST_SUPER_ADMIN");
      } finally {
        await prisma.separation.deleteMany({ where: { employeeId: people.sa2.employeeId } });
        await prisma.employee.update({ where: { id: people.sa2.employeeId }, data: { lastWorkingDate: null } });
        await prisma.user.update({ where: { id: people.sa2.userId }, data: { status: "SUSPENDED" } });
      }
    });

    it("the daily separation job won't complete the last Super Admin's separation: it skips, audits and alerts", async () => {
      const sep = await prisma.separation.create({ data: { employeeId: people.sa.employeeId, lastWorkingDate: new Date("2020-01-31"), reason: "Resigned", initiatedByUserId: people.sa.userId } });
      try {
        await processScheduledSeparations();
        expect((await prisma.user.findUniqueOrThrow({ where: { id: people.sa.userId } })).status).toBe("ACTIVE");
        expect((await prisma.separation.findUniqueOrThrow({ where: { id: sep.id } })).status).toBe("INITIATED");
        expect(await auditCount("employee.separation.blocked_last_super_admin", people.sa.employeeId)).toBeGreaterThan(0);
        expect(await prisma.notification.count({ where: { userId: people.sa.userId, type: "access.alert" } })).toBeGreaterThan(0);
      } finally {
        await prisma.separation.delete({ where: { id: sep.id } });
      }
    });
  });

  // ── Bootstrap + recovery CLIs ─────────────────────────────────────────

  describe("Super Admin bootstrap", () => {
    it("refuses while any active Super Admin exists (always true here: the seed has one)", async () => {
      await expect(assertBootstrapAllowed("ANY")).rejects.toBeInstanceOf(AdminCliRefusal);
      await expect(bootstrapSuperAdmin({ employeeCode: "ANY" }, { operator: "Test Operator" })).rejects.toThrow(/active Super Admin already exists/);
    });

    it("provisions a minimal employee, INVITED, with no password — the invitation is how they set one", async () => {
      const code = `BOOT-${randomUUID().slice(0, 6)}`;
      extraEmployeeCodes.push(code);
      const result = await provisionSuperAdmin({
        employeeCode: code,
        fullName: "Test Bootstrap Person",
        personalEmail: `boot.${code.toLowerCase()}@gmail.com`,
        mobile: "9000000002",
        dateOfBirth: "1985-05-05",
        gender: "OTHER",
        dateOfJoining: "2020-01-01",
      });
      expect(result).toMatchObject({ outcome: "created", account: "invited", employeeCode: code });
      expect(result.link).toMatch(/\/set-password\/[0-9a-f]{64}$/);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: result.userId }, include: { roles: { include: { role: true } } } });
      expect(user.status).toBe("INVITED");
      expect(user.passwordHash).toBeNull();
      expect(user.roles.map((r) => r.role.code).sort()).toEqual(["EMPLOYEE", "SUPER_ADMIN"]);
      expect(await prisma.invitationToken.count({ where: { userId: user.id, usedAt: null } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { action: "access.super_admin.bootstrapped", entityId: user.id, actorUserId: null } })).toBe(1);
      expect(await prisma.employeeJobHistory.count({ where: { employeeId: result.employeeId } })).toBe(0);

      // Run again for the same person (link expired): a fresh link, the old one dies.
      const again = await provisionSuperAdmin({ employeeCode: code });
      expect(again.outcome).toBe("reinvited");
      expect(await prisma.invitationToken.count({ where: { userId: user.id, usedAt: null } })).toBe(1);
      await cleanupEmployeesByCode([code]); // a pending Super Admin invitation would block the next test's bootstrap
    });

    it("end to end on a 'fresh' database (no active Super Admin): bootstraps once, then blocks anyone else while the invitation is pending", async () => {
      // A fresh production database is simulated by suspending every active
      // Super Admin — which the last-Super-Admin triggers rightly refuse, so
      // they're disabled for this test only and re-enabled in finally.
      const active = await prisma.user.findMany({ where: { status: "ACTIVE", roles: { some: { role: { code: "SUPER_ADMIN" } } } }, select: { id: true } });
      const code = `BOOT-${randomUUID().slice(0, 6)}`;
      extraEmployeeCodes.push(code);
      await prisma.$executeRawUnsafe("ALTER TABLE users DISABLE TRIGGER users_protect_last_super_admin");
      try {
        await prisma.user.updateMany({ where: { id: { in: active.map((u) => u.id) } }, data: { status: "SUSPENDED" } });
        const r = await bootstrapSuperAdmin({ employeeCode: code, fullName: "Fresh Db Person", personalEmail: `fresh.${code.toLowerCase()}@gmail.com`, mobile: "9000000003", dateOfBirth: "1980-01-01", gender: "OTHER", dateOfJoining: "2019-04-01" }, { operator: "Test Operator" });
        expect(r.outcome).toBe("created");
        await expect(assertBootstrapAllowed("SOMEONE-ELSE")).rejects.toThrow(new RegExp(`invitation is already outstanding for employee ${code}`));
        await expect(assertBootstrapAllowed(code)).resolves.toBeUndefined();
      } finally {
        await prisma.user.updateMany({ where: { id: { in: active.map((u) => u.id) } }, data: { status: "ACTIVE" } });
        await prisma.$executeRawUnsafe("ALTER TABLE users ENABLE TRIGGER users_protect_last_super_admin");
        await purgeAppendOnly("SecurityEvent", { kind: "break_glass.bootstrap", summary: { contains: code } });
      }
    });

    it("refuses a new employee without the details needed to create one", async () => {
      await expect(provisionSuperAdmin({ employeeCode: `NOPE-${randomUUID().slice(0, 6)}` })).rejects.toThrow(/fullName, personalEmail/);
      await expect(provisionSuperAdmin({ employeeCode: "X", personalEmail: "someone@yahoo.com" })).rejects.toThrow();
    });
  });

  // Break-glass recovery is tested in securityAlerts.test.ts (E1.1).

  describe("access catalog (production has no seed)", () => {
    it("creates a missing permission row and is otherwise a no-op; never touches existing roles", async () => {
      const key = "user.security.manage";
      const p = await prisma.permission.findUniqueOrThrow({ where: { key }, include: { roles: true } });
      const links = p.roles.map((r) => r.roleId);
      await prisma.rolePermission.deleteMany({ where: { permissionId: p.id } });
      await prisma.permission.delete({ where: { id: p.id } });
      try {
        const first = await ensureAccessCatalog();
        expect(first).toEqual({ permissionsCreated: 1, rolesCreated: [] });
        expect(await ensureAccessCatalog()).toEqual({ permissionsCreated: 0, rolesCreated: [] });
      } finally {
        const again = await prisma.permission.findUniqueOrThrow({ where: { key } });
        await prisma.rolePermission.createMany({ data: links.map((roleId) => ({ roleId, permissionId: again.id })), skipDuplicates: true });
      }
    });
  });
});

// Records what the access module asks the realtime layer to do.
function capturingEmitter() {
  const emits: Array<{ rooms: string[]; event: string }> = [];
  const joins: Array<{ room: string; joined: string[] }> = [];
  const leaves: Array<{ room: string; left: string[] }> = [];
  const emitter: RoomEmitter & { emits: typeof emits; joins: typeof joins; leaves: typeof leaves } = {
    emits,
    joins,
    leaves,
    to: (room) => ({ emit: (event: string) => emits.push({ rooms: ([] as string[]).concat(room), event }) }),
    in: (room) => ({
      socketsJoin: (r) => joins.push({ room: String(room), joined: ([] as string[]).concat(r) }),
      socketsLeave: (r) => leaves.push({ room: String(room), left: ([] as string[]).concat(r) }),
    }),
  };
  return emitter;
}
