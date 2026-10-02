import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../../lib/prisma";
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
  revokePermissions,
  type TestOrgMasters,
} from "../../employee/__tests__/employeeTestHelpers";
import { addLiteralRole, cleanupTestCategories, createTestCategory, fetchSignedUrl, pdf } from "./documentsTestHelpers";

// HR-held employee documents: permission AND data scope on every route,
// and the employee sees only what HR marked visible (IDOR — spec §9).
describe("Employee documents (/api/documents/employees, /me)", () => {
  const hrRole = `TEST_EMPDOC_HR_${Date.now()}`;
  const DOC_PERMS = ["employee.documents.view", "employee.documents.manage"];
  let org: TestOrgMasters;
  const categoryIds: string[] = [];
  let categoryId: string;
  const people: Record<"hr" | "owner" | "colleague" | "manager" | "otherManager", { employeeId: string; employeeCode: string; userId: string }> =
    {} as never;
  const tokens = {} as Record<keyof typeof people, string>;
  let managerRoleHadDocPerms: string[] = [];
  let visibleDocId: string;
  let hiddenDocId: string;

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    await grantPermissions(hrRole, DOC_PERMS);
    categoryId = (await createTestCategory("EMPLOYEE")).id;
    categoryIds.push(categoryId);

    people.hr = await createFullTestEmployee(org, { roleCode: hrRole });
    await addLiteralRole(people.hr.userId, "HR_ADMIN"); // ALL scope
    people.manager = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    people.otherManager = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    people.owner = await createFullTestEmployee(org, { managerId: people.manager.employeeId });
    people.colleague = await createFullTestEmployee(org, { managerId: people.manager.employeeId });

    // The seeded MANAGER role must NOT hold these (checked in the permission
    // matrix test); for the "permission but out of scope" case we grant them
    // temporarily, remembering what was there so afterAll restores it exactly.
    const role = await prisma.role.findUnique({ where: { code: "MANAGER" }, include: { permissions: { include: { permission: true } } } });
    managerRoleHadDocPerms = role?.permissions.map((p) => p.permission.key).filter((k) => DOC_PERMS.includes(k)) ?? [];

    for (const key of Object.keys(people) as Array<keyof typeof people>) tokens[key] = await loginAs(people[key].employeeCode);
  });

  afterAll(async () => {
    await revokePermissions("MANAGER", DOC_PERMS.filter((k) => !managerRoleHadDocPerms.includes(k)));
    await cleanupTestCategories(categoryIds);
    for (const key of ["owner", "colleague", "manager", "otherManager", "hr"] as const) await cleanupFullTestEmployee(people[key].employeeId);
    await cleanupTestRole(hrRole);
    await cleanupEmployeeTestOrgMasters(org);
  });

  function uploadFor(employeeId: string, token: string, fields: Record<string, string>) {
    let req = request(app).post(`/api/documents/employees/${employeeId}`).set(...authHeader(token));
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return req.attach("file", pdf(fields.title), { filename: "letter.pdf", contentType: "application/pdf" });
  }

  it("HR uploads; a visible document notifies the employee, a hidden one doesn't", async () => {
    const visible = await uploadFor(people.owner.employeeId, tokens.hr, { title: "Offer Letter", categoryId, visibleToEmployee: "true" });
    expect(visible.status).toBe(201);
    visibleDocId = visible.body.id;
    const hidden = await uploadFor(people.owner.employeeId, tokens.hr, { title: "PAN copy", categoryId, visibleToEmployee: "false" });
    expect(hidden.status).toBe(201);
    hiddenDocId = hidden.body.id;

    const notes = await prisma.notification.findMany({ where: { userId: people.owner.userId, type: "document.added" } });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.body).toContain("Offer Letter");
    expect(await prisma.auditLog.count({ where: { entityId: people.owner.employeeId, action: "employee.document.uploaded" } })).toBe(2);
  });

  it("the employee sees and downloads only their own visible, live documents", async () => {
    const mine = await request(app).get("/api/documents/me").set(...authHeader(tokens.owner));
    expect(mine.body.map((d: { id: string }) => d.id)).toEqual([visibleDocId]);
    const ok = await request(app).post(`/api/documents/me/${visibleDocId}/download`).set(...authHeader(tokens.owner));
    expect(ok.status).toBe(200);
    expect((await fetchSignedUrl(ok.body.url)).status).toBe(200);
    expect((await request(app).post(`/api/documents/me/${hiddenDocId}/download`).set(...authHeader(tokens.owner))).status).toBe(404);
  });

  it("another employee can't reach someone else's document through any route", async () => {
    expect((await request(app).post(`/api/documents/me/${visibleDocId}/download`).set(...authHeader(tokens.colleague))).status).toBe(404);
    expect((await request(app).get(`/api/documents/employees/${people.owner.employeeId}`).set(...authHeader(tokens.colleague))).status).toBe(403);
    expect((await request(app).post(`/api/documents/employee-documents/${visibleDocId}/download`).set(...authHeader(tokens.colleague))).status).toBe(403);
  });

  it("a manager can't see their own team's documents — the permission isn't theirs", async () => {
    expect((await request(app).get(`/api/documents/employees/${people.owner.employeeId}`).set(...authHeader(tokens.manager))).status).toBe(403);
    expect((await request(app).post(`/api/documents/employee-documents/${hiddenDocId}/download`).set(...authHeader(tokens.manager))).status).toBe(403);
  });

  it("holding the permission isn't enough outside your data scope: TEAM scope reaches only your own team", async () => {
    await grantPermissions("MANAGER", DOC_PERMS);
    // Tokens carry permissions at login — log in again after the grant.
    const inTeam = await loginAs(people.manager.employeeCode);
    const outOfTeam = await loginAs(people.otherManager.employeeCode);
    expect((await request(app).get(`/api/documents/employees/${people.owner.employeeId}`).set(...authHeader(inTeam))).status).toBe(200);
    expect((await request(app).get(`/api/documents/employees/${people.owner.employeeId}`).set(...authHeader(outOfTeam))).status).toBe(404);
    expect((await request(app).post(`/api/documents/employee-documents/${hiddenDocId}/download`).set(...authHeader(outOfTeam))).status).toBe(404);
    // employee.documents.manage isn't manager-grantable (E2): even with the
    // row on the MANAGER role, a manager can't upload — refused outright.
    expect((await uploadFor(people.owner.employeeId, outOfTeam, { title: "x", categoryId })).status).toBe(403);
    expect((await uploadFor(people.owner.employeeId, inTeam, { title: "x", categoryId })).status).toBe(403);
    await revokePermissions("MANAGER", DOC_PERMS.filter((k) => !managerRoleHadDocPerms.includes(k)));
  });

  it("HR downloading an employee's document is audit-logged", async () => {
    const res = await request(app).post(`/api/documents/employee-documents/${hiddenDocId}/download`).set(...authHeader(tokens.hr));
    expect(res.status).toBe(200);
    const audit = await prisma.auditLog.findFirst({ where: { entityId: people.owner.employeeId, action: "employee.document.downloaded", actorUserId: people.hr.userId } });
    expect(audit?.after).toMatchObject({ documentId: hiddenDocId, title: "PAN copy" });
  });

  it("making a hidden document visible notifies the employee; archiving hides it again without deleting", async () => {
    const shown = await request(app).patch(`/api/documents/employee-documents/${hiddenDocId}`).set(...authHeader(tokens.hr)).send({ visibleToEmployee: true });
    expect(shown.status).toBe(200);
    expect(await prisma.notification.count({ where: { userId: people.owner.userId, type: "document.added" } })).toBe(2);

    expect((await request(app).post(`/api/documents/employee-documents/${hiddenDocId}/archive`).set(...authHeader(tokens.hr))).status).toBe(200);
    const mine = await request(app).get("/api/documents/me").set(...authHeader(tokens.owner));
    expect(mine.body.map((d: { id: string }) => d.id)).toEqual([visibleDocId]);
    expect(await prisma.employeeDocument.count({ where: { id: hiddenDocId } })).toBe(1);

    const hrList = await request(app).get(`/api/documents/employees/${people.owner.employeeId}`).set(...authHeader(tokens.hr));
    expect(hrList.body.find((d: { id: string }) => d.id === hiddenDocId).archivedAt).not.toBeNull();
  });
});
