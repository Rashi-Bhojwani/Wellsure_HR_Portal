import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { redis } from "../../../lib/redis";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupLoginableTestEmployee,
  createEmployeeTestOrgMasters,
  createLoginableTestEmployee,
  loginAs,
  type TestOrgMasters,
} from "../../leave/__tests__/leaveTestHelpers";
import { prisma } from "../../../lib/prisma";

const CACHE_KEY = "admin:dashboard:widgets";

// Admin Dashboard widgets (spec §7.1) — aggregate reads over Employee/
// EmployeePersonal/EmployeeJobHistory, cached in Redis (TTL-only, no
// write-triggered invalidation — see dashboard.ts's own module comment).
// The cache is cleared before each assertion here so the aggregate math
// is exercised fresh rather than a stale cached value from another test.
describe("GET /api/admin/dashboard", () => {
  let org: TestOrgMasters;
  let viewerToken: string;
  let plainToken: string;
  const employeeIds: string[] = [];

  afterAll(async () => {
    for (const id of [...employeeIds].reverse()) await cleanupLoginableTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("blocks a caller without employee.view", async () => {
    org = await createEmployeeTestOrgMasters();
    const viewer = await createLoginableTestEmployee(org, { roleCode: "HR_ADMIN" });
    employeeIds.push(viewer.employeeId);
    viewerToken = await loginAs(viewer.employeeCode);

    const plain = await createLoginableTestEmployee(org, { roleCode: "EMPLOYEE" });
    employeeIds.push(plain.employeeId);
    plainToken = await loginAs(plain.employeeCode);

    await redis.del(CACHE_KEY);
    const res = await request(app).get("/api/admin/dashboard").set(...authHeader(plainToken));
    expect(res.status).toBe(403);
  });

  it("returns all seven widget keys with the expected shape", async () => {
    await redis.del(CACHE_KEY);
    const res = await request(app).get("/api/admin/dashboard").set(...authHeader(viewerToken));
    expect(res.status).toBe(200);
    for (const key of ["yearsInService", "additionsAttrition", "headcountByLocation", "headcountByCity", "ageDistribution", "genderSplit", "departmentHeadcount"]) {
      expect(res.body).toHaveProperty(key);
      expect(Array.isArray(res.body[key])).toBe(true);
    }
  });

  it("headcount by branch counts an active employee whose current job history points at this org's location", async () => {
    // createLoginableTestEmployee's fixed fixture: gender OTHER, DOB
    // 1990-01-01 — real EmployeePersonal + EmployeeJobHistory rows, so the
    // widgets that aggregate over both have something real to count.
    const fixture = await createLoginableTestEmployee(org, { roleCode: "EMPLOYEE" });
    employeeIds.push(fixture.employeeId);

    await redis.del(CACHE_KEY);
    const res = await request(app).get("/api/admin/dashboard").set(...authHeader(viewerToken));
    const location = await prisma.location.findUniqueOrThrow({ where: { id: org.locationId } });
    const row = res.body.headcountByLocation.find((r: { name: string }) => r.name === location.name);
    expect(row?.count).toBeGreaterThanOrEqual(1);

    const deptRow = res.body.departmentHeadcount.find((r: { name: string }) => r.name);
    expect(deptRow).toBeDefined();

    const genderRow = res.body.genderSplit.find((r: { gender: string }) => r.gender === "OTHER");
    expect(genderRow?.count).toBeGreaterThanOrEqual(1);
  });

  it("caches the result — a second call within the TTL returns identical data without recomputing", async () => {
    await redis.del(CACHE_KEY);
    const first = await request(app).get("/api/admin/dashboard").set(...authHeader(viewerToken));
    const cached = await redis.get(CACHE_KEY);
    expect(cached).not.toBeNull();
    const second = await request(app).get("/api/admin/dashboard").set(...authHeader(viewerToken));
    expect(second.body).toEqual(first.body);
  });
});
