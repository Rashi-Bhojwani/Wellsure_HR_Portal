import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import { getKudosGivenCount, getKudosReceivedCount } from "../kudos";
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

describe("Engage — kudos", () => {
  let org: TestOrgMasters;
  let giverId: string;
  let recipientId: string;
  let recipientCode: string;
  let tokenGiver: string;
  let tokenRecipient: string;
  const employeeIds: string[] = [];
  const postIds: string[] = [];

  afterAll(async () => {
    await cleanupEngagePosts(postIds);
    for (const id of [...employeeIds].reverse()) await cleanupLoginableTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("gives kudos, creating a KUDOS post visible in the feed", async () => {
    org = await createEmployeeTestOrgMasters();
    const giver = await createLoginableTestEmployee(org, { roleCode: "EMPLOYEE" });
    giverId = giver.employeeId;
    employeeIds.push(giverId);
    tokenGiver = await loginAs(giver.employeeCode);

    const recipient = await createLoginableTestEmployee(org, { roleCode: "EMPLOYEE" });
    recipientId = recipient.employeeId;
    recipientCode = recipient.employeeCode;
    employeeIds.push(recipientId);
    tokenRecipient = await loginAs(recipient.employeeCode);

    const res = await request(app)
      .post("/api/engage/kudos")
      .set(...authHeader(tokenGiver))
      .send({ toEmployeeId: recipientId, message: "Great work on the release!" });
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe("KUDOS");
    expect(res.body.kudos.fromEmployeeId).toBe(giverId);
    expect(res.body.kudos.toEmployeeId).toBe(recipientId);
    postIds.push(res.body.id);

    const feed = await request(app).get("/api/engage/posts?kind=KUDOS").set(...authHeader(tokenRecipient));
    expect(feed.body.rows.some((r: { id: string }) => r.id === res.body.id)).toBe(true);
  });

  it("rejects giving kudos to yourself", async () => {
    const res = await request(app)
      .post("/api/engage/kudos")
      .set(...authHeader(tokenGiver))
      .send({ toEmployeeId: giverId, message: "Nice job me" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SELF_KUDOS");
  });

  it("rejects kudos to a nonexistent employee", async () => {
    const res = await request(app)
      .post("/api/engage/kudos")
      .set(...authHeader(tokenGiver))
      .send({ toEmployeeId: "no-such-employee", message: "Great work!" });
    expect(res.status).toBe(404);
  });

  it("kudos-received and kudos-given counts are live COUNTs that include this kudos", async () => {
    const received = await getKudosReceivedCount(recipientId);
    const given = await getKudosGivenCount(giverId);
    expect(received).toBe(1);
    expect(given).toBe(1);

    // Never counted from the other side.
    expect(await getKudosGivenCount(recipientId)).toBe(0);
    expect(await getKudosReceivedCount(giverId)).toBe(0);
  });

  it("rejects an unauthenticated request", async () => {
    const res = await request(app).post("/api/engage/kudos").send({ toEmployeeId: recipientId, message: "x" });
    expect(res.status).toBe(401);
  });

  describe("employee search (the Give Kudos picker)", () => {
    it("finds a colleague by employee code, self-serve for any plain employee", async () => {
      const res = await request(app).get(`/api/engage/employees/search?q=${recipientCode}`).set(...authHeader(tokenGiver));
      expect(res.status).toBe(200);
      expect(res.body.employees.some((e: { id: string }) => e.id === recipientId)).toBe(true);
    });

    it("never returns the caller themself", async () => {
      const res = await request(app).get(`/api/engage/employees/search?q=${await employeeCodePrefix(giverId)}`).set(...authHeader(tokenGiver));
      expect(res.status).toBe(200);
      expect(res.body.employees.some((e: { id: string }) => e.id === giverId)).toBe(false);
    });

    it("rejects an empty query at the validator", async () => {
      const res = await request(app).get("/api/engage/employees/search?q=").set(...authHeader(tokenGiver));
      expect(res.status).toBe(400);
    });
  });
});

async function employeeCodePrefix(employeeId: string): Promise<string> {
  const employee = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { employeeCode: true } });
  return employee.employeeCode.slice(0, 6);
}
