import { randomUUID } from "node:crypto";
import { prisma } from "../../../lib/prisma";

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

// Deletes every child row (from ANY employee — a post's reactions/comments/
// votes/kudos aren't only ever the author's own) of the given posts, then
// the posts themselves, in FK dependency order. Every engage test tracks
// the post ids it creates and calls this in afterAll/afterEach BEFORE
// cleaning up the employees that authored/reacted-to/voted-on them —
// cleanupLoginableTestEmployee's underlying cleanupFullTestEmployee
// doesn't know about the engage tables and will hit a live FK violation
// on Employee delete otherwise (the same class of bug already found and
// fixed for Notification/UserFavourite/DashboardLayout in commit A).
export async function cleanupEngagePosts(postIds: string[]): Promise<void> {
  if (postIds.length === 0) return;
  const polls = await prisma.poll.findMany({ where: { postId: { in: postIds } }, select: { id: true } });
  const pollIds = polls.map((p) => p.id);

  await prisma.reaction.deleteMany({ where: { postId: { in: postIds } } });
  await prisma.comment.deleteMany({ where: { postId: { in: postIds } } });
  if (pollIds.length > 0) {
    await prisma.pollVote.deleteMany({ where: { pollId: { in: pollIds } } });
    await prisma.pollOption.deleteMany({ where: { pollId: { in: pollIds } } });
    await prisma.poll.deleteMany({ where: { id: { in: pollIds } } });
  }
  await prisma.kudos.deleteMany({ where: { postId: { in: postIds } } });
  await prisma.post.deleteMany({ where: { id: { in: postIds } } });
}

// Call after cleanupEngagePosts (posts reference groupId, so a group can't
// be deleted while a post still points at it).
export async function cleanupEngageGroups(groupIds: string[]): Promise<void> {
  if (groupIds.length === 0) return;
  await prisma.groupMember.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.group.deleteMany({ where: { id: { in: groupIds } } });
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
  const posts = await prisma.post.findMany({ where: { subjectEmployeeId: employeeId }, select: { id: true } });
  await cleanupEngagePosts(posts.map((p) => p.id));
  await prisma.employeePersonal.deleteMany({ where: { employeeId } });
  await prisma.employeeNameHistory.deleteMany({ where: { employeeId } });
  await prisma.employee.deleteMany({ where: { id: employeeId } });
}
