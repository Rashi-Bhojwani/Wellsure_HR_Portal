import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { createApp } from "../../../app";
import { prisma } from "../../../lib/prisma";
import { redis } from "../../../lib/redis";
import { createTestOrgMasters, type TestOrgMasters } from "../../../lib/__tests__/testHelpers";

export const TEST_PASSWORD = "TestPass1234";

export const app = createApp();

// Rate limiting (middleware/rateLimit.ts) keys on req.ip, which is the
// same loopback address for every supertest request regardless of which
// test file issued it — clear between tests so one test's attempts don't
// trip another's rate limit.
export async function clearRateLimits(): Promise<void> {
  const keys = await redis.keys("ratelimit:*");
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}

export interface TestUser {
  employeeId: string;
  userId: string;
  employeeCode: string;
}

export async function createTestUser(
  org: TestOrgMasters,
  opts: { status?: "ACTIVE" | "INVITED" | "DEACTIVATED" | "SUSPENDED"; roleCode?: string } = {},
): Promise<TestUser> {
  const suffix = randomUUID().slice(0, 8);
  const employeeCode = `TEST-${suffix}`;
  const employee = await prisma.employee.create({
    data: { employeeCode, dateOfJoining: new Date("2024-01-01"), employmentType: "PERMANENT" },
  });
  const passwordHash = await argon2.hash(TEST_PASSWORD);
  const user = await prisma.user.create({
    data: {
      employeeId: employee.id,
      status: opts.status ?? "ACTIVE",
      passwordHash: opts.status === "INVITED" ? null : passwordHash,
      privacyNoticeAcceptedAt: new Date(),
    },
  });
  await prisma.employeeJobHistory.create({
    data: {
      employeeId: employee.id,
      departmentId: org.departmentId,
      designationId: org.designationId,
      locationId: org.locationId,
      effectiveFrom: new Date("2024-01-01"),
      createdByUserId: user.id,
    },
  });
  await prisma.employeeNameHistory.create({
    data: { employeeId: employee.id, fullName: `Test User ${suffix}`, effectiveFrom: new Date("2024-01-01"), createdByUserId: user.id },
  });
  await prisma.employeePersonal.create({
    data: {
      employeeId: employee.id,
      dateOfBirth: new Date("1990-01-01"),
      gender: "OTHER",
      personalEmail: `test.${suffix}@example.com`,
      mobile: "9000000000",
      currentAddress: "Test address",
      permanentAddress: "Test address",
      emergencyContactName: "Test Contact",
      emergencyContactPhone: "9000000001",
      emergencyContactRelation: "Friend",
    },
  });

  if (opts.roleCode) {
    let role = await prisma.role.findUnique({ where: { code: opts.roleCode } });
    role ??= await prisma.role.create({ data: { code: opts.roleCode, name: opts.roleCode } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  }

  return { employeeId: employee.id, userId: user.id, employeeCode };
}

export async function cleanupTestUser(employeeId: string): Promise<void> {
  await prisma.totpBackupCode.deleteMany({ where: { user: { employeeId } } });
  await prisma.refreshToken.deleteMany({ where: { user: { employeeId } } });
  await prisma.invitationToken.deleteMany({ where: { user: { employeeId } } });
  await prisma.passwordResetToken.deleteMany({ where: { user: { employeeId } } });
  await prisma.auditLog.deleteMany({ where: { entityId: employeeId } });
  const user = await prisma.user.findUnique({ where: { employeeId } });
  if (user) {
    await prisma.auditLog.deleteMany({ where: { entityId: user.id } });
    await prisma.userRole.deleteMany({ where: { userId: user.id } });
  }
  await prisma.employeeJobHistory.deleteMany({ where: { employeeId } });
  await prisma.employeeNameHistory.deleteMany({ where: { employeeId } });
  await prisma.employeePersonal.deleteMany({ where: { employeeId } });
  await prisma.user.deleteMany({ where: { employeeId } });
  await prisma.employee.deleteMany({ where: { id: employeeId } });
}

export async function cleanupTestRole(roleCode: string): Promise<void> {
  const role = await prisma.role.findUnique({ where: { code: roleCode } });
  if (!role) return;
  await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
  await prisma.userRole.deleteMany({ where: { roleId: role.id } });
  await prisma.role.delete({ where: { id: role.id } });
}

export { createTestOrgMasters, type TestOrgMasters };
