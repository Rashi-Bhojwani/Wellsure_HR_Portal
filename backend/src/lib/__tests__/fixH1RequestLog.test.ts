import { Writable } from "node:stream";
import pino from "pino";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app";
import { SAFE_LOG_OPTIONS } from "../logger";
import { clearRateLimits, cleanupTestUser, createTestOrgMasters, createTestUser, TEST_PASSWORD, type TestUser } from "../../modules/auth/__tests__/authTestHelpers";

// FIX-H1 (independent audit 2026-11-20, finding H1): the request log printed every response header, so each sign-in and refresh wrote the refresh
// token (Set-Cookie) to the log. The response serializer is now an allowlist (status code; pino-http adds responseTime) and credentials are removed
// whole wherever they appear. This test captures the real request log of a sign-in, a refresh and an authenticated call.
describe("FIX-H1: no credential reaches the request log", () => {
  const lines: string[] = [];
  const sink = new Writable({ write: (chunk, _e, cb) => (lines.push(String(chunk)), cb()) });
  const log = pino({ ...SAFE_LOG_OPTIONS, level: "debug" }, sink);
  const app = createApp({ requestLogger: log });
  let user: TestUser;

  beforeAll(async () => {
    await clearRateLimits();
    user = await createTestUser(await createTestOrgMasters());
  });
  afterAll(async () => {
    await cleanupTestUser(user.employeeId);
  });

  it("sign-in, refresh and an authenticated call log no token, cookie, authorization header or password", async () => {
    const login = await request(app).post("/api/auth/login").send({ employeeCode: user.employeeCode, password: TEST_PASSWORD });
    expect(login.status).toBe(200);
    const cookies = ([] as string[]).concat(login.headers["set-cookie"] ?? []);
    const refreshValue = cookies.join(";").match(/refreshToken=([^;]+)/)?.[1];
    expect(refreshValue).toBeTruthy();
    const accessToken = login.body.accessToken as string;
    const refreshed = await request(app).post("/api/auth/refresh").set("Cookie", cookies);
    expect(refreshed.status).toBe(200);
    const newRefresh = ([] as string[]).concat(refreshed.headers["set-cookie"] ?? []).join(";").match(/refreshToken=([^;]+)/)?.[1];
    await request(app).get("/api/auth/me").set("Authorization", `Bearer ${accessToken}`).expect(200);

    const printed = lines.join("");
    expect(printed.length).toBeGreaterThan(0);
    expect(printed).toContain('"statusCode":200');
    expect(printed).toContain("responseTime");
    for (const secret of [refreshValue!, newRefresh!, accessToken, refreshed.body.accessToken as string, TEST_PASSWORD]) expect(printed).not.toContain(secret);
    expect(printed.toLowerCase()).not.toContain("set-cookie");
    expect(printed.toLowerCase()).not.toContain("bearer ");
  });

  it("a header object logged by hand is redacted whole, whatever its type", () => {
    lines.length = 0;
    log.info({ headers: { authorization: "Bearer abc.def.ghi", "Set-Cookie": ["refreshToken=zzz; Path=/api/auth"], cookie: "refreshToken=yyy" }, body: { password: "Secret-123", newPassword: "Other-456" } }, "x");
    log.error({ err: new Error("upstream said refreshToken=qqq and Bearer abc.def.ghi") }, "y");
    const printed = lines.join("");
    for (const secret of ["abc.def.ghi", "zzz", "yyy", "qqq", "Secret-123", "Other-456"]) expect(printed).not.toContain(secret);
  });
});
