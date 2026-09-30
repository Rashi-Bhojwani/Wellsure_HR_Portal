import { randomUUID } from "node:crypto";
import { createApp } from "../../../app";
import { prisma } from "../../../lib/prisma";
import { deleteEmployeesAndDependents, deleteWithDependents } from "../../../lib/__tests__/cleanup";
import {
  createTestOrgMasters as createBaseOrgMasters,
  type TestOrgMasters as BaseTestOrgMasters,
} from "../../../lib/__tests__/testHelpers";
import { TEST_PASSWORD, clearRateLimits } from "../../auth/__tests__/authTestHelpers";
import request from "supertest";

export const app = createApp();
export { TEST_PASSWORD, clearRateLimits };

// Monotonic per-process counter guaranteeing a unique PAN/Aadhaar/account
// number on every call within a test run — randomUUID-derived digits alone
// weren't reliably unique (hex has few actual digit characters, and most
// PAN letter positions collapsed to the same "X" fallback), which produced
// real pan_hash/aadhaar_hash/account_number_hash collisions between
// fixtures in the same file.
let fixtureCounter = 0;
function nextFixtureDigits(length: number): string {
  fixtureCounter += 1;
  return String(fixtureCounter).padStart(length, "0").slice(-length);
}

export interface TestOrgMasters extends BaseTestOrgMasters {
  gradeId: string;
  costCentreId: string;
  cityId: string;
}

// Extends the auth module's minimal org fixture (dept/designation/location)
// with grade/cost-centre/city — the employee module's create/update paths
// exercise all six masters, not just the three auth's tests needed.
export async function createEmployeeTestOrgMasters(): Promise<TestOrgMasters> {
  const base = await createBaseOrgMasters();
  const suffix = randomUUID().slice(0, 8);
  const [grade, costCentre, city] = await Promise.all([
    prisma.grade.create({ data: { code: `TEST-GRADE-${suffix}`, name: `Test Grade ${suffix}` } }),
    prisma.costCentre.create({ data: { code: `TEST-CC-${suffix}`, name: `Test CC ${suffix}` } }),
    prisma.city.create({ data: { name: `Test City ${suffix}`, state: "Test State" } }),
  ]);
  return { ...base, gradeId: grade.id, costCentreId: costCentre.id, cityId: city.id };
}

export async function cleanupEmployeeTestOrgMasters(org: TestOrgMasters): Promise<void> {
  await deleteWithDependents("Grade", [org.gradeId]);
  await deleteWithDependents("CostCentre", [org.costCentreId]);
  await deleteWithDependents("City", [org.cityId]);
  await deleteWithDependents("Department", [org.departmentId]);
  await deleteWithDependents("Designation", [org.designationId]);
  await deleteWithDependents("Location", [org.locationId]);
}

