import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PERMISSION_KEYS } from "@shared/constants/permissions";
import { HR_FORBIDDEN_KEYS, HR_ROLE_CODES } from "@shared/constants/sensitiveData";
import { ensureAccessCatalog } from "../../../lib/accessCatalog";
import { resolveAccess } from "../../../lib/permissions";
import { prisma } from "../../../lib/prisma";
import { SYSTEM_ROLES } from "../../../lib/systemRoles";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { setOverride, updateRole, type AccessActor } from "../service";

// The HR hard lock (docs/plans/HR_CAPABILITIES.md §1A): pay data is never HR's. Each of the four layers is proven on its own, so weakening one is caught while the others still hold.

const locked = (k: string) => (HR_FORBIDDEN_KEYS as readonly string[]).includes(k);

describe("the HR hard-locked set", () => {
  it("is every payroll key plus the salary-derived reports and PAY documents, and nothing HR needs for attendance, leave or people", () => {
    for (const k of PERMISSION_KEYS.filter((key) => key.startsWith("payroll."))) expect(locked(k), k).toBe(true);
    for (const k of ["reports.salary.view", "reports.liability.view", "documents.pay.view"]) expect(locked(k), k).toBe(true);
    for (const k of PERMISSION_KEYS.filter((key) => key.startsWith("attendance.") || key.startsWith("leave.") || key === "reports.view" || key === "employee.view")) expect(locked(k), k).toBe(false);
  });

  it("the default HR roles hold none of it", () => {
    for (const code of HR_ROLE_CODES) expect(SYSTEM_ROLES.find((r) => r.code === code)!.permissions.filter(locked), code).toEqual([]);
  });
});

