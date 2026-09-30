import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { getKudosReceivedCount } from "../kudos";
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

// The explicit review requirement: "Kudos deletion behaviour on moderation
// must be decided and tested." Decision (schema.prisma's Post comment,
// moderation.ts's header): moderation is always a soft-hide, never a
// delete — the Post and its backing Kudos row stay in the database, but
// every feed query and every kudos count filters moderatedAt IS NULL, so a
// moderated kudos post stops counting toward its recipient's total
// immediately, with no separate decrement step to get wrong. Verified here
// end to end: give kudos -> count includes it -> moderate -> count excludes
// it (row still present) -> unhide -> count includes it again.
describe("Engage — moderation (soft-hide) + live kudos-count exclusion", () => {
  let org: TestOrgMasters;
  let tokenEmployee: string;
  let tokenAdmin: string;
  let giverId: string;
  let recipientId: string;
  let tokenGiver: string;
  const employeeIds: string[] = [];
  const postIds: string[] = [];

  afterAll(async () => {
    await cleanupEngagePosts(postIds);
    for (const id of [...employeeIds].reverse()) await cleanupLoginableTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("blocks a plain employee from moderating a post", async () => {
    org = await createEmployeeTestOrgMasters();
    const emp = await createLoginableTestEmployee(org, { roleCode: "EMPLOYEE" });
    employeeIds.push(emp.employeeId);
    tokenEmployee = await loginAs(emp.employeeCode);

    const admin = await createLoginableTestEmployee(org, { roleCode: "HR_ADMIN" });
    employeeIds.push(admin.employeeId);
    tokenAdmin = await loginAs(admin.employeeCode);

    const giver = await createLoginableTestEmployee(org, { roleCode: "EMPLOYEE" });
    giverId = giver.employeeId;
    employeeIds.push(giverId);
    tokenGiver = await loginAs(giver.employeeCode);

    const recipient = await createLoginableTestEmployee(org, { roleCode: "EMPLOYEE" });
    recipientId = recipient.employeeId;
    employeeIds.push(recipientId);

    const post = await request(app)
      .post("/api/engage/posts")
      .set(...authHeader(tokenEmployee))
      .send({ body: "Moderate me?" });
    postIds.push(post.body.id);

    const res = await request(app).post(`/api/engage/moderation/posts/${post.body.id}/hide`).set(...authHeader(tokenEmployee));
    expect(res.status).toBe(403);
  });

  it("a moderator hides a post — it disappears from the feed but the row stays in the database", async () => {
    const target = postIds[0];

    const hideRes = await request(app).post(`/api/engage/moderation/posts/${target}/hide`).set(...authHeader(tokenAdmin));
    expect(hideRes.status).toBe(200);
    expect(hideRes.body.isModerated).toBe(true);

    const feedRes = await request(app).get("/api/engage/posts").set(...authHeader(tokenEmployee));
    expect(feedRes.body.rows.some((r: { id: string }) => r.id === target)).toBe(false);

    const getRes = await request(app).get(`/api/engage/posts/${target}`).set(...authHeader(tokenEmployee));
    expect(getRes.status).toBe(404); // employee-facing getPost excludes moderated posts too

    // But the admin moderation queue still sees it — the row is soft-hidden,
    // never deleted.
    const queueRes = await request(app).get("/api/engage/moderation/posts?moderated=true").set(...authHeader(tokenAdmin));
    expect(queueRes.body.rows.some((r: { id: string }) => r.id === target)).toBe(true);
  });

  it("rejects hiding an already-moderated post", async () => {
    const res = await request(app).post(`/api/engage/moderation/posts/${postIds[0]}/hide`).set(...authHeader(tokenAdmin));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ALREADY_MODERATED");
  });

  it("unhides a post, restoring it to the feed", async () => {
    const res = await request(app).post(`/api/engage/moderation/posts/${postIds[0]}/unhide`).set(...authHeader(tokenAdmin));
    expect(res.status).toBe(200);
    expect(res.body.isModerated).toBe(false);

    const feedRes = await request(app).get("/api/engage/posts").set(...authHeader(tokenEmployee));
    expect(feedRes.body.rows.some((r: { id: string }) => r.id === postIds[0])).toBe(true);
  });

  it("rejects unhiding a post that isn't moderated", async () => {
    const res = await request(app).post(`/api/engage/moderation/posts/${postIds[0]}/unhide`).set(...authHeader(tokenAdmin));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NOT_MODERATED");
  });

  it("kudos count: give -> counts -> moderate -> excluded (row still present) -> unhide -> counts again", async () => {
    const kudosRes = await request(app)
      .post("/api/engage/kudos")
      .set(...authHeader(tokenGiver))
      .send({ toEmployeeId: recipientId, message: "Great job!" });
    expect(kudosRes.status).toBe(201);
    const kudosPostId = kudosRes.body.id as string;
    postIds.push(kudosPostId);

    expect(await getKudosReceivedCount(recipientId)).toBe(1);

    const hideRes = await request(app).post(`/api/engage/moderation/posts/${kudosPostId}/hide`).set(...authHeader(tokenAdmin));
    expect(hideRes.status).toBe(200);

    // Excluded immediately, no separate decrement step.
    expect(await getKudosReceivedCount(recipientId)).toBe(0);

    // The row is still there — a moderation admin queue lookup finds it,
    // it was never deleted.
    const queueRes = await request(app).get("/api/engage/moderation/posts?moderated=true").set(...authHeader(tokenAdmin));
    expect(queueRes.body.rows.some((r: { id: string; kudos: unknown }) => r.id === kudosPostId && r.kudos !== null)).toBe(true);

    const unhideRes = await request(app).post(`/api/engage/moderation/posts/${kudosPostId}/unhide`).set(...authHeader(tokenAdmin));
    expect(unhideRes.status).toBe(200);
    expect(await getKudosReceivedCount(recipientId)).toBe(1);
  });

  it("the moderation queue's ?moderated=false filter shows only visible posts", async () => {
    const res = await request(app).get("/api/engage/moderation/posts?moderated=false").set(...authHeader(tokenAdmin));
    expect(res.status).toBe(200);
    expect(res.body.rows.every((r: { isModerated: boolean }) => r.isModerated === false)).toBe(true);
  });
});
