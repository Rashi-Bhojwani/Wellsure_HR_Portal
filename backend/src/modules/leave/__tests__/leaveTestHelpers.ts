import { randomUUID } from "node:crypto";
import { prisma } from "../../../lib/prisma";
import { deleteEmployeesAndDependents } from "../../../lib/__tests__/cleanup";
import { TEST_PASSWORD, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";

export { createEmployeeTestOrgMasters, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, grantPermissions, revokePermissions, cleanupTestRole, loginAs, authHeader, app, TEST_PASSWORD } from "../../employee/__tests__/employeeTestHelpers";
export type { TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";

// A loginable employee — Employee + name/personal/job history + a real
// ACTIVE User — WITHOUT statutory/bank/device-mapping rows, unlike
// employeeTestHelpers.ts's createFullTestEmployee. Leave's own HTTP
// integration/IDOR tests never touch statutory or bank data, and
// createFullTestEmployee's fake PAN/Aadhaar/account-number counter is only
// unique *within one test file's module instance* — concurrent test files
// (each a fresh Vitest module registry, all writing into the same shared
// Postgres database) can and did collide on the global-unique pan_hash
// constraint the moment more than one leave test file created several
// full employees. Skipping statutory/bank entirely sidesteps that
// collision surface rather than fighting it.
export async function createLoginableTestEmployee(org: TestOrgMasters, opts: { roleCode?: string; managerId?: string } = {}) {
  const suffix = randomUUID().slice(0, 12);
  const employeeCode = `LEAVE-${suffix}`;
  const employee = await prisma.employee.create({
    data: { employeeCode, dateOfJoining: new Date("2024-01-01"), employmentType: "PERMANENT" },
  });
  const argon2 = await import("argon2");
  const user = await prisma.user.create({
    data: {
      employeeId: employee.id,
      status: "ACTIVE",
      passwordHash: await argon2.hash(TEST_PASSWORD),
      privacyNoticeAcceptedAt: new Date(),
    },
  });
  await prisma.employeeNameHistory.create({
    data: { employeeId: employee.id, fullName: `Leave Test ${suffix}`, effectiveFrom: new Date("2024-01-01"), createdByUserId: user.id },
  });
  await prisma.employeePersonal.create({
    data: {
      employeeId: employee.id,
      dateOfBirth: new Date("1990-01-01"),
      gender: "OTHER",
      personalEmail: `leave.test.${suffix}@gmail.com`,
      mobile: "9000000000",
      currentAddress: "Test address",
      permanentAddress: "Test address",
      emergencyContactName: "Test Contact",
      emergencyContactPhone: "9000000001",
      emergencyContactRelation: "Friend",
    },
  });
  await prisma.employeeJobHistory.create({
    data: {
      employeeId: employee.id,
      departmentId: org.departmentId,
      designationId: org.designationId,
      locationId: org.locationId,
      reportingManagerId: opts.managerId ?? null,
      effectiveFrom: new Date("2024-01-01"),
      createdByUserId: user.id,
    },
  });

  if (opts.roleCode) {
    let role = await prisma.role.findUnique({ where: { code: opts.roleCode } });
    role ??= await prisma.role.create({ data: { code: opts.roleCode, name: opts.roleCode } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  }

  return { employeeId: employee.id, userId: user.id, employeeCode };
}

// A bare-minimum ACTIVE employee (id, code, DOJ, status only) — leave's
// own unit/integration tests don't need employeeTestHelpers.ts's full
// personal/statutory/bank/device-mapping fixture, just a real Employee
// row to attach ledger/request/comp-off rows to.
export async function createMinimalTestEmployee(dateOfJoining: Date, opts: { status?: "ACTIVE" | "INACTIVE" | "SEPARATED" } = {}): Promise<string> {
  const suffix = randomUUID().slice(0, 8);
  const employee = await prisma.employee.create({
    data: {
      employeeCode: `LEAVE-TEST-${suffix}`,
      dateOfJoining,
      employmentType: "PERMANENT",
      status: opts.status ?? "ACTIVE",
    },
  });
  return employee.id;
}

export async function cleanupMinimalTestEmployee(employeeId: string): Promise<void> {
  await deleteEmployeesAndDependents([employeeId]);
}

export async function cleanupLoginableTestEmployee(employeeId: string): Promise<void> {
  await deleteEmployeesAndDependents([employeeId]);
}

export function utcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}