describe("the HR hard lock, layer by layer", () => {
  let org: TestOrgMasters;
  let sa: { employeeId: string; employeeCode: string; userId: string };
  let hr: { employeeId: string; employeeCode: string; userId: string };
  let hrx: { employeeId: string; employeeCode: string; userId: string };
  let both: { employeeId: string; employeeCode: string; userId: string };
  const meta = () => ({ actorUserId: sa.userId, ipAddress: null, userAgent: null });
  const actorOf = async (): Promise<AccessActor> => {
    const a = await resolveAccess(sa.userId);
    return { userId: sa.userId, employeeId: sa.employeeId, roleCodes: a.roleCodes, permissions: a.permissions, dataScope: a.dataScope };
  };
  const keyId = async (key: string) => (await prisma.permission.findUniqueOrThrow({ where: { key } })).id;
  const withoutTrigger = async (table: string, trigger: string, fn: () => Promise<void>) => {
    await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE TRIGGER "${trigger}"`);
    try {
      await fn();
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE TRIGGER "${trigger}"`);
    }
  };

  beforeAll(async () => {
    await ensureAccessCatalog();
    org = await createEmployeeTestOrgMasters();
    sa = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    hrx = await createFullTestEmployee(org, { roleCode: "HR_EXECUTIVE" });
    both = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    const hrRole = await prisma.role.findUniqueOrThrow({ where: { code: "HR_ADMIN" } });
    await prisma.userRole.create({ data: { userId: both.userId, roleId: hrRole.id } });
  });
  afterAll(async () => {
    for (const p of [hr, hrx, both, sa]) await cleanupFullTestEmployee(p.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("HR Admin and HR Executive hold no locked key, and the API refuses their tokens at the figures", async () => {
    for (const p of [hr, hrx]) {
      const a = await resolveAccess(p.userId);
      expect([...a.permissions].filter(locked)).toEqual([]);
    }
    for (const p of [hr, hrx]) {
      const token = await loginAs(p.employeeCode);
      for (const path of ["/api/payroll/salary/employees", "/api/payroll/runs", "/api/payroll/rules"]) expect((await request(app).get(path).set(...authHeader(token))).status, path).toBe(403);
    }
  });

  it("layer 1, the resolver: a locked key put on the HR role or granted to an HR person is removed whatever the rows say (database triggers off for the moment)", async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: "HR_ADMIN" } });
    const roleKey = await keyId("payroll.salary.view");
    const grantKey = await keyId("reports.salary.view");
    await withoutTrigger("role_permissions", "role_permissions_hr_hard_lock", async () => {
      await withoutTrigger("user_permission_overrides", "user_permission_overrides_hr_hard_lock", async () => {
        await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: roleKey } });
        await prisma.userPermissionOverride.create({ data: { userId: hrx.userId, permissionId: grantKey, effect: "GRANT", reason: "raw", createdByUserId: sa.userId } });
        try {
          expect((await resolveAccess(hr.userId)).permissions.has("payroll.salary.view")).toBe(false);
          expect((await resolveAccess(hrx.userId)).permissions.has("reports.salary.view")).toBe(false);
          expect((await request(app).get("/api/payroll/salary/employees").set(...authHeader(await loginAs(hr.employeeCode)))).status).toBe(403);
        } finally {
          await prisma.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: roleKey } });
          await prisma.userPermissionOverride.deleteMany({ where: { userId: hrx.userId } });
        }
      });
    });
  });

  it("layer 2, the access service: refuses, in words, to give HR a locked key by role or by person", async () => {
    const current = (await prisma.rolePermission.findMany({ where: { role: { code: "HR_ADMIN" } }, include: { permission: true } })).map((p) => p.permission.key);
    await expect(updateRole("HR_ADMIN", { permissions: [...current, "payroll.salary.view"] }, await actorOf(), meta())).rejects.toMatchObject({ status: 403, code: "HR_CEILING" });
    await expect(updateRole("HR_EXECUTIVE", { permissions: ["employee.view", "documents.pay.view"] }, await actorOf(), meta())).rejects.toMatchObject({ code: "HR_CEILING" });
    await expect(setOverride(hrx.employeeId, "reports.salary.view", { effect: "GRANT", reason: "please" }, await actorOf(), meta())).rejects.toMatchObject({ code: "HR_CEILING" });
    // Other grants are untouched.
    await expect(setOverride(hrx.employeeId, "attendance.override.manage", { effect: "GRANT", reason: "needed" }, await actorOf(), meta())).resolves.toBeDefined();
    await prisma.userPermissionOverride.deleteMany({ where: { userId: hrx.userId } });
  });

  it("layer 3, the database: refuses the rows on its own", async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: "HR_EXECUTIVE" } });
    await expect(prisma.rolePermission.create({ data: { roleId: role.id, permissionId: await keyId("payroll.run") } })).rejects.toThrow(/HR_HARD_LOCK/);
    await expect(prisma.rolePermission.create({ data: { roleId: role.id, permissionId: await keyId("reports.liability.view") } })).rejects.toThrow(/HR_HARD_LOCK/);
    await expect(prisma.userPermissionOverride.create({ data: { userId: hr.userId, permissionId: await keyId("documents.pay.view"), effect: "GRANT", reason: "raw", createdByUserId: sa.userId } })).rejects.toThrow(/HR_HARD_LOCK/);
    // A REVOKE is harmless and allowed; an unlocked key is allowed.
    await expect(prisma.userPermissionOverride.create({ data: { userId: hr.userId, permissionId: await keyId("attendance.view"), effect: "GRANT", reason: "ok", createdByUserId: sa.userId } })).resolves.toBeDefined();
    await prisma.userPermissionOverride.deleteMany({ where: { userId: hr.userId } });
  });

  it("a director who also holds an HR role keeps every key", async () => {
    const a = await resolveAccess(both.userId);
    expect(a.isSuperAdmin).toBe(true);
    for (const k of HR_FORBIDDEN_KEYS) expect(a.permissions.has(k), k).toBe(true);
  });

  it("the record of what the migration removed cannot be changed, deleted or truncated", async () => {
    const row = await prisma.rolePermissionRemoval.create({ data: { roleCode: "HR_ADMIN", permissionKey: "payroll.salary.view", reason: "test row" } });
    await expect(prisma.$executeRawUnsafe(`UPDATE "role_permission_removals" SET "reason" = 'x' WHERE "id" = '${row.id}'`)).rejects.toThrow(/ROLE_PERMISSION_REMOVALS_APPEND_ONLY/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "role_permission_removals" WHERE "id" = '${row.id}'`)).rejects.toThrow(/ROLE_PERMISSION_REMOVALS_APPEND_ONLY/);
    await expect(prisma.$executeRawUnsafe('TRUNCATE "role_permission_removals"')).rejects.toThrow(/ROLE_PERMISSION_REMOVALS_APPEND_ONLY/);
    await purgeAppendOnly("RolePermissionRemoval", { id: row.id }); // the test-only purge path, as for the other append-only tables
  });
});
