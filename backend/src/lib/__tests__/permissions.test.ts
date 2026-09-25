import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../prisma";
import { resolveUserPermissions, resolveUserRoleCodes } from "../permissions";
import { createTestEmployee, createTestOrgMasters, cleanupTestData, type TestOrgMasters } from "./testHelpers";

describe("resolveUserPermissions / resolveUserRoleCodes", () => {
  let org: TestOrgMasters;
  const employeeIds: string[] = [];
  const roleIds: string[] = [];
  const permissionIds: string[] = [];

  beforeAll(async () => {
    org = await createTestOrgMasters();
  });

  afterAll(async () => {
    await cleanupTestData({ employeeIds, roleIds, permissionIds, org });
  });

  it("returns the union of permissions across every role a user holds", async () => {
    const { employeeId, userId } = await createTestEmployee({ org });
    employeeIds.push(employeeId);

    const suffix = randomUUID().slice(0, 8);
    const permA = await prisma.permission.create({ data: { key: `test.perm.a.${suffix}`, description: "a" } });
    const permB = await prisma.permission.create({ data: { key: `test.perm.b.${suffix}`, description: "b" } });
    const permC = await prisma.permission.create({ data: { key: `test.perm.c.${suffix}`, description: "c" } });
    permissionIds.push(permA.id, permB.id, permC.id);

    const roleOne = await prisma.role.create({ data: { code: `TEST_ROLE_ONE_${suffix}`, name: "Role One" } });
    const roleTwo = await prisma.role.create({ data: { code: `TEST_ROLE_TWO_${suffix}`, name: "Role Two" } });
    roleIds.push(roleOne.id, roleTwo.id);

    await prisma.rolePermission.createMany({
      data: [
        { roleId: roleOne.id, permissionId: permA.id },
        { roleId: roleOne.id, permissionId: permB.id },
        { roleId: roleTwo.id, permissionId: permB.id }, // overlaps with roleOne — union must dedupe
        { roleId: roleTwo.id, permissionId: permC.id },
      ],
    });
    await prisma.userRole.createMany({
      data: [
        { userId, roleId: roleOne.id },
        { userId, roleId: roleTwo.id },
      ],
    });

    const permissions = await resolveUserPermissions(userId);
    expect(permissions).toEqual(new Set([permA.key, permB.key, permC.key]));

    const roleCodes = await resolveUserRoleCodes(userId);
    expect(roleCodes.sort()).toEqual([roleOne.code, roleTwo.code].sort());
  });

  it("returns an empty set for a user with no roles", async () => {
    const { employeeId, userId } = await createTestEmployee({ org });
    employeeIds.push(employeeId);

    const permissions = await resolveUserPermissions(userId);
    expect(permissions.size).toBe(0);
  });
});