// Full employee (personal + name + job + statutory + bank), with a real
// logged-in-capable User — used by tests that need a complete profile to
// read back, reveal, or update, not just the bare minimum authTestHelpers
// fixture (which has no statutory/bank rows at all).
export async function createFullTestEmployee(org: TestOrgMasters, opts: { roleCode?: string; managerId?: string } = {}) {
  const suffix = randomUUID().slice(0, 8);
  const employeeCode = `TEST-${suffix}`;
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
    data: { employeeId: employee.id, fullName: `Test Employee ${suffix}`, effectiveFrom: new Date("2024-01-01"), createdByUserId: user.id },
  });
  await prisma.employeePersonal.create({
    data: {
      employeeId: employee.id,
      dateOfBirth: new Date("1990-01-01"),
      gender: "OTHER",
      personalEmail: `test.${suffix}@gmail.com`,
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
      gradeId: org.gradeId,
      costCentreId: org.costCentreId,
      reportingManagerId: opts.managerId ?? null,
      effectiveFrom: new Date("2024-01-01"),
      createdByUserId: user.id,
    },
  });
  await prisma.deviceUserMapping.create({
    data: { employeeId: employee.id, deviceUserId: employeeCode, validFrom: new Date("2024-01-01"), createdByUserId: user.id },
  });

  // Unique per call (monotonic counter, not the UUID suffix — see comment
  // on nextFixtureDigits) — a colliding fake PAN/Aadhaar/account number
  // would hit the global-unique hash constraints the moment a test creates
  // more than one full employee, which is exactly what happened here.
  const panDigits = nextFixtureDigits(4);
  const aadhaarDigits = nextFixtureDigits(12);
  const accountDigits = nextFixtureDigits(11);
  const { encryptStatutoryFields, encryptBankFields } = await import("../service");
  await prisma.employeeStatutory.create({
    data: { employeeId: employee.id, ...encryptStatutoryFields({ pan: `ABCPT${panDigits}F`, aadhaar: aadhaarDigits }) },
  });
  await prisma.employeeBankAccount.create({
    data: {
      employeeId: employee.id,
      ...encryptBankFields({ accountHolderName: `Test Employee ${suffix}`, accountNumber: accountDigits, ifsc: "SBIN0001234", bankName: "State Bank of India", branchName: "Test Branch" }),
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

export async function cleanupFullTestEmployee(employeeId: string): Promise<void> {
  await deleteEmployeesAndDependents([employeeId]);
}

// Removes employees created through the real API (e.g. the Add Employee
// wizard), where the test only knows the Employee Code it submitted.
export async function cleanupEmployeesByCode(employeeCodes: string[]): Promise<void> {
  const rows = await prisma.employee.findMany({ where: { employeeCode: { in: employeeCodes } }, select: { id: true } });
  await deleteEmployeesAndDependents(rows.map((r) => r.id));
}

export async function cleanupTestRole(roleCode: string): Promise<void> {
  const role = await prisma.role.findUnique({ where: { code: roleCode } });
  if (role) await deleteWithDependents("Role", [role.id]);
}

// Grants the given permission keys to a (possibly newly created) role,
// creating any Permission rows that don't already exist — mirrors how
// prisma/seed.ts assembles roles, but scoped to just what one test needs.
export async function grantPermissions(roleCode: string, permissionKeys: string[]): Promise<void> {
  let role = await prisma.role.findUnique({ where: { code: roleCode } });
  role ??= await prisma.role.create({ data: { code: roleCode, name: roleCode } });
  for (const key of permissionKeys) {
    let permission = await prisma.permission.findUnique({ where: { key } });
    permission ??= await prisma.permission.create({ data: { key, description: key } });
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      create: { roleId: role.id, permissionId: permission.id },
      update: {},
    });
  }
}

// Strips the given permission keys from a role, if present — for tests
// that assert a role must NOT have some permission. Needed because a
// shared literal role code (e.g. "HR_EXECUTIVE", used so resolveDataScope
// resolves correctly — see profileAndReveal.test.ts) may already carry
// permissions granted by an earlier test run or a stale local seed;
// grantPermissions only ever adds, so a negative test needs this to get a
// deterministic starting point instead of trusting whatever the shared
// role already had.
export async function revokePermissions(roleCode: string, permissionKeys: string[]): Promise<void> {
  const role = await prisma.role.findUnique({ where: { code: roleCode } });
  if (!role) return;
  const permissions = await prisma.permission.findMany({ where: { key: { in: permissionKeys } } });
  await prisma.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: { in: permissions.map((p) => p.id) } } });
}

// Clears the IP-scoped login rate limit before every call — these test
// files log in many fixture users per beforeAll, well past the real
// LOGIN_RATE_LIMIT (10/15min) that a shared loopback IP would otherwise hit.
export async function loginAs(employeeCode: string): Promise<string> {
  await clearRateLimits();
  const res = await request(app).post("/api/auth/login").send({ employeeCode, password: TEST_PASSWORD });
  if (res.status !== 200 || !res.body.accessToken) {
    throw new Error(`Test login failed for ${employeeCode}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}

export function authHeader(token: string): [string, string] {
  return ["Authorization", `Bearer ${token}`];
}
