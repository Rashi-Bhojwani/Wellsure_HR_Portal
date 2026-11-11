import { randomUUID } from "node:crypto";
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

// LT-08 (M session): an employee asks for a letter from a template the directors listed; whoever may prepare it marks it done or declines it.
describe("an employee asks for a letter", () => {
  let org: TestOrgMasters;
  const ids: string[] = [];
  const t: Record<string, string> = {};
  const u: Record<string, { employeeId: string; userId: string }> = {};
  const code = `TASK_${randomUUID().slice(0, 6).toUpperCase().replace(/-/g, "")}`;
  let templateId = "";
  const as = (who: string) => ({
    get: (p: string) => request(app).get(`/api/letters${p}`).set(...authHeader(t[who]!)),
    post: (p: string, body: object = {}) => request(app).post(`/api/letters${p}`).set(...authHeader(t[who]!)).send(body),
  });
  async function setAskable(codes: string[]) {
    const p = await request(app).post("/api/behaviours/letters.employeeMayAsk/proposals").set(...authHeader(t.d1!)).send({ value: codes, reason: "Letter asks test" });
    expect(p.status).toBe(201);
    expect((await request(app).post(`/api/behaviours/proposals/${p.body.id}/confirm`).set(...authHeader(t.d2!)).send({})).status).toBe(200);
  }

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    for (const [k, roleCode] of [["d1", "SUPER_ADMIN"], ["d2", "SUPER_ADMIN"], ["emp", undefined], ["other", undefined], ["dev", DEVELOPER_ROLE_CODE], ["mgr", "MANAGER"]] as const) {
      const e = await createFullTestEmployee(org, roleCode ? { roleCode } : {});
      ids.push(e.employeeId);
      u[k] = e;
      t[k] = await loginAs(e.employeeCode);
    }
    const tpl = await prisma.letterTemplate.create({ data: { code, name: "Test address proof", versions: { create: { version: 1, bodyHtml: "<p>This is to certify the address of {{employee.fullName}}.</p>", extraFields: [] } } } });
    templateId = tpl.id;
  });

  afterAll(async () => {
    await setAskable([]);
    await deleteWithDependents("LetterTemplate", [templateId]);
    for (const id of ids) await cleanupFullTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("nothing can be asked for until a director lists a template", async () => {
    expect((await as("emp").get("/asks/options")).body.templates.map((x: { code: string }) => x.code)).not.toContain(code);
    expect((await as("emp").post("/asks/mine", { templateCode: code, purpose: "Bank account opening" })).body.error.code).toBe("NOT_ASKABLE");
  });

  it("once listed, an employee asks (once at a time) and the directors are told", async () => {
    await setAskable([code]);
    expect((await as("emp").get("/asks/options")).body.templates.map((x: { code: string }) => x.code)).toContain(code);
    expect((await as("emp").post("/asks/mine", { templateCode: code, purpose: "x" })).status).toBe(400);
    const r = await as("emp").post("/asks/mine", { templateCode: code, purpose: "Bank account opening" });
    expect(r.status).toBe(201);
    expect((await as("emp").post("/asks/mine", { templateCode: code, purpose: "Again please" })).status).toBe(409);
    expect(await prisma.notification.count({ where: { userId: u.d1!.userId, type: "letters.ask.created" } })).toBeGreaterThan(0);
    expect((await as("emp").get("/asks/mine")).body.asks[0]).toMatchObject({ status: "ASKED", purpose: "Bank account opening" });
  });

  it("only those who may prepare the template see and decide asks: not the employee, a manager or the Developer; never someone else's withdraw", async () => {
    const mine = (await as("emp").get("/asks/mine")).body.asks[0];
    for (const who of ["emp", "mgr", "dev"]) {
      expect((await as(who).get("/asks")).status, who).toBe(403);
      expect((await as(who).post(`/asks/${mine.id}/decline`, { reason: "Not for you" })).status, who).toBe(403);
    }
    expect((await as("other").post(`/asks/mine/${mine.id}/withdraw`)).status).toBe(404);
    const listed = (await as("d1").get("/asks")).body.asks as Array<{ id: string; employee: { id: string } }>;
    expect(listed.map((a) => a.id)).toContain(mine.id);
  });

  it("done names a letter for the same person and template; the decided ask never changes", async () => {
    const mine = (await as("emp").get("/asks/mine")).body.asks[0];
    const wrongPerson = await prisma.letterRequest.create({ data: { batchId: randomUUID(), clientKey: randomUUID(), templateId, employeeId: u.other!.employeeId, preparedByUserId: u.d1!.userId } });
    expect((await as("d1").post(`/asks/${mine.id}/done`, { letterRequestId: wrongPerson.id })).body.error.code).toBe("LETTER_MISMATCH");
    const right = await prisma.letterRequest.create({ data: { batchId: randomUUID(), clientKey: randomUUID(), templateId, employeeId: u.emp!.employeeId, preparedByUserId: u.d1!.userId } });
    expect((await as("d1").post(`/asks/${mine.id}/done`, { letterRequestId: right.id })).status).toBe(200);
    expect(await prisma.notification.count({ where: { userId: u.emp!.userId, type: "letters.ask.done" } })).toBe(1);
    expect((await as("d2").post(`/asks/${mine.id}/decline`, { reason: "Too late" })).status).toBe(409);
    await expect(prisma.letterAsk.update({ where: { id: mine.id }, data: { note: "edited" } })).rejects.toThrow(/LETTER_ASK_DECIDED/);
  });

  it("a decline needs a reason and tells the employee; the employee may withdraw an ask that waits", async () => {
    const a = await as("emp").post("/asks/mine", { templateCode: code, purpose: "Visa application" });
    expect((await as("d2").post(`/asks/${a.body.id}/decline`, { reason: "" })).status).toBe(400);
    expect((await as("d2").post(`/asks/${a.body.id}/decline`, { reason: "Use the experience letter instead" })).status).toBe(200);
    expect(await prisma.notification.count({ where: { userId: u.emp!.userId, type: "letters.ask.declined" } })).toBe(1);
    const b = await as("emp").post("/asks/mine", { templateCode: code, purpose: "Rental agreement" });
    expect((await as("emp").post(`/asks/mine/${b.body.id}/withdraw`)).status).toBe(200);
  });

  it("a director's own ask is not offered to them to decide", async () => {
    const a = await as("d1").post("/asks/mine", { templateCode: code, purpose: "My own address proof" });
    expect(a.status).toBe(201);
    expect(((await as("d1").get("/asks")).body.asks as Array<{ id: string }>).map((x) => x.id)).not.toContain(a.body.id);
    expect((await as("d1").post(`/asks/${a.body.id}/decline`, { reason: "Declining my own" })).status).toBe(404);
    expect((await as("d2").post(`/asks/${a.body.id}/decline`, { reason: "Test cleanup" })).status).toBe(200);
  });
});
