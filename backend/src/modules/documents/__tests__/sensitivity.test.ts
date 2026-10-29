import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MANAGER_GRANTABLE_KEYS } from "@shared/constants/permissions";
import { prisma } from "../../../lib/prisma";
import { grantManager } from "../../../lib/__tests__/testHelpers";
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
import { cleanupTestCategories, createTestCategory, pdf } from "./documentsTestHelpers";

// Document sensitivity (user decision 2026-10-03): any category that can
// carry money figures (PAY) or ID numbers (STATUTORY) is structurally
// HR-only — never visible to a manager, whatever they're granted, the same
// permanent way bank and statutory data are excluded. The category decides,
// never a per-document box.
describe("Document category sensitivity", () => {
  let org: TestOrgMasters;
  type Person = { employeeId: string; employeeCode: string; userId: string };
  const p = {} as Record<"director" | "hrAdmin" | "hrExec" | "manager" | "member", Person>;
  const tok = {} as Record<keyof typeof p, string>;
  const cat = {} as Record<"general" | "pay" | "statutory", string>;
  const doc = {} as Record<"general" | "pay" | "statutory", string>;
  const categoryIds: string[] = [];

  const as = (who: keyof typeof p) => ({
    get: (path: string) => request(app).get(path).set(...authHeader(tok[who])),
    post: (path: string, body: object = {}) => request(app).post(path).set(...authHeader(tok[who])).send(body),
    patch: (path: string, body: object) => request(app).patch(path).set(...authHeader(tok[who])).send(body),
  });
  const upload = (who: keyof typeof p, categoryId: string) =>
    request(app)
      .post(`/api/documents/employees/${p.member.employeeId}`)
      .set(...authHeader(tok[who]))
      .field("title", "Upload test")
      .field("categoryId", categoryId)
      .attach("file", pdf("Upload test"), { filename: "u.pdf", contentType: "application/pdf" });

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    p.director = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.hrAdmin = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.hrExec = await createFullTestEmployee(org, { roleCode: "HR_EXECUTIVE" });
    p.manager = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    p.member = await createFullTestEmployee(org, { managerId: p.manager.employeeId });
    // The manager holds EVERY manager-grantable key — still no PAY or STATUTORY.
    await grantManager(p.manager.userId, [...MANAGER_GRANTABLE_KEYS]);
    for (const s of ["general", "pay", "statutory"] as const) {
      cat[s] = (await createTestCategory("EMPLOYEE", { sensitivity: s.toUpperCase() as "GENERAL" | "PAY" | "STATUTORY" })).id;
      categoryIds.push(cat[s]);
      doc[s] = (
        await prisma.employeeDocument.create({
          data: { employeeId: p.member.employeeId, categoryId: cat[s], title: `${s} doc`, fileKey: `test/${s}-${Date.now()}.pdf`, fileName: "x.pdf", mimeType: "application/pdf", sizeBytes: 10, uploadedByUserId: p.hrAdmin.userId },
        })
      ).id;
    }
    for (const k of Object.keys(p) as Array<keyof typeof p>) tok[k] = await loginAs(p[k].employeeCode);
  });

  afterAll(async () => {
    await cleanupTestCategories(categoryIds);
    await prisma.userPermissionOverride.deleteMany({ where: { userId: p.manager.userId } });
    for (const k of ["member", "manager", "hrExec", "hrAdmin", "director"] as const) await cleanupFullTestEmployee(p[k].employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  const listed = async (who: keyof typeof p) => ((await as(who).get(`/api/documents/employees/${p.member.employeeId}`)).body as Array<{ id: string }>).map((d) => d.id);

  it("a manager with every grantable key sees only GENERAL documents of their own team; PAY and STATUTORY read as absent", async () => {
    const ids = await listed("manager");
    expect(ids).toContain(doc.general);
    expect(ids).not.toContain(doc.pay);
    expect(ids).not.toContain(doc.statutory);
    expect((await as("manager").post(`/api/documents/employee-documents/${doc.pay}/download`)).status).toBe(404);
    expect((await as("manager").post(`/api/documents/employee-documents/${doc.statutory}/download`)).status).toBe(404);
  });

  it("an HR Executive (no salary, bank or statutory data — spec §2) sees GENERAL only; HR Admin sees GENERAL and STATUTORY but, since Stage 1, never PAY; a director sees all three", async () => {
    const exec = await listed("hrExec");
    expect(exec).toContain(doc.general);
    expect(exec).not.toContain(doc.pay);
    expect(exec).not.toContain(doc.statutory);
    const admin = await listed("hrAdmin");
    expect(admin).toEqual(expect.arrayContaining([doc.general, doc.statutory]));
    expect(admin).not.toContain(doc.pay);
    expect(await listed("director")).toEqual(expect.arrayContaining([doc.general, doc.pay, doc.statutory]));
  });

  it("the keys that open PAY and STATUTORY are never manager-grantable", () => {
    expect(MANAGER_GRANTABLE_KEYS).not.toContain("documents.pay.view");
    expect(MANAGER_GRANTABLE_KEYS).not.toContain("employee.statutory.view");
  });

  it("nobody files a document where they couldn't read it back", async () => {
    expect((await upload("hrExec", cat.pay)).status).toBe(403);
    expect((await upload("hrExec", cat.statutory)).status).toBe(403);
    const ok = await upload("hrExec", cat.general);
    expect(ok.status).toBe(201);
    const cats = (await as("hrExec").get("/api/documents/categories?appliesTo=EMPLOYEE")).body as Array<{ id: string; readable: boolean }>;
    expect(cats.find((c) => c.id === cat.pay)?.readable).toBe(false);
    expect(cats.find((c) => c.id === cat.general)?.readable).toBe(true);
  });

  it("a document can't move to a less sensitive category", async () => {
    const res = await as("director").patch(`/api/documents/employee-documents/${doc.pay}`, { categoryId: cat.general });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("SENSITIVITY_LOWERING");
  });

  it("categories: an employee category must declare what it may contain; company ones are General; sensitivity is raise-only", async () => {
    const code = `T_${Date.now().toString(36).toUpperCase()}`;
    expect((await as("hrAdmin").post("/api/documents/categories", { code, name: code, appliesTo: "EMPLOYEE" })).status).toBe(400);
    expect((await as("hrAdmin").post("/api/documents/categories", { code, name: code, appliesTo: "COMPANY", sensitivity: "PAY" })).status).toBe(400);
    const created = await as("hrAdmin").post("/api/documents/categories", { code, name: code, appliesTo: "EMPLOYEE", sensitivity: "GENERAL" });
    expect(created.status).toBe(201);
    categoryIds.push(created.body.id);
    expect((await as("hrAdmin").patch(`/api/documents/categories/${created.body.id}`, { sensitivity: "PAY" })).status).toBe(200);
    const lower = await as("hrAdmin").patch(`/api/documents/categories/${created.body.id}`, { sensitivity: "GENERAL" });
    expect(lower.status).toBe(409);
    expect(lower.body.error.code).toBe("SENSITIVITY_LOWERING");
    expect((await as("hrAdmin").patch(`/api/documents/categories/${created.body.id}`, { sensitivity: "STATUTORY" })).status).toBe(409);
  });

  it("the seeded system categories: LETTERS is PAY, ID_PROOFS is STATUTORY", async () => {
    const seeded = await prisma.documentCategory.findMany({ where: { code: { in: ["LETTERS", "ID_PROOFS"] } } });
    expect(Object.fromEntries(seeded.map((c) => [c.code, c.sensitivity]))).toEqual({ LETTERS: "PAY", ID_PROOFS: "STATUTORY" });
  });
});
