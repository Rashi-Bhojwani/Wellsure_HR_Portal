import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupEngageGroups,
  cleanupLoginableTestEmployee,
  createEmployeeTestOrgMasters,
  createLoginableTestEmployee,
  loginAs,
  type TestOrgMasters,
} from "./engageTestHelpers";

describe("Engage — groups (engage.groups.manage)", () => {
  let org: TestOrgMasters;
  let tokenEmployee: string;
  let tokenAdmin: string;
  let memberEmployeeId: string;
  let tokenMember: string;
  const employeeIds: string[] = [];
  const groupIds: string[] = [];

  afterAll(async () => {
    await cleanupEngageGroups(groupIds);
    for (const id of [...employeeIds].reverse()) await cleanupLoginableTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("blocks a plain employee from creating a group", async () => {
    org = await createEmployeeTestOrgMasters();
    const emp = await createLoginableTestEmployee(org, { roleCode: "EMPLOYEE" });
    employeeIds.push(emp.employeeId);
    tokenEmployee = await loginAs(emp.employeeCode);

    const admin = await createLoginableTestEmployee(org, { roleCode: "HR_ADMIN" });
    employeeIds.push(admin.employeeId);
    tokenAdmin = await loginAs(admin.employeeCode);

    const member = await createLoginableTestEmployee(org, { roleCode: "EMPLOYEE" });
    memberEmployeeId = member.employeeId;
    employeeIds.push(memberEmployeeId);
    tokenMember = await loginAs(member.employeeCode);

    const res = await request(app)
      .post("/api/engage/groups")
      .set(...authHeader(tokenEmployee))
      .send({ name: "Should fail" });
    expect(res.status).toBe(403);
  });

  it("engage.groups.manage can create, list and update a group", async () => {
    const createRes = await request(app)
      .post("/api/engage/groups")
      .set(...authHeader(tokenAdmin))
      .send({ name: `Engineering Guild ${Date.now()}`, description: "For eng folks" });
    expect(createRes.status).toBe(201);
    expect(createRes.body.isActive).toBe(true);
    groupIds.push(createRes.body.id);

    const listRes = await request(app).get("/api/engage/groups").set(...authHeader(tokenAdmin));
    expect(listRes.status).toBe(200);
    expect(listRes.body.groups.some((g: { id: string }) => g.id === createRes.body.id)).toBe(true);

    const updateRes = await request(app)
      .patch(`/api/engage/groups/${createRes.body.id}`)
      .set(...authHeader(tokenAdmin))
      .send({ description: "Updated description" });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.description).toBe("Updated description");
  });

  it("a plain employee can list only active groups (self-serve)", async () => {
    const res = await request(app).get("/api/engage/groups/active").set(...authHeader(tokenEmployee));
    expect(res.status).toBe(200);
    expect(res.body.groups.some((g: { id: string }) => g.id === groupIds[0])).toBe(true);
  });

  it("a plain employee cannot list all groups (admin view)", async () => {
    const res = await request(app).get("/api/engage/groups").set(...authHeader(tokenEmployee));
    expect(res.status).toBe(403);
  });

  it("adds and lists a member, idempotently", async () => {
    const addRes = await request(app)
      .post(`/api/engage/groups/${groupIds[0]}/members/${memberEmployeeId}`)
      .set(...authHeader(tokenAdmin));
    expect(addRes.status).toBe(204);

    // Adding the same member again is not an error.
    const addAgainRes = await request(app)
      .post(`/api/engage/groups/${groupIds[0]}/members/${memberEmployeeId}`)
      .set(...authHeader(tokenAdmin));
    expect(addAgainRes.status).toBe(204);

    const listRes = await request(app).get(`/api/engage/groups/${groupIds[0]}/members`).set(...authHeader(tokenAdmin));
    expect(listRes.status).toBe(200);
    expect(listRes.body.members).toHaveLength(1);
    expect(listRes.body.members[0].employeeId).toBe(memberEmployeeId);
  });

  it("removes a member", async () => {
    const res = await request(app)
      .delete(`/api/engage/groups/${groupIds[0]}/members/${memberEmployeeId}`)
      .set(...authHeader(tokenAdmin));
    expect(res.status).toBe(204);

    const listRes = await request(app).get(`/api/engage/groups/${groupIds[0]}/members`).set(...authHeader(tokenAdmin));
    expect(listRes.body.members).toHaveLength(0);
  });

  it("404s removing a member who isn't in the group", async () => {
    const res = await request(app)
      .delete(`/api/engage/groups/${groupIds[0]}/members/${memberEmployeeId}`)
      .set(...authHeader(tokenAdmin));
    expect(res.status).toBe(404);
  });

  it("deactivating a group removes it from the active list, but membership isn't access control", async () => {
    await request(app)
      .patch(`/api/engage/groups/${groupIds[0]}`)
      .set(...authHeader(tokenAdmin))
      .send({ isActive: false });

    const activeRes = await request(app).get("/api/engage/groups/active").set(...authHeader(tokenEmployee));
    expect(activeRes.body.groups.some((g: { id: string }) => g.id === groupIds[0])).toBe(false);

    // Group posting/viewing is deliberately not membership-gated — even a
    // non-member could still post to a still-active group (see groups.ts's
    // own comment); reactivate for cleanliness of intent here.
    await request(app)
      .patch(`/api/engage/groups/${groupIds[0]}`)
      .set(...authHeader(tokenAdmin))
      .send({ isActive: true });
  });

  it("self-serve active-group listing works for any employee, member or not", async () => {
    const res = await request(app).get("/api/engage/groups/active").set(...authHeader(tokenMember));
    expect(res.status).toBe(200);
  });
});
