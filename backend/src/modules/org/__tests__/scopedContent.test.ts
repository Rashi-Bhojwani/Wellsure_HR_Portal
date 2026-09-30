import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../../lib/prisma";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
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
import { cleanupTestCategories, createTestCategory } from "../../documents/__tests__/documentsTestHelpers";

// Found while building Phase 5 commit C: announcement (and now company
// document) scope FKs were ON DELETE SET NULL, and branch merge/delete only
// looked at job history — so deleting or merging away a branch silently
// turned content scoped to it into org-wide content. Now: merge carries the
// scope to the surviving branch, delete is refused, and the FK is RESTRICT.
describe("Org masters never widen scoped content", () => {
  const roleCode = `TEST_ORG_SCOPE_${Date.now()}`;
  let org: TestOrgMasters;
  let token: string;
  let actorId: string;
  let employeeId: string;
  const categoryIds: string[] = [];
  const extraLocationIds: string[] = [];
  const extraDepartmentIds: string[] = [];

  async function newLocation() {
    const suffix = randomUUID().slice(0, 8);
    const loc = await prisma.location.create({
      data: { code: `TEST-LOC-${suffix}`, name: `Scoped ${suffix}`, addressLine1: "x", city: "x", state: "x", pincode: "000000" },
    });
    extraLocationIds.push(loc.id);
    return loc.id;
  }

  async function scopedContent(where: { scopeLocationId?: string; scopeDepartmentId?: string }) {
    const today = new Date();
    const announcement = await prisma.announcement.create({
      data: { title: "Scoped", body: "b", activeFrom: today, activeTo: today, createdByUserId: actorId, ...where },
    });
    const document = await prisma.companyDocument.create({
      data: {
        title: "Scoped doc",
        categoryId: categoryIds[0]!,
        fileKey: `test/${randomUUID()}.pdf`,
        fileName: "x.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        uploadedByUserId: actorId,
        ...where,
      },
    });
    return { announcementId: announcement.id, documentId: document.id };
  }

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    await grantPermissions(roleCode, ["org.manage"]);
    const actor = await createFullTestEmployee(org, { roleCode });
    employeeId = actor.employeeId;
    actorId = actor.userId;
    token = await loginAs(actor.employeeCode);
    categoryIds.push((await createTestCategory("COMPANY")).id);
  });

  afterAll(async () => {
    await cleanupTestCategories(categoryIds);
    await deleteWithDependents("Location", extraLocationIds);
    await deleteWithDependents("Department", extraDepartmentIds);
    await cleanupFullTestEmployee(employeeId);
    await cleanupTestRole(roleCode);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("merging a branch moves announcements and company documents scoped to it onto the surviving branch", async () => {
    const source = await newLocation();
    const target = await newLocation();
    const { announcementId, documentId } = await scopedContent({ scopeLocationId: source });
    const res = await request(app).post(`/api/org/locations/${source}/merge`).set(...authHeader(token)).send({ intoLocationId: target });
    expect(res.status).toBe(204);
    expect((await prisma.announcement.findUniqueOrThrow({ where: { id: announcementId } })).scopeLocationId).toBe(target);
    expect((await prisma.companyDocument.findUniqueOrThrow({ where: { id: documentId } })).scopeLocationId).toBe(target);
    await prisma.announcement.delete({ where: { id: announcementId } });
  });

  it("deleting a branch or department with scoped content is refused (409), never silently widened", async () => {
    const loc = await newLocation();
    const scopedToLoc = await scopedContent({ scopeLocationId: loc });
    const res = await request(app).delete(`/api/org/locations/${loc}`).set(...authHeader(token));
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/1 announcement\(s\) and 1 company document\(s\)/);

    const dept = await prisma.department.create({ data: { code: `TEST-DEPT-${randomUUID().slice(0, 8)}`, name: `Scoped ${randomUUID().slice(0, 8)}` } });
    extraDepartmentIds.push(dept.id);
    const scopedToDept = await scopedContent({ scopeDepartmentId: dept.id });
    expect((await request(app).delete(`/api/org/departments/${dept.id}`).set(...authHeader(token))).status).toBe(409);

    // The database refuses too, even if a future code path forgets to check.
    await expect(prisma.location.delete({ where: { id: loc } })).rejects.toThrow();
    for (const id of [scopedToLoc.announcementId, scopedToDept.announcementId]) await prisma.announcement.delete({ where: { id } });
  });
});
