import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../../lib/prisma";
import { cleanupPayrollRowsBy } from "../../payroll/__tests__/payrollTestHelpers";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, cleanupTestRole, createEmployeeTestOrgMasters, createFullTestEmployee, grantPermissions, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { snapshotPeopleDocumentsSettings } from "../../people/__tests__/peopleTestHelpers";

// A System Settings change made by a director tells the other director (docs/plans/DIRECTOR_AUTHORITY.md Q-DA-10): the area, never the value. A change by anyone else tells nobody.

describe("System Settings changes by a director tell the other director", () => {
  const adminRole = `TEST_SETTINGS_NOTICE_${Date.now()}`;
  let org: TestOrgMasters;
  let restoreSettings: () => Promise<void>;
  let a: { employeeId: string; userId: string; employeeCode: string };
  let b: { employeeId: string; userId: string; employeeCode: string };
  let admin: { employeeId: string; userId: string; employeeCode: string };

  beforeAll(async () => {
    restoreSettings = await snapshotPeopleDocumentsSettings();
    org = await createEmployeeTestOrgMasters();
    await grantPermissions(adminRole, ["settings.manage"]);
    a = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    b = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    admin = await createFullTestEmployee(org, { roleCode: adminRole });
  });
  afterAll(async () => {
    await cleanupPayrollRowsBy([a.userId, b.userId, admin.userId]);
    for (const p of [admin, b, a]) await cleanupFullTestEmployee(p.employeeId);
    await cleanupTestRole(adminRole);
    await cleanupEmployeeTestOrgMasters(org);
    await restoreSettings();
  });

  const put = (token: string) => request(app).put("/api/settings/people-documents").set(...authHeader(token)).send({ directoryVisibleFields: ["mobile"] });

  it("a director's change is audited and the other director gets a notice that names the area and no value", async () => {
    const res = await put(await loginAs(a.employeeCode));
    expect(res.status).toBe(200);
    const notice = await prisma.directorActionNotice.findFirstOrThrow({ where: { step: "SETTINGS", actorUserId: a.userId }, include: { receipts: true } });
    expect([notice.subjectType, notice.subjectId]).toEqual(["SYSTEM_SETTING", "peopleDocuments"]);
    expect(notice.receipts.map((r) => r.recipientUserId)).toContain(b.userId);
    expect(notice.receipts.map((r) => r.recipientUserId)).not.toContain(a.userId);
    expect(JSON.stringify(notice)).not.toContain("mobile");
  });

  it("someone with settings.manage who is not a director changes it without a notice", async () => {
    const res = await put(await loginAs(admin.employeeCode));
    expect(res.status).toBe(200);
    expect(await prisma.directorActionNotice.count({ where: { step: "SETTINGS", actorUserId: admin.userId } })).toBe(0);
  });
});
