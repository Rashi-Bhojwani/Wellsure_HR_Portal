import { randomUUID } from "node:crypto";
import { prisma } from "../../../lib/prisma";

export { createEmployeeTestOrgMasters, cleanupEmployeeTestOrgMasters, grantPermissions, revokePermissions, cleanupTestRole, loginAs, authHeader, app, TEST_PASSWORD } from "../../employee/__tests__/employeeTestHelpers";

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
  await prisma.leaveLedger.deleteMany({ where: { employeeId } });
  await prisma.leaveRequest.deleteMany({ where: { employeeId } });
  await prisma.compOffCredit.deleteMany({ where: { employeeId } });
  await prisma.employee.deleteMany({ where: { id: employeeId } });
}

export function utcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}
