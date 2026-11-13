import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupFullTestEmployee,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  loginAs,
  type TestOrgMasters,
} from "../../employee/__tests__/employeeTestHelpers";

// M session block 2, SS-13: feedback to HR, named or without a name (then nothing links it to the sender).
describe("employee feedback", () => {
  let org: TestOrgMasters;
  const ids: string[] = [];
  const t: Record<string, string> = {};
  const e: Record<string, string> = {};
  const u: Record<string, string> = {};
  const anonymousIds: string[] = [];
  const marker = `m-feedback-${Date.now()}`;
  const as = (who: string) => ({
    get: (p: string) => request(app).get(`/api/feedback${p}`).set(...authHeader(t[who]!)),
    post: (p: string, body: object = {}) => request(app).post(`/api/feedback${p}`).set(...authHeader(t[who]!)).send(body),
  });
  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    for (const [k, roleCode] of [["hr", "HR_ADMIN"], ["emp", undefined], ["other", undefined], ["dev", DEVELOPER_ROLE_CODE], ["mgr", "MANAGER"]] as const) {
      const x = await createFullTestEmployee(org, roleCode ? { roleCode } : {});
      ids.push(x.employeeId);
      e[k] = x.employeeId;
      u[k] = x.userId;
      t[k] = await loginAs(x.employeeCode);
    }
  });
  afterAll(async () => {
    await deleteWithDependents("EmployeeFeedback", anonymousIds);
    for (const id of ids) await cleanupFullTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("anonymous feedback is allowed by default and stores nothing that names the sender", async () => {
    expect((await as("emp").get("/options")).body.anonymousAllowed).toBe(true);
    const r = await as("emp").post("/", { category: "SUGGESTION", message: `${marker} anonymous: a quieter room for calls`, anonymous: true });
    expect(r.status).toBe(201);
    anonymousIds.push(r.body.id);
    const row = await prisma.employeeFeedback.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(row.authorEmployeeId).toBeNull();
    expect(await prisma.auditLog.count({ where: { entityId: r.body.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { actorUserId: u.emp!, action: { startsWith: "feedback." } } })).toBe(0);
    expect((await as("emp").get("/mine")).body.feedback.map((f: { id: string }) => f.id)).not.toContain(r.body.id);
    const listed = (await as("hr").get("/")).body.feedback.find((f: { id: string }) => f.id === r.body.id);
    expect(listed.from).toBeNull();
    expect((await as("hr").post(`/${r.body.id}/replies`, { message: "Thanks" })).body.error.code).toBe("ANONYMOUS");
  });

  it("named feedback is answered; the sender sees the reply and is told", async () => {
    const r = await as("emp").post("/", { category: "CONCERN", message: `${marker} named: the canteen closes early`, anonymous: false });
    const all = (await as("hr").get("/")).body;
    const listed = all.feedback.find((f: { id: string }) => f.id === r.body.id);
    expect(listed, JSON.stringify({ r: r.body, n: all.feedback?.length, err: all.error })).toBeDefined();
    expect(listed.from.fullName).toBeTruthy();
    expect((await as("hr").post(`/${r.body.id}/replies`, { message: "We will look at the hours." })).status).toBe(201);
    expect((await as("emp").get("/mine")).body.feedback.find((f: { id: string }) => f.id === r.body.id).replies).toHaveLength(1);
    expect(await prisma.notification.count({ where: { type: "feedback.replied", user: { employeeId: e.emp! } } })).toBe(1);
    expect((await as("hr").post(`/${r.body.id}/close`)).body.status).toBe("CLOSED");
    expect((await as("hr").post(`/${r.body.id}/replies`, { message: "Again" })).status).toBe(409);
  });

  it("an employee, a manager and the Developer cannot read the feedback of others or answer it", async () => {
    const r = await as("emp").post("/", { category: "OTHER", message: `${marker} visible only to HR`, anonymous: false });
    for (const who of ["other", "mgr", "dev"]) {
      expect((await as(who).get("/")).status, who).toBe(403);
      expect((await as(who).post(`/${r.body.id}/replies`, { message: "Hi there" })).status, who).toBe(403);
    }
    expect((await as("other").get("/mine")).body.feedback).toEqual([]);
  });
});
