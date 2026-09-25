import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { generate } from "otplib";
import { prisma } from "../../../lib/prisma";
import { cleanupTestData, type TestOrgMasters } from "../../../lib/__tests__/testHelpers";
import { app, cleanupTestRole, cleanupTestUser, clearRateLimits, createTestOrgMasters, createTestUser, TEST_PASSWORD } from "./authTestHelpers";

describe("POST /api/auth/login", () => {
  let org: TestOrgMasters;
  const employeeIds: string[] = [];
  const roleCode = `TEST_ROLE_LOGIN_${Date.now()}`;

  beforeAll(async () => {
    org = await createTestOrgMasters();
  });

  beforeEach(clearRateLimits);

  afterAll(async () => {
    await cleanupTestRole(roleCode);
    for (const id of employeeIds) await cleanupTestUser(id);
    await cleanupTestData({ org });
  });

  it("succeeds with the correct Employee Code and password, no 2FA required", async () => {
    const user = await createTestUser(org);
    employeeIds.push(user.employeeId);

    const res = await request(app)
      .post("/api/auth/login")
      .send({ employeeCode: user.employeeCode, password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTypeOf("string");
    expect(res.body.user.employeeCode).toBe(user.employeeCode);
    expect(res.headers["set-cookie"]?.[0]).toMatch(/refreshToken=/);
  });

  it("rejects an unknown Employee Code with a generic message", async () => {
    const res = await request(app).post("/api/auth/login").send({ employeeCode: "NO-SUCH-CODE", password: "whatever123" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("rejects a wrong password with the SAME generic message as an unknown code", async () => {
    const user = await createTestUser(org);
    employeeIds.push(user.employeeId);

    const res = await request(app).post("/api/auth/login").send({ employeeCode: user.employeeCode, password: "wrong-password" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("gives a distinct message for an INVITED (not yet activated) account", async () => {
    const user = await createTestUser(org, { status: "INVITED" });
    employeeIds.push(user.employeeId);

    const res = await request(app).post("/api/auth/login").send({ employeeCode: user.employeeCode, password: TEST_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("NOT_ACTIVATED");
  });

  it("locks the account after 5 failed attempts, and rejects even the correct password while locked", async () => {
    const user = await createTestUser(org);
    employeeIds.push(user.employeeId);

    for (let i = 0; i < 5; i++) {
      await request(app).post("/api/auth/login").send({ employeeCode: user.employeeCode, password: "wrong-password" });
    }

    const lockedRes = await request(app).post("/api/auth/login").send({ employeeCode: user.employeeCode, password: TEST_PASSWORD });
    expect(lockedRes.status).toBe(423);
    expect(lockedRes.body.error.code).toBe("LOCKED");

    const dbUser = await prisma.user.findUnique({ where: { id: user.userId } });
    expect(dbUser?.lockedUntil).not.toBeNull();
  });

  describe("2FA-required roles", () => {
    beforeAll(async () => {
      const settings = await prisma.systemSetting.findUnique({ where: { key: "auth.require2faRoles" } });
      if (!settings) {
        await prisma.systemSetting.create({ data: { key: "auth.require2faRoles", value: [roleCode] } });
      }
    });
    afterAll(async () => {
      await prisma.systemSetting.deleteMany({ where: { key: "auth.require2faRoles" } });
    });

    it("returns requires_totp_setup on first login for a role that requires 2FA and hasn't enrolled", async () => {
      const user = await createTestUser(org, { roleCode });
      employeeIds.push(user.employeeId);

      const res = await request(app).post("/api/auth/login").send({ employeeCode: user.employeeCode, password: TEST_PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("requires_totp_setup");
      expect(res.body.challengeToken).toBeTypeOf("string");
      expect(res.body.accessToken).toBeUndefined();
    });

    it("full setup-then-login flow: setup -> verify -> access token issued", async () => {
      const user = await createTestUser(org, { roleCode });
      employeeIds.push(user.employeeId);

      const loginRes = await request(app).post("/api/auth/login").send({ employeeCode: user.employeeCode, password: TEST_PASSWORD });
      const challengeToken = loginRes.body.challengeToken as string;

      const setupRes = await request(app).post("/api/auth/2fa/setup").send({ challengeToken });
      expect(setupRes.status).toBe(200);
      const secret = setupRes.body.secret as string;

      const code = await generate({ secret });
      const verifyRes = await request(app).post("/api/auth/2fa/verify").send({ challengeToken, code });
      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.accessToken).toBeTypeOf("string");
      expect(verifyRes.body.backupCodes).toHaveLength(10);

      const dbUser = await prisma.user.findUnique({ where: { id: user.userId } });
      expect(dbUser?.totpEnabled).toBe(true);
    });

    it("returns requires_totp (not requires_totp_setup) once 2FA is already enrolled", async () => {
      const user = await createTestUser(org, { roleCode });
      employeeIds.push(user.employeeId);

      const firstLogin = await request(app).post("/api/auth/login").send({ employeeCode: user.employeeCode, password: TEST_PASSWORD });
      const setupRes = await request(app).post("/api/auth/2fa/setup").send({ challengeToken: firstLogin.body.challengeToken });
      const code = await generate({ secret: setupRes.body.secret });
      await request(app).post("/api/auth/2fa/verify").send({ challengeToken: firstLogin.body.challengeToken, code });

      const secondLogin = await request(app).post("/api/auth/login").send({ employeeCode: user.employeeCode, password: TEST_PASSWORD });
      expect(secondLogin.status).toBe(200);
      expect(secondLogin.body.status).toBe("requires_totp");
    });
  });
});
