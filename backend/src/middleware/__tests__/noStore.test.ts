import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createTestOrgMasters, cleanupTestData, type TestOrgMasters } from "../../lib/__tests__/testHelpers";
import { app, cleanupTestUser, clearRateLimits, createTestUser, TEST_PASSWORD } from "../../modules/auth/__tests__/authTestHelpers";

// Regression test: GET /api/auth/me (and any other authenticated GET) was
// coming back 304 Not Modified once a client had seen it before, because
// Express auto-generates an ETag for JSON responses and short-circuits on
// a matching If-None-Match — completely independent of any Cache-Control
// header. A role change, logout, or switch of accounts on the same
// machine must never risk the browser reusing a stale/cached body for
// auth or per-user data.
describe("Auth/session and authenticated-data responses are never cacheable", () => {
  let org: TestOrgMasters;
  const employeeIds: string[] = [];

  beforeAll(async () => {
    org = await createTestOrgMasters();
  });

  afterAll(async () => {
    for (const id of employeeIds) await cleanupTestUser(id);
    await cleanupTestData({ org });
  });

  it("sets Cache-Control: no-store and never returns 304, even on an identical repeated request", async () => {
    await clearRateLimits();
    const user = await createTestUser(org);
    employeeIds.push(user.employeeId);

    const login = await request(app).post("/api/auth/login").send({ employeeCode: user.employeeCode, password: TEST_PASSWORD });
    const token = login.body.accessToken as string;

    const first = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
    expect(first.status).toBe(200);
    expect(first.headers["cache-control"]).toBe("no-store");
    expect(first.headers.etag).toBeUndefined();

    // Replay the exact same request a client's cache would make on a
    // second visit — must still be a real 200 with a real body, not a 304.
    const second = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
    expect(second.status).toBe(200);
    expect(second.headers["cache-control"]).toBe("no-store");
    expect(second.body.employeeCode).toBe(user.employeeCode);

    // Simulate a browser that somehow already cached a prior ETag anyway
    // (e.g. from before this fix shipped) — must still be ignored.
    const withStaleIfNoneMatch = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .set("If-None-Match", '"some-stale-etag"');
    expect(withStaleIfNoneMatch.status).toBe(200);
  });

  it("also applies to authenticated data endpoints outside /api/auth (org masters, employee self-service)", async () => {
    await clearRateLimits();
    const user = await createTestUser(org);
    employeeIds.push(user.employeeId);
    const login = await request(app).post("/api/auth/login").send({ employeeCode: user.employeeCode, password: TEST_PASSWORD });
    const token = login.body.accessToken as string;

    const orgRes = await request(app).get("/api/org/cities").set("Authorization", `Bearer ${token}`);
    expect(orgRes.status).toBe(200);
    expect(orgRes.headers["cache-control"]).toBe("no-store");
    expect(orgRes.headers.etag).toBeUndefined();

    const meRes = await request(app).get("/api/employees/me").set("Authorization", `Bearer ${token}`);
    expect(meRes.status).toBe(200);
    expect(meRes.headers["cache-control"]).toBe("no-store");
    expect(meRes.headers.etag).toBeUndefined();
  });
});
