import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import { cleanupTestData, type TestOrgMasters } from "../../../lib/__tests__/testHelpers";
import { app, cleanupTestUser, clearRateLimits, createTestOrgMasters, createTestUser, TEST_PASSWORD } from "./authTestHelpers";

describe("deactivation takes effect immediately, not just at token expiry", () => {
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

  it("rejects a still-cryptographically-valid, unexpired access token the moment the account is deactivated", async () => {
    const user = await createTestUser(org);
    employeeIds.push(user.employeeId);

    const loginRes = await request(app).post("/api/auth/login").send({ employeeCode: user.employeeCode, password: TEST_PASSWORD });
    const accessToken = loginRes.body.accessToken as string;

    // Confirm the token genuinely works first.
    const beforeRes = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${accessToken}`);
    expect(beforeRes.status).toBe(200);

    // Deactivate directly (simulating an HR action, or a future
    // /employees/:id/deactivate endpoint) — no new token is issued, and
    // the existing one's JWT signature/expiry are untouched.
    await prisma.user.update({ where: { id: user.userId }, data: { status: "DEACTIVATED" } });

    // The exact same access token, still well within its 15m expiry, must
    // now be rejected — proves the check re-reads live account status on
    // every request rather than trusting the token alone.
    const afterRes = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${accessToken}`);
    expect(afterRes.status).toBe(401);
  });

  it("also rejects a deactivated account's refresh token", async () => {
    const user = await createTestUser(org);
    employeeIds.push(user.employeeId);

    const loginRes = await request(app).post("/api/auth/login").send({ employeeCode: user.employeeCode, password: TEST_PASSWORD });
    const cookie = (loginRes.headers["set-cookie"]?.[0] as string).split(";")[0]!;

    await prisma.user.update({ where: { id: user.userId }, data: { status: "DEACTIVATED" } });

    const refreshRes = await request(app).post("/api/auth/refresh").set("Cookie", cookie);
    expect(refreshRes.status).toBe(401);
  });

  it("a SUSPENDED account is likewise rejected mid-session", async () => {
    const user = await createTestUser(org);
    employeeIds.push(user.employeeId);

    const loginRes = await request(app).post("/api/auth/login").send({ employeeCode: user.employeeCode, password: TEST_PASSWORD });
    const accessToken = loginRes.body.accessToken as string;

    await prisma.user.update({ where: { id: user.userId }, data: { status: "SUSPENDED" } });

    const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(401);
  });
});
