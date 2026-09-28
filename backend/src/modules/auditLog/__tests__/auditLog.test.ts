import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupFullTestEmployee,
  cleanupTestRole,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  grantPermissions,
  loginAs,
  type TestOrgMasters,
} from "../../employee/__tests__/employeeTestHelpers";

describe("Audit Log viewer (/api/audit-logs)", () => {
  const viewerRole = `TEST_AUDIT_VIEWER_${Date.now()}`;
  const noPermRole = `TEST_AUDIT_NONE_${Date.now()}`;
  let org: TestOrgMasters;
  let viewerToken: string;
  let noPermToken: string;
  const employeeIds: string[] = [];

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    await grantPermissions(viewerRole, ["audit.view", "org.manage"]);
    await grantPermissions(noPermRole, []);

    const viewer = await createFullTestEmployee(org, { roleCode: viewerRole });
    employeeIds.push(viewer.employeeId);
    viewerToken = await loginAs(viewer.employeeCode);

    const plain = await createFullTestEmployee(org, { roleCode: noPermRole });
    employeeIds.push(plain.employeeId);
    noPermToken = await loginAs(plain.employeeCode);

    // Generate a real, identifiable audit entry to filter for below.
    await request(app)
      .post("/api/org/cities")
      .set(...authHeader(viewerToken))
      .send({ name: `Audit Fixture City ${Date.now()}`, state: "Test State" });
  });

  afterAll(async () => {
    for (const id of employeeIds) await cleanupFullTestEmployee(id);
    await cleanupTestRole(viewerRole);
    await cleanupTestRole(noPermRole);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("requires audit.view", async () => {
    const res = await request(app).get("/api/audit-logs").set(...authHeader(noPermToken));
    expect(res.status).toBe(403);
  });

  it("lists entries, paginated, filterable by action", async () => {
    const res = await request(app).get("/api/audit-logs").query({ action: "org.city.created", pageSize: 5 }).set(...authHeader(viewerToken));
    expect(res.status).toBe(200);
    expect(res.body.rows.length).toBeGreaterThan(0);
    expect(res.body.rows.every((r: { action: string }) => r.action === "org.city.created")).toBe(true);
    expect(res.body.rows[0].actorEmployeeCode).toBeTruthy();
  });

  it("filters by a date range that excludes everything", async () => {
    const res = await request(app)
      .get("/api/audit-logs")
      .query({ dateFrom: "2000-01-01", dateTo: "2000-01-02" })
      .set(...authHeader(viewerToken));
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(0);
  });

  it("has no PATCH or DELETE route — audit_logs is append-only", async () => {
    const patchRes = await request(app).patch("/api/audit-logs/whatever").set(...authHeader(viewerToken)).send({});
    expect(patchRes.status).toBe(404);
    const deleteRes = await request(app).delete("/api/audit-logs/whatever").set(...authHeader(viewerToken));
    expect(deleteRes.status).toBe(404);
  });
});
