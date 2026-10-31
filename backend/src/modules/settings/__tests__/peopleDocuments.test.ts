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
  type TestOrgMasters,
} from "../../employee/__tests__/employeeTestHelpers";
import { snapshotPeopleDocumentsSettings } from "../../people/__tests__/peopleTestHelpers";
// PEEPS-BEGIN directory-contact
import { withDirectoryContactFields } from "../../peeps/__tests__/peepsTestKit";
// PEEPS-END

describe("System Settings → People & Documents (/api/settings/people-documents)", () => {
  const adminRole = `TEST_SETTINGS_PD_${Date.now()}`;
  let org: TestOrgMasters;
  let restoreSettings: () => Promise<void>;
  const employeeIds: string[] = [];
  let adminToken: string;
  let plainToken: string;
  let plainId: string;
  // PEEPS-BEGIN directory-contact
  let closeContactFields: () => Promise<void>; // contact fields also need the directors' Peeps setting; this file opens all of them
  // PEEPS-END

  beforeAll(async () => {
    restoreSettings = await snapshotPeopleDocumentsSettings();
    org = await createEmployeeTestOrgMasters();
    // PEEPS-BEGIN directory-contact
    closeContactFields = await withDirectoryContactFields(org);
    // PEEPS-END
    await grantPermissions(adminRole, ["settings.manage"]);
    const admin = await createFullTestEmployee(org, { roleCode: adminRole });
    const plain = await createFullTestEmployee(org);
    employeeIds.push(admin.employeeId, plain.employeeId);
    plainId = plain.employeeId;
    adminToken = await loginAs(admin.employeeCode);
    plainToken = await loginAs(plain.employeeCode);
  });

  afterAll(async () => {
    // PEEPS-BEGIN directory-contact
    await closeContactFields();
    // PEEPS-END
    for (const id of employeeIds) await cleanupFullTestEmployee(id);
    await cleanupTestRole(adminRole);
    await cleanupEmployeeTestOrgMasters(org);
    await restoreSettings();
  });

  it("needs settings.manage", async () => {
    expect((await request(app).get("/api/settings/people-documents").set(...authHeader(plainToken))).status).toBe(403);
    expect((await request(app).put("/api/settings/people-documents").set(...authHeader(plainToken)).send({ photoMaxUploadMb: 1 })).status).toBe(403);
  });

  it("validates against the shared catalog and the hard ceilings", async () => {
    const put = (body: object) => request(app).put("/api/settings/people-documents").set(...authHeader(adminToken)).send(body);
    expect((await put({ directoryVisibleFields: ["salary"] })).status).toBe(400);
    expect((await put({ documentAllowedMimeTypes: [] })).status).toBe(400);
    expect((await put({ documentAllowedMimeTypes: ["text/html"] })).status).toBe(400);
    expect((await put({ documentMaxUploadMb: 500 })).status).toBe(400);
  });

  it("a partial update changes only what's sent, is audit-logged, and takes effect in the directory immediately", async () => {
    const before = (await request(app).get("/api/settings/people-documents").set(...authHeader(adminToken))).body;
    const res = await request(app).put("/api/settings/people-documents").set(...authHeader(adminToken)).send({ directoryVisibleFields: ["mobile"] });
    expect(res.status).toBe(200);
    expect(res.body.directoryVisibleFields).toEqual(["mobile"]);
    expect(res.body.documentMaxUploadMb).toBe(before.documentMaxUploadMb);

    const audit = await prisma.auditLog.findFirst({ where: { entityId: "peopleDocuments", action: "settings.updated" }, orderBy: { createdAt: "desc" } });
    expect(audit?.after).toMatchObject({ directoryVisibleFields: ["mobile"] });

    const entry = await request(app).get(`/api/people/${plainId}`).set(...authHeader(plainToken));
    expect(entry.body.mobile).toBeDefined();
    expect(entry.body.officialEmail).toBeUndefined();
  });
});
