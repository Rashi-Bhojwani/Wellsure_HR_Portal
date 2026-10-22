import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { generate } from "otplib";
import { prisma } from "../../../lib/prisma";
import { cleanupTestData, type TestOrgMasters } from "../../../lib/__tests__/testHelpers";
import { app, cleanupTestUser, clearRateLimits, createTestOrgMasters, createTestUser, TEST_PASSWORD } from "./authTestHelpers";

// The second step of a login accepts the code of the step before, the current step and the step after (a phone clock a few seconds out; a code typed in the last
// second of its step), refuses anything two steps away, and refuses a code it has already accepted.

describe("2FA codes: the neighbouring step is accepted, a second use is not", () => {
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

  async function enrolled() {
    const user = await createTestUser(org);
    employeeIds.push(user.employeeId);
    const login = await request(app).post("/api/auth/login").send({ employeeCode: user.employeeCode, password: TEST_PASSWORD });
    const token = login.body.accessToken as string;
    const setup = await request(app).post("/api/auth/2fa/setup").set("Authorization", `Bearer ${token}`).send({});
    const secret = setup.body.secret as string;
    const now = Math.floor(Date.now() / 1000);
    // Enrol with the step before this one so the current and next steps are still unused afterwards.
    const verified = await request(app).post("/api/auth/2fa/verify").set("Authorization", `Bearer ${token}`).send({ code: await generate({ secret, epoch: now - 30 }) });
    expect(verified.status).toBe(200);
    return { user, secret };
  }

  async function secondStep(employeeCode: string, code: string) {
    const first = await request(app).post("/api/auth/login").send({ employeeCode, password: TEST_PASSWORD });
    expect(first.body.status, JSON.stringify(first.body)).toBe("requires_totp");
    return request(app).post("/api/auth/login/totp").send({ challengeToken: first.body.challengeToken, code });
  }

  it("asks for the code at login from anyone who turned 2FA on, even in a role that does not require it", async () => {
    const { user } = await enrolled();
    const first = await request(app).post("/api/auth/login").send({ employeeCode: user.employeeCode, password: TEST_PASSWORD });
    expect(first.status).toBe(200);
    expect(first.body.status).toBe("requires_totp");
    expect(first.body.accessToken).toBeUndefined();
  });

  it("accepts the next step's code and the previous step's code", async () => {
    const { user, secret } = await enrolled();
    const now = Math.floor(Date.now() / 1000);
    const next = await secondStep(user.employeeCode, await generate({ secret, epoch: now + 30 }));
    expect(next.status).toBe(200);
    const current = await secondStep(user.employeeCode, await generate({ secret, epoch: now }));
    expect(current.status).toBe(200);
  });

  it("refuses a code from two steps away", async () => {
    const { user, secret } = await enrolled();
    const now = Math.floor(Date.now() / 1000);
    expect((await secondStep(user.employeeCode, await generate({ secret, epoch: now + 90 }))).status).toBe(401);
    expect((await secondStep(user.employeeCode, await generate({ secret, epoch: now - 90 }))).status).toBe(401);
  });

  it("refuses a code that has already been accepted (replay), and the same code is fine for another person", async () => {
    const a = await enrolled();
    const b = await enrolled();
    const now = Math.floor(Date.now() / 1000);
    const codeA = await generate({ secret: a.secret, epoch: now });
    expect((await secondStep(a.user.employeeCode, codeA)).status).toBe(200);
    const replay = await secondStep(a.user.employeeCode, codeA);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe("INVALID_TOTP");
    // The replay guard is per person: B's own code is unaffected by A having used a code.
    expect((await secondStep(b.user.employeeCode, await generate({ secret: b.secret, epoch: now }))).status).toBe(200);
    const row = await prisma.user.findUnique({ where: { id: a.user.userId } });
    expect(row?.totpEnabled).toBe(true);
  });
});
