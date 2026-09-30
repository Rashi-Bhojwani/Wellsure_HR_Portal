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

describe("Engage — polls", () => {
  let org: TestOrgMasters;
  let authorId: string;
  let tokenAuthor: string;
  let tokenVoter: string;
  let tokenAdmin: string;
  const employeeIds: string[] = [];
  const postIds: string[] = [];

  afterAll(async () => {
    await cleanupEngagePosts(postIds);
    for (const id of [...employeeIds].reverse()) await cleanupLoginableTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("creates a poll with options", async () => {
    org = await createEmployeeTestOrgMasters();
    const author = await createLoginableTestEmployee(org, { roleCode: "EMPLOYEE" });
    authorId = author.employeeId;
    employeeIds.push(authorId);
    tokenAuthor = await loginAs(author.employeeCode);

    const voter = await createLoginableTestEmployee(org, { roleCode: "EMPLOYEE" });
    employeeIds.push(voter.employeeId);
    tokenVoter = await loginAs(voter.employeeCode);

    const admin = await createLoginableTestEmployee(org, { roleCode: "HR_ADMIN" });
    employeeIds.push(admin.employeeId);
    tokenAdmin = await loginAs(admin.employeeCode);

    const res = await request(app)
      .post("/api/engage/polls")
      .set(...authHeader(tokenAuthor))
      .send({ question: "Best team lunch spot?", options: ["Pizza", "Biryani", "Sandwiches"] });
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe("POLL");
    expect(res.body.poll.options).toHaveLength(3);
    expect(res.body.poll.totalVotes).toBe(0);
    postIds.push(res.body.id);
  });

  it("rejects a poll with fewer than 2 options at the validator", async () => {
    const res = await request(app)
      .post("/api/engage/polls")
      .set(...authHeader(tokenAuthor))
      .send({ question: "Bad poll", options: ["Only one"] });
    expect(res.status).toBe(400);
  });

  it("votes on a poll option and the count reflects it", async () => {
    const post = await request(app).get(`/api/engage/posts/${postIds[0]}`).set(...authHeader(tokenVoter));
    const firstOptionId = post.body.poll.options[0].id;

    const res = await request(app)
      .post("/api/engage/polls/vote")
      .set(...authHeader(tokenVoter))
      .send({ pollOptionId: firstOptionId });
    expect(res.status).toBe(200);
    expect(res.body.poll.totalVotes).toBe(1);
    expect(res.body.poll.viewerVotedOptionId).toBe(firstOptionId);
    const votedOption = res.body.poll.options.find((o: { id: string }) => o.id === firstOptionId);
    expect(votedOption.voteCount).toBe(1);
  });

  it("voting again moves the vote to the new option rather than adding a second one", async () => {
    const post = await request(app).get(`/api/engage/posts/${postIds[0]}`).set(...authHeader(tokenVoter));
    const secondOptionId = post.body.poll.options[1].id;

    const res = await request(app)
      .post("/api/engage/polls/vote")
      .set(...authHeader(tokenVoter))
      .send({ pollOptionId: secondOptionId });
    expect(res.status).toBe(200);
    expect(res.body.poll.totalVotes).toBe(1); // still 1, not 2
    expect(res.body.poll.viewerVotedOptionId).toBe(secondOptionId);
    const firstOption = res.body.poll.options.find((o: { id: string; label: string }) => o.id !== secondOptionId && o.label === "Pizza");
    expect(firstOption.voteCount).toBe(0);
  });

  it("rejects voting on a nonexistent poll option", async () => {
    const res = await request(app)
      .post("/api/engage/polls/vote")
      .set(...authHeader(tokenVoter))
      .send({ pollOptionId: "no-such-option" });
    expect(res.status).toBe(404);
  });

  it("a non-author, non-moderator cannot close someone else's poll", async () => {
    const res = await request(app)
      .post(`/api/engage/posts/${postIds[0]}/close-poll`)
      .set(...authHeader(tokenVoter));
    expect(res.status).toBe(403);
  });

  it("engage.moderate can close someone else's poll", async () => {
    const res = await request(app)
      .post(`/api/engage/posts/${postIds[0]}/close-poll`)
      .set(...authHeader(tokenAdmin));
    expect(res.status).toBe(200);
    expect(res.body.poll.closedAt).not.toBeNull();
  });

  it("rejects voting on a closed poll", async () => {
    const post = await request(app).get(`/api/engage/posts/${postIds[0]}`).set(...authHeader(tokenAuthor));
    const optionId = post.body.poll.options[2].id;

    const res = await request(app)
      .post("/api/engage/polls/vote")
      .set(...authHeader(tokenAuthor))
      .send({ pollOptionId: optionId });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("POLL_CLOSED");
  });

  it("rejects closing an already-closed poll", async () => {
    const res = await request(app)
      .post(`/api/engage/posts/${postIds[0]}/close-poll`)
      .set(...authHeader(tokenAdmin));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ALREADY_CLOSED");
  });

  it("an author can close their own poll", async () => {
    const create = await request(app)
      .post("/api/engage/polls")
      .set(...authHeader(tokenAuthor))
      .send({ question: "Another poll", options: ["A", "B"] });
    postIds.push(create.body.id);

    const res = await request(app)
      .post(`/api/engage/posts/${create.body.id}/close-poll`)
      .set(...authHeader(tokenAuthor));
    expect(res.status).toBe(200);
  });
});
