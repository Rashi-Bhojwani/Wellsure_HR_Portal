import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../../lib/prisma";
import { redis } from "../../../lib/redis";
import { LOGIN_TOO_MANY_MESSAGE } from "../service";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, TEST_PASSWORD, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";

// FIX-H2 (independent audit 2026-11-20, finding H2): "10 mistyped logins from one office IP block every login from that IP for 15 minutes, correct passwords
// included. Ask HR to unlock cannot clear it." Every supertest request comes from the same loopback address: an office behind one address.
type P = { employeeId: string; employeeCode: string; userId: string };

describe("FIX-H2: one office address never locks out the whole office", () => {
  let org: TestOrgMasters;
  let alice: P, bob: P, hr: P, dir: P, dev: P, dir2: P;
  let tHr: string, tDir: string, tDev: string;
  const login = (employeeCode: string, password: string) => request(app).post("/api/auth/login").send({ employeeCode, password });
  const clearCounters = async () => {
    const keys = await redis.keys("ratelimit:*");
    if (keys.length) await redis.del(...keys);
  };
  const setLimit = async (maxAttempts: number) => {
    const p = await prisma.behaviourProposal.create({ data: { key: "auth.loginIpFailureLimit", value: { maxAttempts, windowSeconds: 900 }, reason: "fix-h2 test", proposedByUserId: dir.userId } });
    await prisma.behaviourConfirmation.create({ data: { proposalId: p.id, confirmedByUserId: dir2.userId } });
  };

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    [alice, bob, hr, dir, dir2, dev] = [
      await createFullTestEmployee(org),
      await createFullTestEmployee(org),
      await createFullTestEmployee(org, { roleCode: "HR_ADMIN" }),
      await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" }),
      await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" }),
      await createFullTestEmployee(org, { roleCode: "DEVELOPER" }),
    ];
    [tHr, tDir, tDev] = [await loginAs(hr.employeeCode), await loginAs(dir.employeeCode), await loginAs(dev.employeeCode)];
  });
  afterAll(async () => {
    await clearCounters();
    for (const p of [alice, bob, hr, dir, dir2, dev]) await cleanupFullTestEmployee(p.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("the default per-address limit is 100 failures in 15 minutes, and a director setting", async () => {
    const { BEHAVIOURS } = await import("../../behaviours/service");
    expect(BEHAVIOURS["auth.loginIpFailureLimit"].defaultValue).toEqual({ maxAttempts: 100, windowSeconds: 900 });
  });

  it("the audit's case: 10 typos from one address across different numbers do not block anyone's correct sign-in", async () => {
    await clearCounters();
    for (let i = 0; i < 10; i += 1) expect((await login(`NOBODY-${i}`, "wrong-password")).status).toBe(401);
    expect((await login(alice.employeeCode, TEST_PASSWORD)).status).toBe(200);
    expect((await login(bob.employeeCode, TEST_PASSWORD)).status).toBe(200);
  });

  // Changed 2026-11-21 (final full run): an address over its limit stops every sign-in from it, correct passwords included, so a password spray (one guess per
  // number, each number fresh) is limited; the limit is far above an office's typos, and a director or an HR Admin clears it (next tests).
  it("over its limit, an address waits for everyone (a password spray across fresh numbers is stopped), with the same 'Too many attempts' reply", async () => {
    await clearCounters();
    await setLimit(10);
    try {
      for (let i = 0; i < 10; i += 1) await login(`NOBODY-${i}`, "wrong-password");
      const spray = await login("NOBODY-FRESH", "wrong-password");
      expect([spray.status, spray.body.error.message]).toEqual([429, LOGIN_TOO_MANY_MESSAGE]);
      const correct = await login(alice.employeeCode, TEST_PASSWORD);
      expect([correct.status, correct.body.error.message]).toEqual([429, LOGIN_TOO_MANY_MESSAGE]);
      expect(correct.body).toEqual(spray.body); // the reply never says whether the number exists or the password was right
      await clearCounters();
      expect((await login(alice.employeeCode, TEST_PASSWORD)).status).toBe(200);
    } finally {
      await setLimit(100);
    }
  });

  it("the per-number limit stays: five wrong passwords lock that number, and unlocking clears both counters", async () => {
    await clearCounters();
    await setLimit(10);
    try {
      for (let i = 0; i < 5; i += 1) await login(bob.employeeCode, "wrong-password");
      for (let i = 0; i < 6; i += 1) await login(`NOBODY-${i}`, "wrong-password");
      expect((await login(bob.employeeCode, TEST_PASSWORD)).status).toBe(429);
      expect(Number(await redis.get("ratelimit:auth.loginFail.ip:::ffff:127.0.0.1")) || Number(await redis.get("ratelimit:auth.loginFail.ip:127.0.0.1")) || Number(await redis.get("ratelimit:auth.loginFail.ip:::1"))).toBeGreaterThanOrEqual(10);
      await request(app).post(`/api/access/employees/${bob.employeeId}/unlock`).set(...authHeader(tDir)).send({ reason: "fix-h2 test unlock" }).expect(200);
      const ipKeys = await redis.keys("ratelimit:auth.loginFail.ip:*");
      expect(ipKeys).toEqual([]);
      expect((await login(bob.employeeCode, TEST_PASSWORD)).status).toBe(200);
    } finally {
      await setLimit(100);
    }
  });

  it("a director or an HR Admin sees and clears an address block; the Developer and an employee cannot", async () => {
    await clearCounters();
    await setLimit(10);
    try {
      const tAlice = (await login(alice.employeeCode, TEST_PASSWORD)).body.accessToken as string; // signed in before the address is blocked
      for (let i = 0; i < 10; i += 1) await login(`NOBODY-${i}`, "wrong-password");
      const list = await request(app).get("/api/access/login-blocks").set(...authHeader(tHr));
      expect(list.status).toBe(200);
      expect(list.body.blocks.length).toBe(1);
      expect((await request(app).get("/api/access/login-blocks").set(...authHeader(tDev))).status).toBe(403);
      expect((await request(app).get("/api/access/login-blocks").set(...authHeader(tAlice))).status).toBe(403);
      const ip = encodeURIComponent(list.body.blocks[0].ip);
      expect((await request(app).delete(`/api/access/login-blocks/${ip}`).set(...authHeader(tDev)).send({ reason: "nope" })).status).toBe(403);
      const cleared = await request(app).delete(`/api/access/login-blocks/${ip}`).set(...authHeader(tHr)).send({ reason: "office typos" });
      expect([cleared.status, cleared.body.cleared]).toEqual([200, true]);
      expect((await request(app).get("/api/access/login-blocks").set(...authHeader(tDir))).body.blocks).toEqual([]);
      expect(await prisma.auditLog.count({ where: { action: "auth.ip_block.cleared", actorUserId: hr.userId } })).toBe(1);
    } finally {
      await setLimit(100);
    }
  });
});
