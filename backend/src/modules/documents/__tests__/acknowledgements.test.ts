import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
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
import { cleanupTestCategories, createTestCategory } from "./documentsTestHelpers";

// M session block 2, ER-18: a company document can require acknowledgement; the people in its audience acknowledge once; HR sees who has.
describe("policy acknowledgement", () => {
  let orgA: TestOrgMasters;
  let orgB: TestOrgMasters;
  const ids: string[] = [];
  const t: Record<string, string> = {};
  const e: Record<string, string> = {};
  const categoryIds: string[] = [];
  let docId = "";
  const as = (who: string) => ({
    get: (p: string) => request(app).get(`/api/document-acks${p}`).set(...authHeader(t[who]!)),
    post: (p: string) => request(app).post(`/api/document-acks${p}`).set(...authHeader(t[who]!)).send({}),
    put: (p: string, body: object) => request(app).put(`/api/document-acks${p}`).set(...authHeader(t[who]!)).send(body),
  });

  beforeAll(async () => {
    orgA = await createEmployeeTestOrgMasters();
    orgB = await createEmployeeTestOrgMasters();
    for (const [k, org, roleCode] of [["hr", orgB, "HR_ADMIN"], ["in1", orgA, undefined], ["in2", orgA, undefined], ["out", orgB, undefined], ["dev", orgA, DEVELOPER_ROLE_CODE], ["mgr", orgA, "MANAGER"]] as const) {
      const x = await createFullTestEmployee(org, roleCode ? { roleCode } : {});
      ids.push(x.employeeId);
      e[k] = x.employeeId;
      t[k] = await loginAs(x.employeeCode);
    }
    const cat = await createTestCategory("COMPANY");
    categoryIds.push(cat.id);
    const doc = await prisma.companyDocument.create({ data: { title: "Code of conduct (test)", categoryId: cat.id, fileKey: `test/${cat.id}.pdf`, fileName: "code.pdf", mimeType: "application/pdf", sizeBytes: 10, scopeDepartmentId: orgA.departmentId, uploadedByUserId: "test" } });
    docId = doc.id;
  });
  afterAll(async () => {
    await cleanupTestCategories(categoryIds);
    for (const id of ids) await cleanupFullTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(orgA);
    await cleanupEmployeeTestOrgMasters(orgB);
  });

  it("nothing is asked until HR requires it; then the audience is told and sees it", async () => {
    expect((await as("in1").get("/mine")).body.documents.map((d: { id: string }) => d.id)).not.toContain(docId);
    expect((await as("in1").post(`/${docId}/acknowledge`)).status).toBe(404);
    expect((await as("hr").put(`/${docId}/required`, { required: true })).status).toBe(200);
    expect(await prisma.notification.count({ where: { type: "documents.ack.required", user: { employeeId: e.in1! } } })).toBe(1);
    expect(await prisma.notification.count({ where: { type: "documents.ack.required", user: { employeeId: e.out! } } })).toBe(0);
    expect((await as("in1").get("/mine")).body.documents).toEqual([{ id: docId, title: "Code of conduct (test)", acknowledgedAt: null }]);
    expect((await as("out").get("/mine")).body.documents.map((d: { id: string }) => d.id)).not.toContain(docId);
  });

  it("someone in the audience acknowledges once; someone outside cannot; HR sees who has and who has not", async () => {
    const a = await as("in1").post(`/${docId}/acknowledge`);
    expect(a.status).toBe(200);
    expect((await as("in1").post(`/${docId}/acknowledge`)).body.acknowledgedAt).toBe(a.body.acknowledgedAt);
    expect((await as("out").post(`/${docId}/acknowledge`)).status).toBe(404);
    const s = await as("hr").get(`/${docId}/status`);
    expect(s.status).toBe(200);
    const byId = Object.fromEntries(s.body.people.map((p: { employeeId: string }) => [p.employeeId, p]));
    expect(byId[e.in1!].acknowledgedAt).toBe(a.body.acknowledgedAt);
    expect(byId[e.in2!].acknowledgedAt).toBeNull();
    expect(byId[e.out!]).toBeUndefined();
    expect(await prisma.auditLog.count({ where: { entityId: docId, action: "documents.ack.acknowledged" } })).toBe(1);
  });

  it("an employee, a manager and the Developer cannot see who acknowledged or change the requirement", async () => {
    for (const who of ["in2", "mgr", "dev"]) {
      expect((await as(who).get(`/${docId}/status`)).status, who).toBe(403);
      expect((await as(who).put(`/${docId}/required`, { required: false })).status, who).toBe(403);
    }
  });

  it("an acknowledgement is never changed or removed", async () => {
    const row = await prisma.companyDocumentAcknowledgement.findFirstOrThrow({ where: { documentId: docId } });
    await expect(prisma.companyDocumentAcknowledgement.update({ where: { id: row.id }, data: { createdAt: new Date(0) } })).rejects.toThrow(/DOCUMENT_ACK_APPEND_ONLY/);
    await expect(prisma.companyDocumentAcknowledgement.delete({ where: { id: row.id } })).rejects.toThrow(/DOCUMENT_ACK_APPEND_ONLY/);
  });

  it("when no longer required, nobody is asked", async () => {
    expect((await as("hr").put(`/${docId}/required`, { required: false })).status).toBe(200);
    expect((await as("in2").get("/mine")).body.documents.map((d: { id: string }) => d.id)).not.toContain(docId);
    expect((await as("in2").post(`/${docId}/acknowledge`)).status).toBe(404);
  });
});
