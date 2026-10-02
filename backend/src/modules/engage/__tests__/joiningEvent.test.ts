import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { env } from "../../../config/env";
import { prisma } from "../../../lib/prisma";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupFullTestEmployee,
  cleanupTestRole,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  grantPermissions,
  loginAs,
  type TestOrgMasters,
} from "../../employee/__tests__/employeeTestHelpers";
import { cleanupEngagePosts } from "./engageTestHelpers";

const MAIL_DIR = path.resolve(process.cwd(), env.MAIL_DEV_DIR);

// Same .eml-reading approach as employee/__tests__/e2eOnboarding.test.ts —
// duplicated rather than shared since it's a small, single-purpose test
// utility and the two suites test different things.
// Matches on the recipient alone — every test fixture's address is unique.
// (It used to also require a file mtime after the test started: that
// compared filesystem timestamps to the process clock, which breaks on
// filesystems with coarse mtime granularity.)
async function findInvitationTokenInMail(toEmail: string): Promise<string> {
  const deadline = Date.now() + 20_000; // well inside the 30 s test budget (vitest.config.ts)
  while (Date.now() < deadline) {
    const files = await readdir(MAIL_DIR).catch(() => [] as string[]);
    for (const file of files) {
      const filePath = path.join(MAIL_DIR, file);
      const body = await readFile(filePath, "utf8");
      if (!body.includes(`To: ${toEmail}`)) continue;
      const match = /\/set-password\/([A-Za-z0-9_-]+)/.exec(body);
      if (match) return match[1]!;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No invitation email found for ${toEmail} in ${MAIL_DIR} within the deadline.`);
}

// The review's explicit requirement: joining posts fire on the real event
// (a new hire's invitation acceptance — the only real path that flips
// User.status INVITED -> ACTIVE, per auth/service.ts's acceptInvitation),
// never on the daily cron. autoPosts.test.ts already proves the cron never
// scans for AUTO_JOINING at the unit level; this proves the real HTTP path
// — Add Employee -> invite email -> accept -> post appears — end to end.
describe("Engage — joining post fires from the real accept-invitation flow", () => {
  const hrRole = `TEST_ENGAGE_HR_${Date.now()}`;
  let org: TestOrgMasters;
  let hrToken: string;
  const employeeIds: string[] = [];

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    await grantPermissions(hrRole, ["employee.create", "employee.view"]);
    const hr = await createFullTestEmployee(org, { roleCode: hrRole });
    employeeIds.push(hr.employeeId);
    hrToken = await loginAs(hr.employeeCode);
  });

  afterAll(async () => {
    for (const id of employeeIds) {
      const posts = await prisma.post.findMany({ where: { subjectEmployeeId: id }, select: { id: true } });
      await cleanupEngagePosts(posts.map((p) => p.id));
      await cleanupFullTestEmployee(id);
    }
    await cleanupTestRole(hrRole);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("accepting the invitation creates exactly one AUTO_JOINING post, keyed on the real dateOfJoining", async () => {
    const suffix = randomUUID().slice(0, 8);
    const employeeCode = `ENGAGE-JOIN-${suffix}`;
    const personalEmail = `engage.joining.${suffix}@gmail.com`;

    const createRes = await request(app)
      .post("/api/employees")
      .set(...authHeader(hrToken))
      .send({
        official: {
          deviceUserId: employeeCode,
          employeeCode,
          dateOfJoining: "2026-02-01",
          departmentId: org.departmentId,
          designationId: org.designationId,
          locationId: org.locationId,
          employmentType: "PERMANENT",
        },
        personal: {
          fullName: "Joining Event Testerson",
          dateOfBirth: "1995-06-15",
          gender: "OTHER",
          personalEmail,
          mobile: "9876500002",
          currentAddress: "1 Joining Street",
          permanentAddress: "1 Joining Street",
          emergencyContactName: "Emergency Contact",
          emergencyContactPhone: "9876500003",
          emergencyContactRelation: "Friend",
        },
      });
    expect(createRes.status).toBe(201);
    const newEmployeeId = createRes.body.id as string;
    employeeIds.push(newEmployeeId);

    // Creating the employee alone must NOT create a joining post — it only
    // fires once the invitation is actually accepted.
    let posts = await prisma.post.findMany({ where: { subjectEmployeeId: newEmployeeId, kind: "AUTO_JOINING" } });
    expect(posts).toHaveLength(0);

    const token = await findInvitationTokenInMail(personalEmail);
    const acceptRes = await request(app).post(`/api/auth/invitations/${token}/accept`).send({ password: "NewHirePass123" });
    expect(acceptRes.status).toBe(200);

    posts = await prisma.post.findMany({ where: { subjectEmployeeId: newEmployeeId, kind: "AUTO_JOINING" } });
    expect(posts).toHaveLength(1);
    expect(posts[0]!.occurredOn?.toISOString().slice(0, 10)).toBe("2026-02-01");

    // Visible in the org feed too.
    const feedRes = await request(app).get("/api/engage/posts?kind=AUTO_JOINING").set(...authHeader(hrToken));
    expect(feedRes.body.rows.some((r: { id: string }) => r.id === posts[0]!.id)).toBe(true);
  });
});
