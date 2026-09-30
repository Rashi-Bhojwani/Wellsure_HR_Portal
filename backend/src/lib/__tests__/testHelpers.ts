import { randomUUID } from "node:crypto";
import { prisma } from "../prisma";
import { deleteEmployeesAndDependents, deleteWithDependents } from "./cleanup";

// Minimal, self-contained fixtures for tests that need a real Employee
// (and its required Department/Designation/Location) — deliberately not
// dependent on prisma/seed.ts's demo data, so these tests pass whether or
// not `npm run db:seed` has ever been run (CI never runs it).

export interface TestOrgMasters {
  departmentId: string;
  designationId: string;
  locationId: string;
}

export async function createTestOrgMasters(): Promise<TestOrgMasters> {
  const suffix = randomUUID().slice(0, 8);
  const [department, designation, location] = await Promise.all([
    prisma.department.create({ data: { code: `TEST-DEPT-${suffix}`, name: `Test Dept ${suffix}` } }),
    prisma.designation.create({ data: { code: `TEST-DESIG-${suffix}`, name: `Test Designation ${suffix}` } }),
    prisma.location.create({
      data: {
        code: `TEST-LOC-${suffix}`,
        name: `Test Location ${suffix}`,
        addressLine1: "Test address",
        city: "Test City",
        state: "Test State",
        pincode: "000000",
      },
    }),
  ]);
  return { departmentId: department.id, designationId: designation.id, locationId: location.id };
}

interface CreateTestEmployeeOptions {
  org: TestOrgMasters;
  managerId?: string;
}

// Creates an Employee + User (no role assigned — callers add UserRole
// themselves) with a minimal job history row.
export async function createTestEmployee({ org, managerId }: CreateTestEmployeeOptions) {
  const suffix = randomUUID().slice(0, 8);
  const employee = await prisma.employee.create({
    data: {
      employeeCode: `TEST-${suffix}`,
      dateOfJoining: new Date("2024-01-01"),
      employmentType: "PERMANENT",
    },
  });
  const user = await prisma.user.create({ data: { employeeId: employee.id, status: "ACTIVE" } });
  await prisma.employeeJobHistory.create({
    data: {
      employeeId: employee.id,
      departmentId: org.departmentId,
      designationId: org.designationId,
      locationId: org.locationId,
      reportingManagerId: managerId ?? null,
      effectiveFrom: new Date("2024-01-01"),
      createdByUserId: user.id,
    },
  });
  return { employeeId: employee.id, userId: user.id };
}

// Deletes everything created via the helpers above, in FK-safe order —
// derived from the Prisma schema (see cleanup.ts), not a hand-kept list.
export async function cleanupTestData(opts: {
  employeeIds?: string[];
  org?: TestOrgMasters;
  roleIds?: string[];
  permissionIds?: string[];
}): Promise<void> {
  await deleteEmployeesAndDependents(opts.employeeIds ?? []);
  await deleteWithDependents("Role", opts.roleIds ?? []);
  await deleteWithDependents("Permission", opts.permissionIds ?? []);
  if (opts.org) {
    await deleteWithDependents("Department", [opts.org.departmentId]);
    await deleteWithDependents("Designation", [opts.org.designationId]);
    await deleteWithDependents("Location", [opts.org.locationId]);
  }
}
