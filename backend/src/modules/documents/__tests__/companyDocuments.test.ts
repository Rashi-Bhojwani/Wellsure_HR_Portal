import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../../lib/prisma";
import { PEOPLE_DOCUMENTS_SETTING_KEYS } from "../../../lib/peopleDocumentsSettings";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupFullTestEmployee,
  cleanupTestRole,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  grantPermissions,
  loginAs,
  type TestOrgMasters,
} from "../../employee/__tests__/employeeTestHelpers";
import { setSetting, snapshotPeopleDocumentsSettings } from "../../people/__tests__/peopleTestHelpers";
import { cleanupTestCategories, createTestCategory, fetchSignedUrl, pdf } from "./documentsTestHelpers";

describe("Company documents (/api/documents/company)", () => {
  const managerRole = `TEST_DOCS_MGR_${Date.now()}`;
  let restoreSettings: () => Promise<void>;
  let orgA: TestOrgMasters;
  let orgB: TestOrgMasters;
  const categoryIds: string[] = [];
  let companyCategoryId: string;
  const employees: string[] = [];
  let hrToken: string;
  let inAudienceToken: string;
  let outsideToken: string;
  let inAudienceId: string;

  beforeAll(async () => {
    restoreSettings = await snapshotPeopleDocumentsSettings();
    orgA = await createEmployeeTestOrgMasters();
    orgB = await createEmployeeTestOrgMasters();
    await grantPermissions(managerRole, ["documents.manage"]);
    const hr = await createFullTestEmployee(orgB, { roleCode: managerRole });
    const inAudience = await createFullTestEmployee(orgA);
    const outside = await createFullTestEmployee(orgB);
    employees.push(hr.employeeId, inAudience.employeeId, outside.employeeId);
    inAudienceId = inAudience.employeeId;
    hrToken = await loginAs(hr.employeeCode);
    inAudienceToken = await loginAs(inAudience.employeeCode);
    outsideToken = await loginAs(outside.employeeCode);
    const category = await createTestCategory("COMPANY");
    companyCategoryId = category.id;
    categoryIds.push(category.id);
  });

  afterAll(async () => {
    await cleanupTestCategories(categoryIds);
    for (const id of employees) await cleanupFullTestEmployee(id);
    await cleanupTestRole(managerRole);
    await cleanupEmployeeTestOrgMasters(orgA);
    await cleanupEmployeeTestOrgMasters(orgB);
    await restoreSettings();
  });

  function upload(token: string, fields: Record<string, string>, file: Buffer, filename: string, contentType: string) {
    let req = request(app).post("/api/documents/company").set(...authHeader(token));
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return req.attach("file", file, { filename, contentType });
  }

  let scopedDocId: string;

  it("only documents.manage holders can upload or see the management list", async () => {
    const denied = await upload(inAudienceToken, { title: "Nope", categoryId: companyCategoryId }, pdf(), "a.pdf", "application/pdf");
    expect(denied.status).toBe(403);
    expect((await request(app).get("/api/documents/company/manage").set(...authHeader(inAudienceToken))).status).toBe(403);
  });

  it("a department-scoped document reaches only that department: list and download both 404 outside it", async () => {
    const res = await upload(hrToken, { title: "Dept A policy", categoryId: companyCategoryId, scopeDepartmentId: orgA.departmentId }, pdf("Dept A"), "dept-a.pdf", "application/pdf");
    expect(res.status).toBe(201);
    scopedDocId = res.body.id;
    expect(res.body.scopeDepartment.id).toBe(orgA.departmentId);

    const insideList = await request(app).get("/api/documents/company").set(...authHeader(inAudienceToken));
    expect(insideList.body.map((d: { id: string }) => d.id)).toContain(scopedDocId);
    const outsideList = await request(app).get("/api/documents/company").set(...authHeader(outsideToken));
    expect(outsideList.body.map((d: { id: string }) => d.id)).not.toContain(scopedDocId);
    expect((await request(app).post(`/api/documents/company/${scopedDocId}/download`).set(...authHeader(outsideToken))).status).toBe(404);
  });

  it("downloads hand out a short-lived signed URL with the original filename, and record who read it", async () => {
    const first = await request(app).post(`/api/documents/company/${scopedDocId}/download`).set(...authHeader(inAudienceToken));
    expect(first.status).toBe(200);
    expect(first.body.expiresInSeconds).toBe(60);
    const file = await fetchSignedUrl(first.body.url);
    expect(file.status).toBe(200);
    expect(file.headers["content-disposition"]).toContain('filename="dept-a.pdf"');
    expect((file.body as Buffer).subarray(0, 5).toString()).toBe("%PDF-");

    await request(app).post(`/api/documents/company/${scopedDocId}/download`).set(...authHeader(inAudienceToken));
    const record = await prisma.companyDocumentDownload.findUniqueOrThrow({
      where: { documentId_employeeId: { documentId: scopedDocId, employeeId: inAudienceId } },
    });
    expect(record.downloadCount).toBe(2);

    // HR previewing a document outside its own audience isn't "reading" it.
    expect((await request(app).post(`/api/documents/company/${scopedDocId}/download`).set(...authHeader(hrToken))).status).toBe(200);
    const stats = await request(app).get(`/api/documents/company/${scopedDocId}/downloads`).set(...authHeader(hrToken));
    expect(stats.body.downloadedByCount).toBe(1);
    expect(stats.body.audienceSize).toBe(1);
    expect(stats.body.downloads[0]).toMatchObject({ employeeId: inAudienceId, downloadCount: 2 });
  });

  it("a signed URL can't be replayed under a different filename", async () => {
    const res = await request(app).post(`/api/documents/company/${scopedDocId}/download`).set(...authHeader(inAudienceToken));
    const tampered = res.body.url.replace("dn=dept-a.pdf", "dn=evil.html");
    expect((await fetchSignedUrl(tampered)).status).toBe(403);
  });

  it("rejects a file whose bytes, extension or type don't line up, or that the settings don't allow", async () => {
    const fields = { title: "Bad", categoryId: companyCategoryId };
    const notPdf = await upload(hrToken, fields, Buffer.from("<html>hi</html>"), "x.pdf", "application/pdf");
    expect(notPdf.status).toBe(400);
    expect(notPdf.body.error.message).toMatch(/contents/);

    const wrongExt = await upload(hrToken, fields, pdf(), "x.docx", "application/pdf");
    expect(wrongExt.status).toBe(400);
    expect(wrongExt.body.error.message).toMatch(/extension/);

    await setSetting(PEOPLE_DOCUMENTS_SETTING_KEYS.documentAllowedMimeTypes, ["application/pdf"]);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const disallowed = await upload(hrToken, fields, png, "x.png", "image/png");
    expect(disallowed.status).toBe(400);
    expect(disallowed.body.error.message).toMatch(/isn't allowed/);

    await setSetting(PEOPLE_DOCUMENTS_SETTING_KEYS.documentMaxUploadMb, 0.0001);
    const tooBig = await upload(hrToken, fields, pdf(), "x.pdf", "application/pdf");
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.error.message).toMatch(/limit/);
    await restoreSettings();
    restoreSettings = await snapshotPeopleDocumentsSettings();

    const employeeCategory = await createTestCategory("EMPLOYEE");
    const inactive = await createTestCategory("COMPANY", { isActive: false });
    categoryIds.push(employeeCategory.id, inactive.id);
    expect((await upload(hrToken, { title: "x", categoryId: employeeCategory.id }, pdf(), "x.pdf", "application/pdf")).status).toBe(400);
    expect((await upload(hrToken, { title: "x", categoryId: inactive.id }, pdf(), "x.pdf", "application/pdf")).status).toBe(400);
    expect((await upload(hrToken, fields, pdf(), "x.pdf", "application/pdf").field("scopeLocationId", "missing")).status).toBe(400);
  });

  it("archiving hides a document from employees without deleting it, and is audit-logged", async () => {
    const res = await request(app).post(`/api/documents/company/${scopedDocId}/archive`).set(...authHeader(hrToken));
    expect(res.status).toBe(200);
    expect((await request(app).post(`/api/documents/company/${scopedDocId}/archive`).set(...authHeader(hrToken))).status).toBe(409);

    const list = await request(app).get("/api/documents/company").set(...authHeader(inAudienceToken));
    expect(list.body.map((d: { id: string }) => d.id)).not.toContain(scopedDocId);
    expect((await request(app).post(`/api/documents/company/${scopedDocId}/download`).set(...authHeader(inAudienceToken))).status).toBe(404);

    const managed = await request(app).get("/api/documents/company/manage").query({ includeArchived: "true" }).set(...authHeader(hrToken));
    expect(managed.body.find((d: { id: string }) => d.id === scopedDocId).archivedAt).not.toBeNull();
    expect(await prisma.companyDocument.count({ where: { id: scopedDocId } })).toBe(1);

    const actions = (await prisma.auditLog.findMany({ where: { entityId: scopedDocId } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["documents.company.uploaded", "documents.company.archived"]));

    expect((await request(app).post(`/api/documents/company/${scopedDocId}/unarchive`).set(...authHeader(hrToken))).status).toBe(200);
  });

  it("categories: anyone can list active ones; only documents.manage can create or change them", async () => {
    expect((await request(app).get("/api/documents/categories").set(...authHeader(outsideToken))).status).toBe(200);
    const denied = await request(app).post("/api/documents/categories").set(...authHeader(outsideToken)).send({ code: "X", name: "X", appliesTo: "COMPANY" });
    expect(denied.status).toBe(403);
    const code = `TEST_CAT_${Date.now()}`;
    const created = await request(app).post("/api/documents/categories").set(...authHeader(hrToken)).send({ code, name: "Handbooks", appliesTo: "COMPANY" });
    expect(created.status).toBe(201);
    categoryIds.push(created.body.id);
    expect((await request(app).post("/api/documents/categories").set(...authHeader(hrToken)).send({ code, name: "Dup", appliesTo: "COMPANY" })).status).toBe(409);
    const deactivated = await request(app).patch(`/api/documents/categories/${created.body.id}`).set(...authHeader(hrToken)).send({ isActive: false });
    expect(deactivated.body.isActive).toBe(false);
    const list = await request(app).get("/api/documents/categories").set(...authHeader(outsideToken));
    expect(list.body.map((c: { id: string }) => c.id)).not.toContain(created.body.id);
  });
});
