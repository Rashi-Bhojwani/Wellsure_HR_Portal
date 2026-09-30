import { randomUUID } from "node:crypto";
import { prisma } from "../prisma";

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

// A test that drives the real accept-invitation HTTP flow (auth/service.ts's
// acceptInvitation) creates an AUTO_JOINING Post as a real side effect of
// that code path (Phase 5 commit B), not something the test itself asked
// for. Post.authorEmployeeId/subjectEmployeeId are optional FKs, so Prisma's
// default onDelete is SetNull, not a blocking error — deleting the Employee
// row without this cleanup first doesn't fail the test, it silently leaves
// an orphaned Post (subjectEmployeeId/subject now null) permanently in the
// dev DB, which then renders as "null just joined us!" in the real feed.
// Every cleanup helper that deletes a real Employee row must call this
// first — mirrors the child-tables-before-parent pattern already used for
// Notification/UserFavourite/DashboardLayout.
export async function cleanupEmployeeEngageRows(employeeId: string): Promise<void> {
  await prisma.reaction.deleteMany({ where: { employeeId } });
  await prisma.comment.deleteMany({ where: { authorEmployeeId: employeeId } });
  await prisma.pollVote.deleteMany({ where: { employeeId } });
  await prisma.groupMember.deleteMany({ where: { employeeId } });
  await prisma.kudos.deleteMany({ where: { OR: [{ fromEmployeeId: employeeId }, { toEmployeeId: employeeId }] } });

  const posts = await prisma.post.findMany({
    where: { OR: [{ authorEmployeeId: employeeId }, { subjectEmployeeId: employeeId }] },
    select: { id: true },
  });
  if (posts.length === 0) return;
  const postIds = posts.map((p) => p.id);
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

// Deletes everything created via the helpers above, in FK-safe order.
export async function cleanupTestData(opts: {
  employeeIds?: string[];
  org?: TestOrgMasters;
  roleIds?: string[];
  permissionIds?: string[];
}): Promise<void> {
  const employeeIds = opts.employeeIds ?? [];
  if (employeeIds.length > 0) {
    await prisma.userRole.deleteMany({ where: { user: { employeeId: { in: employeeIds } } } });
    await prisma.employeeJobHistory.deleteMany({ where: { employeeId: { in: employeeIds } } });
    await prisma.user.deleteMany({ where: { employeeId: { in: employeeIds } } });
    await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
  }
  if (opts.roleIds && opts.roleIds.length > 0) {
    await prisma.rolePermission.deleteMany({ where: { roleId: { in: opts.roleIds } } });
    await prisma.role.deleteMany({ where: { id: { in: opts.roleIds } } });
  }
  if (opts.permissionIds && opts.permissionIds.length > 0) {
    await prisma.permission.deleteMany({ where: { id: { in: opts.permissionIds } } });
  }
  if (opts.org) {
    await prisma.department.delete({ where: { id: opts.org.departmentId } }).catch(() => undefined);
    await prisma.designation.delete({ where: { id: opts.org.designationId } }).catch(() => undefined);
    await prisma.location.delete({ where: { id: opts.org.locationId } }).catch(() => undefined);
  }
}
