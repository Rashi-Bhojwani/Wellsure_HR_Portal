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
} from "./employeeTestHelpers";

const MAIL_DIR = path.resolve(process.cwd(), env.MAIL_DEV_DIR);

// Reads the .eml files the ConsoleMailService has written,
// finds the one addressed to `toEmail`, and pulls the /set-password/:token
// link out of its body — the same link a real new hire would click from
// their inbox (spec §3's onboarding flow).
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

describe("Full onboarding, end to end: HR creates an employee -> invite email -> set password -> login -> sees only their own data", () => {
  const hrRole = `TEST_E2E_HR_${Date.now()}`;
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
    for (const id of employeeIds) await cleanupFullTestEmployee(id);
    await cleanupTestRole(hrRole);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("runs the full flow and the new hire ends up scoped to only their own data", async () => {
    const suffix = randomUUID().slice(0, 8);
    const employeeCode = `E2E-${suffix}`;
    const personalEmail = `e2e.onboarding.${suffix}@gmail.com`;

    // 1. HR creates the employee through the real Add Employee endpoint —
    // the same one the wizard's UI submits to.
    const createRes = await request(app)
      .post("/api/employees")
      .set(...authHeader(hrToken))
      .send({
        official: {
          deviceUserId: employeeCode,
          employeeCode,
          dateOfJoining: "2026-01-01",
          departmentId: org.departmentId,
          designationId: org.designationId,
          locationId: org.locationId,
          employmentType: "PERMANENT",
        },
        personal: {
          fullName: "End To End Testerson",
          dateOfBirth: "1995-06-15",
          gender: "OTHER",
          personalEmail,
          mobile: "9876500000",
          currentAddress: "1 E2E Street",
          permanentAddress: "1 E2E Street",
          emergencyContactName: "Emergency Contact",
          emergencyContactPhone: "9876500001",
          emergencyContactRelation: "Friend",
        },
      });
    expect(createRes.status).toBe(201);
    const newEmployeeId = createRes.body.id as string;
    employeeIds.push(newEmployeeId);

    // 2. The invitation email actually landed in .mail/ (spec's local dev
    // MailService — no real email provider involved).
    const token = await findInvitationTokenInMail(personalEmail);
    expect(token).toBeTruthy();

    // 3. The new hire follows the link and sets their password.
    const acceptRes = await request(app).post(`/api/auth/invitations/${token}/accept`).send({ password: "NewHirePass123" });
    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.accessToken).toBeTypeOf("string");

    // 4. They can log in with the password they just set.
    const loginRes = await request(app).post("/api/auth/login").send({ employeeCode, password: "NewHirePass123" });
    expect(loginRes.status).toBe(200);
    const newHireToken = loginRes.body.accessToken as string;

    // 5. GET /me returns their own profile.
    const meRes = await request(app).get("/api/auth/me").set(...authHeader(newHireToken));
    expect(meRes.status).toBe(200);
    expect(meRes.body.employeeCode).toBe(employeeCode);
    expect(meRes.body.roleCodes).toContain("EMPLOYEE");

    // 6. A freshly-onboarded EMPLOYEE-role account holds no admin
    // permissions at all (seed.ts: EMPLOYEE's permission list is empty) —
    // they see their own data purely through the self-service /me route,
    // never through the admin grid or admin profile route, regardless of
    // whose id is requested.
    const meProfileRes = await request(app).get("/api/employees/me").set(...authHeader(newHireToken));
    expect(meProfileRes.status).toBe(200);
    expect(meProfileRes.body.employeeCode).toBe(employeeCode);

    const listRes = await request(app).get("/api/employees").set(...authHeader(newHireToken));
    expect(listRes.status).toBe(403); // no employee.view — not even a self-only list

    // The admin single-profile route is permission-gated before scope is
    // even considered, so it 403s for *any* id under this role — including
    // their own — never leaking whether some other id exists (IDOR).
    const hrEmployeeId = employeeIds[0]!;
    const otherRes = await request(app).get(`/api/employees/${hrEmployeeId}`).set(...authHeader(newHireToken));
    expect(otherRes.status).toBe(403);
    const ownViaAdminRouteRes = await request(app).get(`/api/employees/${newEmployeeId}`).set(...authHeader(newHireToken));
    expect(ownViaAdminRouteRes.status).toBe(403);

    const userRow = await prisma.user.findUnique({ where: { employeeId: newEmployeeId } });
    expect(userRow?.status).toBe("ACTIVE");
  });
});
