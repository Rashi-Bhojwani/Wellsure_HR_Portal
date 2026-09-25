import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import { cleanupTestData, type TestOrgMasters } from "../../../lib/__tests__/testHelpers";
import { app, cleanupTestUser, clearRateLimits, createTestOrgMasters, createTestUser } from "./authTestHelpers";

async function createInvitation(userId: string, opts: { expired?: boolean; used?: boolean } = {}) {
  const rawToken = `invite-${userId}-${Date.now()}`;
  await prisma.invitationToken.create({
    data: {
      userId,
      tokenHash: createHash("sha256").update(rawToken).digest("hex"),
      expiresAt: new Date(Date.now() + (opts.expired ? -1000 : 48 * 60 * 60 * 1000)),
      usedAt: opts.used ? new Date() : null,
    },
  });
  return rawToken;
}

describe("invitation accept", () => {
  let org: TestOrgMasters;
  const employeeIds: string[] = [];

  beforeAll(async () => {
    org = await createTestOrgMasters();
  });
  beforeEach(clearRateLimits);
  afterAll(async () => {
    for (const id of employeeIds) await cleanupTestUser(id);
    await cleanupTestData({ org });
  });

  it("GET returns the employee's name/code for a valid token", async () => {
    const user = await createTestUser(org, { status: "INVITED" });
    employeeIds.push(user.employeeId);
    const token = await createInvitation(user.userId);

    const res = await request(app).get(`/api/auth/invitations/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.employeeCode).toBe(user.employeeCode);
  });

  it("rejects an expired invitation", async () => {
    const user = await createTestUser(org, { status: "INVITED" });
    employeeIds.push(user.employeeId);
    const token = await createInvitation(user.userId, { expired: true });

    const res = await request(app).get(`/api/auth/invitations/${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_INVITATION");
  });

  it("accepting sets a password, activates the account, and logs the user in", async () => {
    const user = await createTestUser(org, { status: "INVITED" });
    employeeIds.push(user.employeeId);
    const token = await createInvitation(user.userId);

    const res = await request(app).post(`/api/auth/invitations/${token}/accept`).send({ password: "BrandNewPass1" });
    expect(res.status).toBe(200);
    // A successful direct login omits `status` (just {accessToken, user});
    // only the 2FA-challenge branches include it — see controller.ts's
    // sendLoginResult.
    expect(res.body.accessToken !== undefined || res.body.status === "requires_totp_setup").toBe(true);

    const dbUser = await prisma.user.findUnique({ where: { id: user.userId } });
    expect(dbUser?.status).toBe("ACTIVE");
    expect(dbUser?.passwordHash).not.toBeNull();
  });

  it("the same invitation token cannot be accepted twice", async () => {
    const user = await createTestUser(org, { status: "INVITED" });
    employeeIds.push(user.employeeId);
    const token = await createInvitation(user.userId);

    await request(app).post(`/api/auth/invitations/${token}/accept`).send({ password: "BrandNewPass1" });
    const secondAttempt = await request(app).post(`/api/auth/invitations/${token}/accept`).send({ password: "SomethingElse2" });
    expect(secondAttempt.status).toBe(400);
    expect(secondAttempt.body.error.code).toBe("INVALID_INVITATION");
  });

  it("rejects a weak password", async () => {
    const user = await createTestUser(org, { status: "INVITED" });
    employeeIds.push(user.employeeId);
    const token = await createInvitation(user.userId);

    const res = await request(app).post(`/api/auth/invitations/${token}/accept`).send({ password: "weak" });
    expect(res.status).toBe(400);
  });
});
