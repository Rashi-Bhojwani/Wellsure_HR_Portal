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

describe("Engage — comments", () => {
  let org: TestOrgMasters;
  let tokenAuthor: string;
  let tokenCommenter: string;
  const employeeIds: string[] = [];
  const postIds: string[] = [];
  let postId: string;

  afterAll(async () => {
    await cleanupEngagePosts(postIds);
    for (const id of [...employeeIds].reverse()) await cleanupLoginableTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("sets up a post to comment on", async () => {
    org = await createEmployeeTestOrgMasters();
    const author = await createLoginableTestEmployee(org, { roleCode: "EMPLOYEE" });
    employeeIds.push(author.employeeId);
    tokenAuthor = await loginAs(author.employeeCode);

    const commenter = await createLoginableTestEmployee(org, { roleCode: "EMPLOYEE" });
    employeeIds.push(commenter.employeeId);
    tokenCommenter = await loginAs(commenter.employeeCode);

    const post = await request(app)
      .post("/api/engage/posts")
      .set(...authHeader(tokenAuthor))
      .send({ body: "Comment on this" });
    postId = post.body.id;
    postIds.push(postId);
  });

  it("adds a comment and lists it back in order", async () => {
    const first = await request(app)
      .post(`/api/engage/posts/${postId}/comments`)
      .set(...authHeader(tokenCommenter))
      .send({ body: "First!" });
    expect(first.status).toBe(201);
    expect(first.body.body).toBe("First!");

    const second = await request(app)
      .post(`/api/engage/posts/${postId}/comments`)
      .set(...authHeader(tokenAuthor))
      .send({ body: "Thanks!" });
    expect(second.status).toBe(201);

    const list = await request(app).get(`/api/engage/posts/${postId}/comments`).set(...authHeader(tokenCommenter));
    expect(list.status).toBe(200);
    expect(list.body.comments.map((c: { body: string }) => c.body)).toEqual(["First!", "Thanks!"]);
  });

  it("the post's commentCount reflects the comments", async () => {
    const res = await request(app).get(`/api/engage/posts/${postId}`).set(...authHeader(tokenCommenter));
    expect(res.body.commentCount).toBe(2);
  });

  it("404s commenting on a nonexistent post", async () => {
    const res = await request(app)
      .post("/api/engage/posts/no-such-post/comments")
      .set(...authHeader(tokenCommenter))
      .send({ body: "x" });
    expect(res.status).toBe(404);
  });
});
