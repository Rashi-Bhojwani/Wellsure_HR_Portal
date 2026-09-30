import { randomUUID } from "node:crypto";
import { prisma } from "../../../lib/prisma";
import { deleteEmployeesAndDependents, deleteWithDependents } from "../../../lib/__tests__/cleanup";

export {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupLoginableTestEmployee,
  createEmployeeTestOrgMasters,
  createLoginableTestEmployee,
  loginAs,
  type TestOrgMasters,
} from "../../leave/__tests__/leaveTestHelpers";

// Deletes the given posts and every kudos/poll/vote/comment/reaction on
// them (from any employee), children first — see lib/__tests__/cleanup.ts.
export async function cleanupEngagePosts(postIds: string[]): Promise<void> {
  await deleteWithDependents("Post", postIds);
}

// Posts in these groups survive, ungrouped (Post.groupId is "setNull").
export async function cleanupEngageGroups(groupIds: string[]): Promise<void> {
  await deleteWithDependents("Group", groupIds);
}

export async function cleanupAutoPostSetting(kind: "BIRTHDAY" | "JOINING" | "ANNIVERSARY"): Promise<void> {
  await prisma.engageAutoPostSetting.deleteMany({ where: { kind } });
}

// autoPostSettingsService.setDailyRunHour writes into the shared
// SystemSetting table (key "engage.autopost.dailyRunHour"), not a
// per-kind EngageAutoPostSetting row — a test that changes it must
// delete the row afterward too, or the mutated value leaks into every
// later test run against the same dev DB (getDailyRunHour's default of 8
// only applies when the key is absent).
export async function cleanupDailyRunHourSetting(): Promise<void> {
  await prisma.systemSetting.deleteMany({ where: { key: "engage.autopost.dailyRunHour" } });
}

// A bare ACTIVE employee for the auto-post cron's own tests — no User, no
// login, just enough of a real Employee (+ optional EmployeePersonal for a
// birthday) for runDailyAutoPosts/createJoiningPost to find and post about.
export async function createAutoPostTestEmployee(opts: { dateOfJoining: Date; dateOfBirth?: Date }): Promise<string> {
  const suffix = randomUUID().slice(0, 8);
  const employee = await prisma.employee.create({
    data: {
      employeeCode: `ENGAGE-AUTO-${suffix}`,
      dateOfJoining: opts.dateOfJoining,
      employmentType: "PERMANENT",
      status: "ACTIVE",
    },
  });
  if (opts.dateOfBirth) {
    await prisma.employeePersonal.create({
      data: {
        employeeId: employee.id,
        dateOfBirth: opts.dateOfBirth,
        gender: "OTHER",
        personalEmail: `engage.auto.${suffix}@gmail.com`,
        mobile: "9000000000",
        currentAddress: "Test address",
        permanentAddress: "Test address",
        emergencyContactName: "Test Contact",
        emergencyContactPhone: "9000000001",
        emergencyContactRelation: "Friend",
      },
    });
  }
  return employee.id;
}

export async function cleanupAutoPostTestEmployee(employeeId: string): Promise<void> {
  await deleteEmployeesAndDependents([employeeId]);
}
