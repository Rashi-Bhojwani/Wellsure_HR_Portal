import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import { cleanupTestData, type TestOrgMasters } from "../../../lib/__tests__/testHelpers";
import { app, cleanupTestUser, clearRateLimits, createTestOrgMasters, createTestUser, TEST_PASSWORD } from "./authTestHelpers";

// forgot-password is rate-limited to 5/hour (routes.ts) — well below what
// this file's own tests collectively send, so every test in this
// describe block runs with rate limiting cleared first.

async function timeRequest(fn: () => Promise<unknown>): Promise<number> {
  const start = process.hrtime.bigint();
  await fn();
  return Number(process.hrtime.bigint() - start) / 1_000_000; // ms
}

describe("forgot-password / reset-password", () => {
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

  it("returns an identical response body for an existing vs. a non-existent Employee Code", async () => {
    const user = await createTestUser(org);
    employeeIds.push(user.employeeId);

    const existing = await request(app).post("/api/auth/forgot-password").send({ employeeCode: user.employeeCode });
    const missing = await request(app).post("/api/auth/forgot-password").send({ employeeCode: "NO-SUCH-CODE" });

    expect(existing.status).toBe(missing.status);
    expect(existing.body).toEqual(missing.body);
  });

  it("takes approximately the same time for an existing vs. a non-existent Employee Code", async () => {
    const user = await createTestUser(org);
    employeeIds.push(user.employeeId);

    // Average a few samples each way to smooth out normal jitter — a real
    // timing leak (e.g. skipping the email-send branch entirely) would show
    // up as a large, consistent gap, not sub-tolerance noise.
    const SAMPLES = 5;
    const existingTimes: number[] = [];
    const missingTimes: number[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      // Rate limit is 5/hour — clear it each iteration so it never
      // interferes with the timing being measured.
      await clearRateLimits();
      existingTimes.push(
        await timeRequest(() => request(app).post("/api/auth/forgot-password").send({ employeeCode: user.employeeCode })),
      );
      await clearRateLimits();
      missingTimes.push(
        await timeRequest(() => request(app).post("/api/auth/forgot-password").send({ employeeCode: `NO-SUCH-${i}` })),
      );
    }
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const existingAvg = avg(existingTimes);
    const missingAvg = avg(missingTimes);

    // Both should sit close to the 200ms floor service.ts pads to; the gap
    // between them should be small relative to that floor.
    expect(Math.abs(existingAvg - missingAvg)).toBeLessThan(100);
  });

  it("creates a usable reset token only for an existing, active account", async () => {
    const user = await createTestUser(org);
    employeeIds.push(user.employeeId);

    await request(app).post("/api/auth/forgot-password").send({ employeeCode: user.employeeCode });
    const count = await prisma.passwordResetToken.count({ where: { userId: user.userId } });
    expect(count).toBe(1);
  });

  it("does not create a reset token for an INVITED account (not yet a real login to reset)", async () => {
    const user = await createTestUser(org, { status: "INVITED" });
    employeeIds.push(user.employeeId);

    await request(app).post("/api/auth/forgot-password").send({ employeeCode: user.employeeCode });
    const count = await prisma.passwordResetToken.count({ where: { userId: user.userId } });
    expect(count).toBe(0);
  });

  it("resets the password with a valid token, and the token can't be reused", async () => {
    const user = await createTestUser(org);
    employeeIds.push(user.employeeId);

    const rawToken = "test-raw-reset-token-1234567890";
    await prisma.passwordResetToken.create({
      data: {
        userId: user.userId,
        tokenHash: createHash("sha256").update(rawToken).digest("hex"),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const resetRes = await request(app).post(`/api/auth/reset-password/${rawToken}`).send({ password: "BrandNewPass1" });
    expect(resetRes.status).toBe(200);

    const loginRes = await request(app).post("/api/auth/login").send({ employeeCode: user.employeeCode, password: "BrandNewPass1" });
    expect(loginRes.status).toBe(200);

    const reuseRes = await request(app).post(`/api/auth/reset-password/${rawToken}`).send({ password: "AnotherPass2" });
    expect(reuseRes.status).toBe(400);
    expect(reuseRes.body.error.code).toBe("INVALID_RESET_TOKEN");
  });

  it("rejects an expired reset token", async () => {
    const user = await createTestUser(org);
    employeeIds.push(user.employeeId);

    const rawToken = "test-raw-reset-token-expired-0987";
    await prisma.passwordResetToken.create({
      data: {
        userId: user.userId,
        tokenHash: createHash("sha256").update(rawToken).digest("hex"),
        expiresAt: new Date(Date.now() - 1000), // already expired
      },
    });

    const res = await request(app).post(`/api/auth/reset-password/${rawToken}`).send({ password: "BrandNewPass1" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_RESET_TOKEN");
  });

  it("reset-password revokes all existing sessions for the account", async () => {
    const user = await createTestUser(org);
    employeeIds.push(user.employeeId);

    const loginRes = await request(app).post("/api/auth/login").send({ employeeCode: user.employeeCode, password: TEST_PASSWORD });
    const cookie = (loginRes.headers["set-cookie"]?.[0] as string).split(";")[0]!;

    const rawToken = "test-raw-reset-token-revoke-5555";
    await prisma.passwordResetToken.create({
      data: {
        userId: user.userId,
        tokenHash: createHash("sha256").update(rawToken).digest("hex"),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    await request(app).post(`/api/auth/reset-password/${rawToken}`).send({ password: "BrandNewPass1" });

    const refreshRes = await request(app).post("/api/auth/refresh").set("Cookie", cookie);
    expect(refreshRes.status).toBe(401);
  });
});
