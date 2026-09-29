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

// Admin Homepage "My Favourites" (spec §7.1) — self-serve CRUD + reorder,
// scoped to the caller's own userId.
describe("Admin favourites", () => {
  let org: TestOrgMasters;
  let tokenA: string;
  let tokenB: string;
  const employeeIds: string[] = [];

  afterAll(async () => {
    for (const id of [...employeeIds].reverse()) await cleanupLoginableTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("creates favourites with an auto-incrementing rank", async () => {
    org = await createEmployeeTestOrgMasters();
    const a = await createLoginableTestEmployee(org, { roleCode: "EMPLOYEE" });
    employeeIds.push(a.employeeId);
    tokenA = await loginAs(a.employeeCode);

    const b = await createLoginableTestEmployee(org, { roleCode: "EMPLOYEE" });
    employeeIds.push(b.employeeId);
    tokenB = await loginAs(b.employeeCode);

    const first = await request(app).post("/api/admin/favourites").set(...authHeader(tokenA)).send({ label: "Add Employee", icon: "useradd", path: "/admin/employee/add" });
    expect(first.status).toBe(201);
    expect(first.body.rank).toBe(0);

    const second = await request(app).post("/api/admin/favourites").set(...authHeader(tokenA)).send({ label: "Reports", icon: "file", path: "/admin/reports" });
    expect(second.status).toBe(201);
    expect(second.body.rank).toBe(1);
  });

  it("lists only the caller's own favourites, ordered by rank", async () => {
    const res = await request(app).get("/api/admin/favourites").set(...authHeader(tokenA));
    expect(res.status).toBe(200);
    expect(res.body.favourites.map((f: { label: string }) => f.label)).toEqual(["Add Employee", "Reports"]);

    const otherRes = await request(app).get("/api/admin/favourites").set(...authHeader(tokenB));
    expect(otherRes.body.favourites).toEqual([]);
  });

  it("reorders the caller's favourites", async () => {
    const listRes = await request(app).get("/api/admin/favourites").set(...authHeader(tokenA));
    const ids = listRes.body.favourites.map((f: { id: string }) => f.id) as string[];
    const reversed = [...ids].reverse();

    const reorderRes = await request(app).post("/api/admin/favourites/reorder").set(...authHeader(tokenA)).send({ orderedIds: reversed });
    expect(reorderRes.status).toBe(204);

    const after = await request(app).get("/api/admin/favourites").set(...authHeader(tokenA));
    expect(after.body.favourites.map((f: { id: string }) => f.id)).toEqual(reversed);
  });

  it("rejects a reorder whose id set doesn't exactly match the caller's own favourites", async () => {
    const res = await request(app).post("/api/admin/favourites/reorder").set(...authHeader(tokenA)).send({ orderedIds: ["not-a-real-id"] });
    expect(res.status).toBe(400);
  });

  it("404s deleting another user's favourite", async () => {
    const listRes = await request(app).get("/api/admin/favourites").set(...authHeader(tokenA));
    const id = listRes.body.favourites[0].id as string;
    const res = await request(app).delete(`/api/admin/favourites/${id}`).set(...authHeader(tokenB));
    expect(res.status).toBe(404);
  });

  it("deletes the caller's own favourite", async () => {
    const listRes = await request(app).get("/api/admin/favourites").set(...authHeader(tokenA));
    const id = listRes.body.favourites[0].id as string;
    const res = await request(app).delete(`/api/admin/favourites/${id}`).set(...authHeader(tokenA));
    expect(res.status).toBe(204);

    const after = await request(app).get("/api/admin/favourites").set(...authHeader(tokenA));
    expect(after.body.favourites.find((f: { id: string }) => f.id === id)).toBeUndefined();
  });

  it("rejects an unauthenticated request", async () => {
    const res = await request(app).get("/api/admin/favourites");
    expect(res.status).toBe(401);
  });
});
