import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../../app";
import { prisma } from "../../../lib/prisma";
import { createTestEmployee } from "../../../lib/__tests__/testHelpers";
import {
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

const app = createApp();

describe("Org masters (/api/org)", () => {
  const roleCode = `TEST_ORG_MANAGER_${Date.now()}`;
  const plainRoleCode = `TEST_ORG_PLAIN_${Date.now()}`;
  let org: TestOrgMasters;
  let managerToken: string;
  let plainToken: string;
  const employeeIds: string[] = [];

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    await grantPermissions(roleCode, ["org.manage"]);
    await grantPermissions(plainRoleCode, []);

    const manager = await createFullTestEmployee(org, { roleCode });
    employeeIds.push(manager.employeeId);
    managerToken = await loginAs(manager.employeeCode);

    const plain = await createFullTestEmployee(org, { roleCode: plainRoleCode });
    employeeIds.push(plain.employeeId);
    plainToken = await loginAs(plain.employeeCode);
  });

  afterAll(async () => {
    for (const id of employeeIds) await cleanupFullTestEmployee(id);
    await cleanupTestRole(roleCode);
    await cleanupTestRole(plainRoleCode);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("allows any authenticated user to list cities, but blocks creation without org.manage", async () => {
    const listRes = await request(app).get("/api/org/cities").set(...authHeader(plainToken));
    expect(listRes.status).toBe(200);

    const createRes = await request(app)
      .post("/api/org/cities")
      .set(...authHeader(plainToken))
      .send({ name: `Blocked City ${randomUUID()}`, state: "X" });
    expect(createRes.status).toBe(403);
  });

  it("creates, updates and deletes a city with org.manage", async () => {
    const name = `Test City ${randomUUID().slice(0, 8)}`;
    const createRes = await request(app)
      .post("/api/org/cities")
      .set(...authHeader(managerToken))
      .send({ name, state: "Test State" });
    expect(createRes.status).toBe(201);
    const cityId = createRes.body.id as string;

    const updateRes = await request(app)
      .patch(`/api/org/cities/${cityId}`)
      .set(...authHeader(managerToken))
      .send({ state: "Updated State" });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.state).toBe("Updated State");

    const deleteRes = await request(app).delete(`/api/org/cities/${cityId}`).set(...authHeader(managerToken));
    expect(deleteRes.status).toBe(204);
  });

  it("blocks deleting a city that still has branches assigned", async () => {
    const city = await prisma.city.create({ data: { name: `Referenced City ${randomUUID().slice(0, 8)}`, state: "X" } });
    const location = await prisma.location.create({
      data: {
        code: `REF-LOC-${randomUUID().slice(0, 8)}`,
        name: `Referenced Loc ${randomUUID().slice(0, 8)}`,
        cityId: city.id,
        addressLine1: "x",
        city: "x",
        state: "x",
        pincode: "000000",
      },
    });

    const res = await request(app).delete(`/api/org/cities/${city.id}`).set(...authHeader(managerToken));
    expect(res.status).toBe(409);

    await prisma.location.delete({ where: { id: location.id } });
    await prisma.city.delete({ where: { id: city.id } });
  });

  it("blocks deleting a department that has employee job-history rows attached", async () => {
    const employee = await createTestEmployee({ org });
    employeeIds.push(employee.employeeId);

    const res = await request(app).delete(`/api/org/departments/${org.departmentId}`).set(...authHeader(managerToken));
    expect(res.status).toBe(409);
  });

  it("merges a near-duplicate location into another, moving job history and deleting the source", async () => {
    const suffix = randomUUID().slice(0, 8);
    const target = await prisma.location.create({
      data: { code: `MERGE-TGT-${suffix}`, name: `Merge Target ${suffix}`, addressLine1: "x", city: "x", state: "x", pincode: "000000" },
    });
    const source = await prisma.location.create({
      data: { code: `MERGE-SRC-${suffix}`, name: `Merge Source ${suffix}`, addressLine1: "x", city: "x", state: "x", pincode: "000000" },
    });
    const employee = await createTestEmployee({ org });
    employeeIds.push(employee.employeeId);
    await prisma.employeeJobHistory.updateMany({ where: { employeeId: employee.employeeId, effectiveTo: null }, data: { locationId: source.id } });

    const res = await request(app)
      .post(`/api/org/locations/${source.id}/merge`)
      .set(...authHeader(managerToken))
      .send({ intoLocationId: target.id });
    expect(res.status).toBe(204);

    const job = await prisma.employeeJobHistory.findFirst({ where: { employeeId: employee.employeeId, effectiveTo: null } });
    expect(job?.locationId).toBe(target.id);
    const sourceStillExists = await prisma.location.findUnique({ where: { id: source.id } });
    expect(sourceStillExists).toBeNull();

    // Best-effort — the merged-into employee's job history still points at
    // `target` until afterAll cleans that employee up, so this may still be
    // referenced here; not the point of this test.
    await prisma.location.delete({ where: { id: target.id } }).catch(() => undefined);
  });
});
