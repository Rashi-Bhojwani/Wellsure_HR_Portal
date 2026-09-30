import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupEngageGroups,
  cleanupEngagePosts,
  cleanupLoginableTestEmployee,
  createEmployeeTestOrgMasters,
  createLoginableTestEmployee,
  loginAs,
  type TestOrgMasters,
} from "./engageTestHelpers";

describe("Engage — posts feed (create/list/get/filters)", () => {
  let org: TestOrgMasters;
  let employeeAId: string;
  let tokenA: string;
  let tokenB: string;
  let tokenAdmin: string;
  const employeeIds: string[] = [];
  const postIds: string[] = [];
  const groupIds: string[] = [];

  afterAll(async () => {
    await cleanupEngagePosts(postIds);
    await cleanupEngageGroups(groupIds);
    for (const id of [...employeeIds].reverse()) await cleanupLoginableTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("a signed-in employee can create a plain post and see it in the feed", async () => {
    org = await createEmployeeTestOrgMasters();
    const empA = await createLoginableTestEmployee(org, { roleCode: "EMPLOYEE" });
    employeeAId = empA.employeeId;
    employeeIds.push(employeeAId);
    tokenA = await loginAs(empA.employeeCode);

    const empB = await createLoginableTestEmployee(org, { roleCode: "EMPLOYEE" });
    employeeIds.push(empB.employeeId);
    tokenB = await loginAs(empB.employeeCode);

    // HR_ADMIN — not a synthetic role: it already carries
    // engage.groups.manage/engage.moderate/engage.autopost.manage from seed
    // (prisma/seed.ts), same real-role convention announcements.test.ts uses.
    const admin = await createLoginableTestEmployee(org, { roleCode: "HR_ADMIN" });
    employeeIds.push(admin.employeeId);
    tokenAdmin = await loginAs(admin.employeeCode);

    const createRes = await request(app)
      .post("/api/engage/posts")
      .set(...authHeader(tokenA))
      .send({ body: "Hello, team!" });
    expect(createRes.status).toBe(201);
    expect(createRes.body.kind).toBe("USER");
    expect(createRes.body.authorEmployeeId).toBe(employeeAId);
    postIds.push(createRes.body.id);

    const listRes = await request(app).get("/api/engage/posts").set(...authHeader(tokenB));
    expect(listRes.status).toBe(200);
    expect(listRes.body.rows.some((r: { id: string }) => r.id === createRes.body.id)).toBe(true);
  });

  it("GET /api/engage/posts/:id returns the post's full detail", async () => {
    const res = await request(app).get(`/api/engage/posts/${postIds[0]}`).set(...authHeader(tokenB));
    expect(res.status).toBe(200);
    expect(res.body.body).toBe("Hello, team!");
    expect(res.body.commentCount).toBe(0);
  });

  it("GET /api/engage/posts/:id 404s for a nonexistent post", async () => {
    const res = await request(app).get("/api/engage/posts/does-not-exist").set(...authHeader(tokenB));
    expect(res.status).toBe(404);
  });

  it("filters the feed by kind", async () => {
    const res = await request(app).get("/api/engage/posts?kind=USER").set(...authHeader(tokenA));
    expect(res.status).toBe(200);
    expect(res.body.rows.every((r: { kind: string }) => r.kind === "USER")).toBe(true);
    expect(res.body.rows.some((r: { id: string }) => r.id === postIds[0])).toBe(true);

    const kudosOnly = await request(app).get("/api/engage/posts?kind=KUDOS").set(...authHeader(tokenA));
    expect(kudosOnly.body.rows.some((r: { id: string }) => r.id === postIds[0])).toBe(false);
  });

  it("filters the feed by search text (case-insensitive substring on body)", async () => {
    const res = await request(app).get("/api/engage/posts?search=team").set(...authHeader(tokenA));
    expect(res.body.rows.some((r: { id: string }) => r.id === postIds[0])).toBe(true);

    const miss = await request(app).get("/api/engage/posts?search=zzz-no-match-zzz").set(...authHeader(tokenA));
    expect(miss.body.rows.some((r: { id: string }) => r.id === postIds[0])).toBe(false);
  });

  it("scopes a post to a group and the group filter narrows the feed to it", async () => {
    const groupRes = await request(app)
      .post("/api/engage/groups")
      .set(...authHeader(tokenAdmin))
      .send({ name: `Test Group ${Date.now()}` });
    expect(groupRes.status).toBe(201);
    groupIds.push(groupRes.body.id);

    const postRes = await request(app)
      .post("/api/engage/posts")
      .set(...authHeader(tokenA))
      .send({ body: "Group-scoped post", groupId: groupRes.body.id });
    expect(postRes.status).toBe(201);
    expect(postRes.body.groupId).toBe(groupRes.body.id);
    postIds.push(postRes.body.id);

    const filtered = await request(app).get(`/api/engage/posts?groupId=${groupRes.body.id}`).set(...authHeader(tokenA));
    expect(filtered.body.rows.map((r: { id: string }) => r.id)).toEqual([postRes.body.id]);

    const unfiltered = await request(app).get("/api/engage/posts").set(...authHeader(tokenA));
    expect(unfiltered.body.rows.some((r: { id: string }) => r.id === postIds[0])).toBe(true);
  });

  it("rejects posting to a nonexistent group", async () => {
    const res = await request(app)
      .post("/api/engage/posts")
      .set(...authHeader(tokenA))
      .send({ body: "Bad group", groupId: "no-such-group" });
    expect(res.status).toBe(404);
  });

  it("rejects posting to a deactivated group", async () => {
    const groupRes = await request(app)
      .post("/api/engage/groups")
      .set(...authHeader(tokenAdmin))
      .send({ name: `Inactive Group ${Date.now()}` });
    groupIds.push(groupRes.body.id);
    await request(app)
      .patch(`/api/engage/groups/${groupRes.body.id}`)
      .set(...authHeader(tokenAdmin))
      .send({ isActive: false });

    const res = await request(app)
      .post("/api/engage/posts")
      .set(...authHeader(tokenA))
      .send({ body: "Should fail", groupId: groupRes.body.id });
    expect(res.status).toBe(404);
  });

  it("rejects an unauthenticated request", async () => {
    const res = await request(app).get("/api/engage/posts");
    expect(res.status).toBe(401);
  });
});
