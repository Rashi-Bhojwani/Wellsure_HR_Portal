import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import { storageService } from "../../../integrations/storage";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { resetPolicy, setPolicy } from "../../policySettings/__tests__/policyTestHelpers";
import { cleanupTestCategories, createTestCategory } from "../../documents/__tests__/documentsTestHelpers";
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

// AD-07 (M session): retention periods are Not set (nothing is ever due); once a director sets one and another confirms it, a former employee past
// it is listed; erasing needs one director to propose and a different director to confirm. Contact, general documents and helpdesk tickets.
describe("data retention", () => {
  let org: TestOrgMasters;
  const ids: string[] = [];
  const t: Record<string, string> = {};
  const e: Record<string, string> = {};
  const categoryIds: string[] = [];
  let helpdeskCategoryId = "";
  let ticketId = "";
  let docKey = "";
  let payDocKey = "";
  const as = (who: string | null) => ({
    get: (p: string) => (who ? request(app).get(`/api/retention${p}`).set(...authHeader(t[who]!)) : request(app).get(`/api/retention${p}`)),
    post: (p: string, body: object = {}) => (who ? request(app).post(`/api/retention${p}`).set(...authHeader(t[who]!)).send(body) : request(app).post(`/api/retention${p}`).send(body)),
  });
  const dueFor = async (who: string) => ((await as(who).get("/due")).body.due as Array<{ employeeId: string; category: string; proposal: { id: string } | null }>).filter((d) => d.employeeId === e.gone);

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    for (const [k, roleCode] of [["d1", "SUPER_ADMIN"], ["d2", "SUPER_ADMIN"], ["hr", "HR_ADMIN"], ["emp", undefined], ["mgr", "MANAGER"], ["dev", DEVELOPER_ROLE_CODE], ["gone", undefined], ["recent", undefined]] as const) {
      const x = await createFullTestEmployee(org, roleCode ? { roleCode } : {});
      ids.push(x.employeeId);
      e[k] = x.employeeId;
      t[k] = await loginAs(x.employeeCode);
    }
    await prisma.employee.update({ where: { id: e.gone! }, data: { status: "SEPARATED", lastWorkingDate: new Date("2020-01-31T00:00:00Z") } });
    await prisma.employee.update({ where: { id: e.recent! }, data: { status: "SEPARATED", lastWorkingDate: new Date("2026-10-31T00:00:00Z") } });
    const general = await createTestCategory("EMPLOYEE");
    const pay = await createTestCategory("EMPLOYEE", { sensitivity: "PAY" });
    categoryIds.push(general.id, pay.id);
    docKey = `test/retention/${randomUUID()}.pdf`;
    payDocKey = `test/retention/${randomUUID()}.pdf`;
    await storageService.putObject(docKey, Buffer.from("%PDF general"), "application/pdf");
    await storageService.putObject(payDocKey, Buffer.from("%PDF pay"), "application/pdf");
    for (const [cat, key] of [[general.id, docKey], [pay.id, payDocKey]] as const) await prisma.employeeDocument.create({ data: { employeeId: e.gone!, categoryId: cat, title: "Kept for test", fileKey: key, fileName: "x.pdf", mimeType: "application/pdf", sizeBytes: 10, uploadedByUserId: "test" } });
    helpdeskCategoryId = (await prisma.helpdeskCategory.create({ data: { code: `T_${randomUUID().slice(0, 8)}`, name: "Test helpdesk" } })).id;
    const ticket = await prisma.helpdeskTicket.create({ data: { raisedByEmployeeId: e.gone!, categoryId: helpdeskCategoryId, subject: "My home address changed", messages: { create: { authorEmployeeId: e.gone!, body: "New address: 12 Test Street" } } } });
    ticketId = ticket.id;
  });
  afterAll(async () => {
    await resetPolicy("policy.retention", t.d1!, t.d2!);
    await deleteWithDependents("HelpdeskCategory", [helpdeskCategoryId]);
    await cleanupTestCategories(categoryIds);
    for (const id of ids) await cleanupFullTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("every period starts Not set: nothing is due and nothing can be proposed", async () => {
    const r = await as("d1").get("/due");
    expect(r.body.periods).toEqual({ contactMonths: null, documentsMonths: null, helpdeskMonths: null });
    expect(await dueFor("d1")).toEqual([]);
    for (const category of ["CONTACT", "DOCUMENTS", "HELPDESK"]) expect((await as("d1").post("/erasures", { employeeId: e.gone, category })).body.error.code, category).toBe("NOT_SET");
  });

  it("only a director may read or propose; HR, a manager, an employee and the Developer are refused; signed out is 401", async () => {
    expect((await as(null).get("/due")).status).toBe(401);
    for (const who of ["hr", "mgr", "emp", "dev"]) {
      expect((await as(who).get("/due")).status, who).toBe(403);
      expect((await as(who).post("/erasures", { employeeId: e.gone, category: "CONTACT" })).status, who).toBe(403);
      expect((await as(who).post("/erasures/x/confirm")).status, who).toBe(403);
    }
  });

  it("once periods are set, only someone past them is due; the same director cannot confirm; another director erases, audited", async () => {
    await setPolicy("policy.retention", { contactMonths: 24, documentsMonths: 24, helpdeskMonths: 24 }, t.d1!, t.d2!);
    expect((await dueFor("d1")).map((d) => d.category).sort()).toEqual(["CONTACT", "DOCUMENTS", "HELPDESK"]);
    expect((await as("d1").post("/erasures", { employeeId: e.recent, category: "CONTACT" })).body.error.code).toBe("NOT_DUE");
    const before = await prisma.employeePersonal.findUniqueOrThrow({ where: { employeeId: e.gone! } });
    const ids: Record<string, string> = {};
    for (const category of ["CONTACT", "DOCUMENTS", "HELPDESK"]) ids[category] = (await as("d1").post("/erasures", { employeeId: e.gone, category })).body.id;
    expect((await as("d1").post("/erasures", { employeeId: e.gone, category: "CONTACT" })).body.error.code).toBe("ALREADY_PROPOSED");
    expect((await as("d1").post(`/erasures/${ids.CONTACT}/confirm`)).body.error.code).toBe("CHECKER_IS_MAKER");
    // Nothing is erased by a proposal alone.
    expect((await prisma.employeePersonal.findUniqueOrThrow({ where: { employeeId: e.gone! } })).mobile).toBe(before.mobile);
    await expect(prisma.dataErasure.update({ where: { id: ids.CONTACT! }, data: { status: "DONE", confirmedByUserId: (await prisma.dataErasure.findUniqueOrThrow({ where: { id: ids.CONTACT! } })).proposedByUserId, doneAt: new Date() } })).rejects.toThrow(/data_erasures_other_director/);
    for (const category of ["CONTACT", "DOCUMENTS", "HELPDESK"]) expect((await as("d2").post(`/erasures/${ids[category]}/confirm`)).status, category).toBe(200);
    const after = await prisma.employeePersonal.findUniqueOrThrow({ where: { employeeId: e.gone! } });
    expect([after.mobile, after.currentAddress, after.personalEmail]).toEqual(["Erased", "Erased", "Erased"]);
    const docs = await prisma.employeeDocument.findMany({ where: { employeeId: e.gone! }, include: { category: true } });
    expect(docs.find((d) => d.category.sensitivity === "GENERAL")!.title).toBe("Erased document");
    expect(docs.find((d) => d.category.sensitivity === "PAY")!.title).toBe("Kept for test");
    expect(await storageService.getObject(payDocKey).then(() => true, () => false)).toBe(true);
    const ticket = await prisma.helpdeskTicket.findUniqueOrThrow({ where: { id: ticketId }, include: { messages: true } });
    expect([ticket.subject, ticket.messages[0]!.body]).toEqual(["Erased", "Erased"]);
    expect(await prisma.auditLog.count({ where: { action: { in: ["retention.erasure.proposed", "retention.erasure.done"] }, entityId: { in: Object.values(ids) } } })).toBe(6);
    expect(await dueFor("d1")).toEqual([]);
    await expect(prisma.dataErasure.delete({ where: { id: ids.CONTACT! } })).rejects.toThrow(/DATA_ERASURE_FIXED/);
  });
});
