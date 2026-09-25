import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { cleanupTestData, type TestOrgMasters } from "../../../lib/__tests__/testHelpers";
import { app, cleanupTestUser, clearRateLimits, createTestOrgMasters, createTestUser, TEST_PASSWORD } from "./authTestHelpers";

function refreshCookie(res: request.Response): string {
  const cookie = res.headers["set-cookie"]?.[0] as string | undefined;
  if (!cookie) throw new Error("no refreshToken cookie in response");
  return cookie;
}

describe("refresh, logout and sessions", () => {
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

  async function loginAndGetCookie(employeeCode: string) {
    const res = await request(app).post("/api/auth/login").send({ employeeCode, password: TEST_PASSWORD });
    return refreshCookie(res);
  }

  it("rotates the refresh token on /refresh and issues a new access token", async () => {
    const user = await createTestUser(org);
    employeeIds.push(user.employeeId);
    const cookie = await loginAndGetCookie(user.employeeCode);

    const res = await request(app).post("/api/auth/refresh").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTypeOf("string");
    const newCookie = refreshCookie(res);
    expect(newCookie).not.toBe(cookie);
  });

  it("rejects reuse of an already-rotated refresh token, and revokes the whole chain", async () => {
    const user = await createTestUser(org);
    employeeIds.push(user.employeeId);
    const cookie = await loginAndGetCookie(user.employeeCode);

    const firstRefresh = await request(app).post("/api/auth/refresh").set("Cookie", cookie);
    const newCookie = refreshCookie(firstRefresh);

    // Reusing the old (now-rotated) cookie must fail...
    const reuseRes = await request(app).post("/api/auth/refresh").set("Cookie", cookie);
    expect(reuseRes.status).toBe(401);
    expect(reuseRes.body.error.code).toBe("TOKEN_REUSE_DETECTED");

    // ...and must have revoked the token that replaced it too (whole chain killed).
    const followUpRes = await request(app).post("/api/auth/refresh").set("Cookie", newCookie);
    expect(followUpRes.status).toBe(401);
  });

  it("logout revokes only the current session, leaving others active", async () => {
    const user = await createTestUser(org);
    employeeIds.push(user.employeeId);
    const loginA = await request(app).post("/api/auth/login").send({ employeeCode: user.employeeCode, password: TEST_PASSWORD });
    const loginB = await request(app).post("/api/auth/login").send({ employeeCode: user.employeeCode, password: TEST_PASSWORD });
    const cookieA = refreshCookie(loginA);
    const cookieB = refreshCookie(loginB);

    await request(app).post("/api/auth/logout").set("Cookie", cookieA).set("Authorization", `Bearer ${loginA.body.accessToken}`);

    const refreshA = await request(app).post("/api/auth/refresh").set("Cookie", cookieA);
    expect(refreshA.status).toBe(401);

    const refreshB = await request(app).post("/api/auth/refresh").set("Cookie", cookieB);
    expect(refreshB.status).toBe(200);
  });

  it("logout-all revokes every session for the user", async () => {
    const user = await createTestUser(org);
    employeeIds.push(user.employeeId);
    const loginA = await request(app).post("/api/auth/login").send({ employeeCode: user.employeeCode, password: TEST_PASSWORD });
    const loginB = await request(app).post("/api/auth/login").send({ employeeCode: user.employeeCode, password: TEST_PASSWORD });

    await request(app).post("/api/auth/logout-all").set("Authorization", `Bearer ${loginA.body.accessToken}`);

    const refreshA = await request(app).post("/api/auth/refresh").set("Cookie", refreshCookie(loginA));
    const refreshB = await request(app).post("/api/auth/refresh").set("Cookie", refreshCookie(loginB));
    expect(refreshA.status).toBe(401);
    expect(refreshB.status).toBe(401);
  });

  it("GET /sessions only lists the requesting user's own sessions", async () => {
    const userA = await createTestUser(org);
    const userB = await createTestUser(org);
    employeeIds.push(userA.employeeId, userB.employeeId);

    await request(app).post("/api/auth/login").send({ employeeCode: userA.employeeCode, password: TEST_PASSWORD });
    const loginA2 = await request(app).post("/api/auth/login").send({ employeeCode: userA.employeeCode, password: TEST_PASSWORD });
    await request(app).post("/api/auth/login").send({ employeeCode: userB.employeeCode, password: TEST_PASSWORD });

    const res = await request(app).get("/api/auth/sessions").set("Authorization", `Bearer ${loginA2.body.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.sessions.length).toBe(2); // only userA's two logins, never userB's
  });

  it("IDOR: cannot revoke another user's session by id", async () => {
    const userA = await createTestUser(org);
    const userB = await createTestUser(org);
    employeeIds.push(userA.employeeId, userB.employeeId);

    const loginA = await request(app).post("/api/auth/login").send({ employeeCode: userA.employeeCode, password: TEST_PASSWORD });
    const loginB = await request(app).post("/api/auth/login").send({ employeeCode: userB.employeeCode, password: TEST_PASSWORD });

    const sessionsB = await request(app).get("/api/auth/sessions").set("Authorization", `Bearer ${loginB.body.accessToken}`);
    const sessionBId = sessionsB.body.sessions[0].id as string;

    // userA tries to revoke one of userB's sessions.
    const res = await request(app)
      .delete(`/api/auth/sessions/${sessionBId}`)
      .set("Authorization", `Bearer ${loginA.body.accessToken}`);
    expect(res.status).toBe(404); // never confirms the session exists for someone else

    // Proof it wasn't actually revoked: userB's session still refreshes fine.
    const refreshB = await request(app).post("/api/auth/refresh").set("Cookie", refreshCookie(loginB));
    expect(refreshB.status).toBe(200);
  });
});
