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

  describe("two-step sign-in for directors is optional", () => {
    const KEY = "auth.requireDirectorTwoFactor";
    afterAll(async () => {
      await prisma.systemSetting.deleteMany({ where: { key: KEY } });
    });
    it("a director signs in normally without it by default; once the owners make it compulsory the same director is asked to enrol; turned off again, they sign in normally", async () => {
      const director = await createTestUser(org, { roleCode: "SUPER_ADMIN" });
      employeeIds.push(director.employeeId);
      await prisma.systemSetting.deleteMany({ where: { key: KEY } });
      const normal = await request(app).post("/api/auth/login").send({ employeeCode: director.employeeCode, password: TEST_PASSWORD });
      expect([normal.status, normal.body.status === "requires_totp_setup", typeof normal.body.accessToken]).toEqual([200, false, "string"]);
      await prisma.systemSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: true }, update: { value: true } });
      const asked = await request(app).post("/api/auth/login").send({ employeeCode: director.employeeCode, password: TEST_PASSWORD });
      expect([asked.status, asked.body.status, asked.body.accessToken]).toEqual([200, "requires_totp_setup", undefined]);
      await prisma.systemSetting.update({ where: { key: KEY }, data: { value: false } });
      const again = await request(app).post("/api/auth/login").send({ employeeCode: director.employeeCode, password: TEST_PASSWORD });
      expect(typeof again.body.accessToken).toBe("string");
    });
  });

  describe("2FA-required roles", () => {
    // auth.require2faRoles is a global singleton (spec §7.8's System
    // Settings), not something this suite owns — snapshot whatever's
    // already there (a real seeded value, or nothing) and restore it
    // exactly afterward, rather than assuming the row doesn't exist yet
    // and never touching it back.
    let originalValue: unknown;
    let hadRow = false;
    beforeAll(async () => {
      const existing = await prisma.systemSetting.findUnique({ where: { key: "auth.require2faRoles" } });
      hadRow = !!existing;
      originalValue = existing?.value;
      await prisma.systemSetting.upsert({
        where: { key: "auth.require2faRoles" },
        create: { key: "auth.require2faRoles", value: [roleCode] },
        update: { value: [roleCode] },
      });
    });
    afterAll(async () => {
      if (hadRow) {
        await prisma.systemSetting.update({ where: { key: "auth.require2faRoles" }, data: { value: originalValue as never } });
      } else {
        await prisma.systemSetting.deleteMany({ where: { key: "auth.require2faRoles" } });
      }
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
