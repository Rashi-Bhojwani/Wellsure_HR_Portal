import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupEngagePosts,
  cleanupLoginableTestEmployee,
  createEmployeeTestOrgMasters,
  createLoginableTestEmployee,
  loginAs,
  type TestOrgMasters,
} from "./engageTestHelpers";

describe("Engage — reactions (toggle)", () => {
  let org: TestOrgMasters;
  let tokenAuthor: string;
  let tokenReactor: string;
  const employeeIds: string[] = [];
  const postIds: string[] = [];
  let postId: string;

  afterAll(async () => {
    await cleanupEngagePosts(postIds);
    for (const id of [...employeeIds].reverse()) await cleanupLoginableTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("sets up a post to react to", async () => {
    org = await createEmployeeTestOrgMasters();
    const author = await createLoginableTestEmployee(org, { roleCode: "EMPLOYEE" });
    employeeIds.push(author.employeeId);
    tokenAuthor = await loginAs(author.employeeCode);

    const reactor = await createLoginableTestEmployee(org, { roleCode: "EMPLOYEE" });
    employeeIds.push(reactor.employeeId);
    tokenReactor = await loginAs(reactor.employeeCode);

    const post = await request(app)
      .post("/api/engage/posts")
      .set(...authHeader(tokenAuthor))
      .send({ body: "React to this" });
    postId = post.body.id;
    postIds.push(postId);
  });

  it("adds a reaction", async () => {
    const res = await request(app)
      .post(`/api/engage/posts/${postId}/react`)
      .set(...authHeader(tokenReactor))
      .send({ emoji: "👍" });
    expect(res.status).toBe(200);
    expect(res.body.viewerReaction).toBe("👍");
    expect(res.body.reactions).toEqual([{ emoji: "👍", count: 1 }]);
  });

  it("the same emoji again removes the reaction (toggle off)", async () => {
    const res = await request(app)
      .post(`/api/engage/posts/${postId}/react`)
      .set(...authHeader(tokenReactor))
      .send({ emoji: "👍" });
    expect(res.status).toBe(200);
    expect(res.body.viewerReaction).toBeNull();
    expect(res.body.reactions).toEqual([]);
  });

  it("a different emoji replaces the existing one rather than adding a second row", async () => {
    await request(app)
      .post(`/api/engage/posts/${postId}/react`)
      .set(...authHeader(tokenReactor))
      .send({ emoji: "👍" });

    const res = await request(app)
      .post(`/api/engage/posts/${postId}/react`)
      .set(...authHeader(tokenReactor))
      .send({ emoji: "🎉" });
    expect(res.status).toBe(200);
    expect(res.body.viewerReaction).toBe("🎉");
    expect(res.body.reactions).toEqual([{ emoji: "🎉", count: 1 }]);
  });

  it("404s reacting to a nonexistent post", async () => {
    const res = await request(app)
      .post("/api/engage/posts/no-such-post/react")
      .set(...authHeader(tokenReactor))
      .send({ emoji: "👍" });
    expect(res.status).toBe(404);
  });
});
