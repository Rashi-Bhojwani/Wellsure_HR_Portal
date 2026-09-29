import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
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
import { DASHBOARD_WIDGET_KEYS } from "../layout";

// Admin Dashboard "Edit" button (spec §7.1) — per-user widget visibility +
// order, self-serve.
describe("Admin dashboard layout", () => {
  let org: TestOrgMasters;
  let token: string;
  const employeeIds: string[] = [];

  afterAll(async () => {
    for (const id of [...employeeIds].reverse()) await cleanupLoginableTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("defaults to every widget visible, in the declared key order, before any save", async () => {
    org = await createEmployeeTestOrgMasters();
    const viewer = await createLoginableTestEmployee(org, { roleCode: "EMPLOYEE" });
    employeeIds.push(viewer.employeeId);
    token = await loginAs(viewer.employeeCode);

    const res = await request(app).get("/api/admin/dashboard-layout").set(...authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.layout).toEqual(DASHBOARD_WIDGET_KEYS.map((key) => ({ key, visible: true })));
  });

  it("saves and round-trips a custom layout", async () => {
    const customLayout = [
      { key: "genderSplit", visible: true },
      { key: "yearsInService", visible: false },
    ];
    const saveRes = await request(app).put("/api/admin/dashboard-layout").set(...authHeader(token)).send({ layout: customLayout });
    expect(saveRes.status).toBe(200);
    expect(saveRes.body.layout).toEqual(customLayout);

    const getRes = await request(app).get("/api/admin/dashboard-layout").set(...authHeader(token));
    expect(getRes.body.layout).toEqual(customLayout);
  });

  it("rejects an unknown widget key", async () => {
    const res = await request(app)
      .put("/api/admin/dashboard-layout")
      .set(...authHeader(token))
      .send({ layout: [{ key: "notARealWidget", visible: true }] });
    expect(res.status).toBe(400);
  });
});
