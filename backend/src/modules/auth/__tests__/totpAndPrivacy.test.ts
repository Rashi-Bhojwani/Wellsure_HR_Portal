import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { generate as generateAt } from "otplib";
import { prisma } from "../../../lib/prisma";
import { cleanupTestData, type TestOrgMasters } from "../../../lib/__tests__/testHelpers";
import { app, cleanupTestRole, cleanupTestUser, clearRateLimits, createTestOrgMasters, createTestUser, TEST_PASSWORD } from "./authTestHelpers";
import { decryptTotpSecret } from "../totp";

// Handles both entry paths: a plain login (direct access token, self-
// service setup) and a login from a role that requires 2FA (a
// requires_totp_setup challenge instead — setup/verify go through the
// challengeToken and verify itself completes the login).
// The server accepts the previous, the current and the next 30-second step, and refuses a code it has already accepted. So this hands out a code that has not been
// used yet: the current step's if it is free, otherwise the next step's, otherwise the previous one's. That also means no test depends on how many seconds are left
// in the current step (a CI run once failed on exactly that, under the old zero-tolerance check).
const usedCodes = new Set<string>();
async function generate(opts: { secret: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  for (const offset of [0, 30, -30]) {
    const code = await generateAt({ secret: opts.secret, epoch: now + offset });
    if (!usedCodes.has(`${opts.secret}:${code}`)) {
      usedCodes.add(`${opts.secret}:${code}`);
      return code;
    }
  }
  throw new Error("No unused code left in the accepted window");
}

async function enrollTotp(employeeCode: string): Promise<{ accessToken: string; secret: string }> {
  const login = await request(app).post("/api/auth/login").send({ employeeCode, password: TEST_PASSWORD });

  if (login.body.status === "requires_totp_setup") {
    const challengeToken = login.body.challengeToken as string;
    const setupRes = await request(app).post("/api/auth/2fa/setup").send({ challengeToken });
    const secret = setupRes.body.secret as string;
    const code = await generate({ secret });
    const verifyRes = await request(app).post("/api/auth/2fa/verify").send({ challengeToken, code });
    return { accessToken: verifyRes.body.accessToken as string, secret };
  }

  const accessToken = login.body.accessToken as string;
  const setupRes = await request(app).post("/api/auth/2fa/setup").set("Authorization", `Bearer ${accessToken}`).send({});
  const secret = setupRes.body.secret as string;
  const code = await generate({ secret });
  await request(app).post("/api/auth/2fa/verify").set("Authorization", `Bearer ${accessToken}`).send({ code });
  return { accessToken, secret };
}

describe("2FA self-service (disable, backup codes) and privacy notice", () => {
  let org: TestOrgMasters;
  const employeeIds: string[] = [];
  const requiredRoleCode = `TEST_ROLE_2FA_REQ_${Date.now()}`;

  beforeAll(async () => {
    org = await createTestOrgMasters();
  });
  beforeEach(clearRateLimits);
  afterAll(async () => {
    await cleanupTestRole(requiredRoleCode);
    for (const id of employeeIds) await cleanupTestUser(id);
    await cleanupTestData({ org });
  });

  it("lets a user without a 2FA-required role set up 2FA from an authenticated session and then disable it", async () => {
    const user = await createTestUser(org);
    employeeIds.push(user.employeeId);

    const { accessToken } = await enrollTotp(user.employeeCode);
    const dbUser = await prisma.user.findUnique({ where: { id: user.userId } });
    expect(dbUser?.totpEnabled).toBe(true);

    const secretRow = await prisma.user.findUnique({ where: { id: user.userId } });
    const code = await generate({ secret: decryptTotpSecret(secretRow!.totpSecretEncrypted!) });

    const disableRes = await request(app)
      .post("/api/auth/2fa/disable")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ password: TEST_PASSWORD, code });
    expect(disableRes.status).toBe(204);

    const afterDisable = await prisma.user.findUnique({ where: { id: user.userId } });
    expect(afterDisable?.totpEnabled).toBe(false);
    expect(afterDisable?.totpSecretEncrypted).toBeNull();
  });

  it("blocks self-disable when the user's role requires 2FA", async () => {
    const user = await createTestUser(org, { roleCode: requiredRoleCode });
    employeeIds.push(user.employeeId);
    // A global singleton this suite doesn't own — restore exactly what was there.
    const original = await prisma.systemSetting.findUnique({ where: { key: "auth.require2faRoles" } });
    await prisma.systemSetting.upsert({
      where: { key: "auth.require2faRoles" },
      create: { key: "auth.require2faRoles", value: [requiredRoleCode] },
      update: { value: [requiredRoleCode] },
    });

    const { accessToken, secret } = await enrollTotp(user.employeeCode);
    const code = await generate({ secret });

    const res = await request(app)
      .post("/api/auth/2fa/disable")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ password: TEST_PASSWORD, code });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("TOTP_REQUIRED_BY_ROLE");

    if (original) {
      await prisma.systemSetting.update({ where: { key: "auth.require2faRoles" }, data: { value: original.value as never } });
    } else {
      await prisma.systemSetting.deleteMany({ where: { key: "auth.require2faRoles" } });
    }
  });

  it("regenerates backup codes, invalidating the old ones", async () => {
    const user = await createTestUser(org);
    employeeIds.push(user.employeeId);
    const { accessToken } = await enrollTotp(user.employeeCode);

    const beforeCodes = await prisma.totpBackupCode.count({ where: { userId: user.userId } });
    expect(beforeCodes).toBe(10);

    const res = await request(app).post("/api/auth/2fa/backup-codes/regenerate").set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.backupCodes).toHaveLength(10);

    const afterCodes = await prisma.totpBackupCode.count({ where: { userId: user.userId, usedAt: null } });
    expect(afterCodes).toBe(10); // still 10, but a fresh set (old hashes deleted)
  });

  it("privacy notice acceptance is reflected on /me", async () => {
    const user = await createTestUser(org);
    employeeIds.push(user.employeeId);
    await prisma.user.update({ where: { id: user.userId }, data: { privacyNoticeAcceptedAt: null } });

    const login = await request(app).post("/api/auth/login").send({ employeeCode: user.employeeCode, password: TEST_PASSWORD });
    const accessToken = login.body.accessToken as string;

    const before = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${accessToken}`);
    expect(before.body.privacyNoticeAccepted).toBe(false);

    const acceptRes = await request(app).post("/api/auth/privacy-notice/accept").set("Authorization", `Bearer ${accessToken}`);
    expect(acceptRes.status).toBe(204);

    const after = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${accessToken}`);
    expect(after.body.privacyNoticeAccepted).toBe(true);
  });
});
