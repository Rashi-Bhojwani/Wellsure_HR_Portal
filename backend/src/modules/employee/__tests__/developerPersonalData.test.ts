import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEVELOPER_FORBIDDEN_KEYS, DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { DEVELOPER_KEEPS_PROFILE_FIELDS, PERSONAL_CONTACT_FIELDS } from "../../../lib/personalData";
import { resolveAccess } from "../../../lib/permissions";
import { prisma } from "../../../lib/prisma";
import { getSetting, setSetting } from "../../../lib/settings";
import { SYSTEM_ROLES } from "../../../lib/systemRoles";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "./employeeTestHelpers";

// Audit fix 2026-11-18 (docs/plans/AUDIT_FIXES.md item 7): the Developer sees no personal email, phone or home address (nor the emergency contact), on the profile
// or in any list, search or export, through the same ceiling as pay, bank and identity (employee.personal.view is a sensitive class). The Developer keeps the
// employee number, name, role and status. Made-up people.
describe("the Developer sees no personal contact details", () => {
  let org: TestOrgMasters;
  const p: Record<string, { employeeId: string; employeeCode: string; userId: string }> = {};
  const t: Record<string, string> = {};
  let target: { personalEmail: string; mobile: string; currentAddress: string };
  let fieldsBefore: string[] = [];
  const get = (who: string, path: string) => request(app).get(path).set(...authHeader(t[who]!));

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    for (const [k, roleCode] of [["dev", DEVELOPER_ROLE_CODE], ["hr", "HR_ADMIN"], ["emp", undefined], ["target", undefined]] as const) {
      p[k] = await createFullTestEmployee(org, roleCode ? { roleCode } : {});
      t[k] = await loginAs(p[k]!.employeeCode);
    }
    target = (await prisma.employeePersonal.findUniqueOrThrow({ where: { employeeId: p.target!.employeeId }, select: { personalEmail: true, mobile: true, currentAddress: true } }));
    fieldsBefore = await getSetting<string[]>("people.directory.visibleFields", ["officialEmail", "reportingManager"]);
    await setSetting("people.directory.visibleFields", ["officialEmail", "reportingManager", "mobile", "personalEmail"], p.hr!.userId);
  }, 120_000);

  afterAll(async () => {
    await setSetting("people.directory.visibleFields", fieldsBefore, p.hr!.userId);
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  }, 120_000);

  it("owner decision: the four profile fields of feat/employee-number-login stay visible to the Developer (never in the withheld list)", () => {
    expect(DEVELOPER_KEEPS_PROFILE_FIELDS).toEqual(["deviceUserId", "loginIdMatchesMachine", "noEmailOnRecord", "emailMissingRequestedAt"]);
    expect(DEVELOPER_KEEPS_PROFILE_FIELDS.filter((f) => (PERSONAL_CONTACT_FIELDS as readonly string[]).includes(f))).toEqual([]);
  });

  it("the key is a sensitive class, so the Developer's ceiling removes it; every other role that sees employees keeps it", async () => {
    expect(DEVELOPER_FORBIDDEN_KEYS).toContain("employee.personal.view");
    for (const r of SYSTEM_ROLES.filter((x) => x.permissions.includes("employee.view") && x.code !== DEVELOPER_ROLE_CODE)) expect(r.permissions, r.code).toContain("employee.personal.view");
    expect((await resolveAccess(p.dev!.userId)).permissions.has("employee.personal.view")).toBe(false);
    expect((await resolveAccess(p.hr!.userId)).permissions.has("employee.personal.view")).toBe(true);
  });

  it("profile: every personal contact field is withheld from the Developer; number, name and status stay; HR still sees them", async () => {
    const dev = await get("dev", `/api/employees/${p.target!.employeeId}`);
    expect(dev.status).toBe(200);
    expect(dev.body.personalHidden).toBe(true);
    for (const f of PERSONAL_CONTACT_FIELDS) expect(dev.body.personal[f], f).toBeNull();
    expect(dev.body).toMatchObject({ employeeCode: p.target!.employeeCode, status: "ACTIVE" });
    expect(dev.body.fullName).toBeTruthy();
    expect([dev.body.personal.dateOfBirth, dev.body.personal.gender, dev.body.personal.bloodGroup]).toEqual([null, null, null]); // personal too: support needs none of them
    expect(JSON.stringify(dev.body)).not.toContain(target.personalEmail);
    expect(JSON.stringify(dev.body)).not.toContain(target.currentAddress);
    const hr = await get("hr", `/api/employees/${p.target!.employeeId}`);
    expect(hr.body.personal).toMatchObject({ personalEmail: target.personalEmail, currentAddress: target.currentAddress });
    expect(hr.body.personalHidden).toBe(false);
    expect(hr.body.personal.dateOfBirth).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("the grid: the Developer gets no personal email or mobile, and cannot find anybody by them; HR can", async () => {
    const list = await get("dev", `/api/employees?search=${encodeURIComponent(p.target!.employeeCode)}`);
    expect(list.status).toBe(200);
    const row = list.body.rows.find((r: { id: string }) => r.id === p.target!.employeeId);
    expect([row.personalEmail, row.mobile]).toEqual(["", ""]);
    expect(row.employeeCode).toBe(p.target!.employeeCode);
    const byEmail = await get("dev", `/api/employees?search=${encodeURIComponent(target.personalEmail)}`);
    expect(byEmail.body.rows.some((r: { id: string }) => r.id === p.target!.employeeId)).toBe(false);
    const hrByEmail = await get("hr", `/api/employees?search=${encodeURIComponent(target.personalEmail)}`);
    expect(hrByEmail.body.rows.find((r: { id: string }) => r.id === p.target!.employeeId)?.personalEmail).toBe(target.personalEmail);
  });

  it("the export and the contact reveal are refused to the Developer", async () => {
    expect((await get("dev", "/api/employees/export")).status).toBe(403);
    expect((await get("dev", `/api/employee-extras/${p.target!.employeeId}/contact?reason=testing`)).status).toBe(403);
  });

  it("the colleague directory: with the company toggle on, colleagues see personal email and mobile; the Developer does not", async () => {
    const dev = await get("dev", `/api/people/${p.target!.employeeId}`);
    expect(dev.status).toBe(200);
    expect(dev.body.personalEmail).toBeUndefined();
    expect(dev.body.mobile).toBeUndefined();
    expect(dev.body.birthday).toBeUndefined();
    const devList = await get("dev", "/api/people?search=" + encodeURIComponent(p.target!.employeeCode));
    const entry = (devList.body.entries ?? devList.body.items ?? devList.body).find?.((x: { id: string }) => x.id === p.target!.employeeId);
    expect(entry?.personalEmail).toBeUndefined();
    // Peeps final merge (2026-11-19, CHANGED_TESTS.md): the owners' Peeps directory decision is that a colleague never sees a personal email in the
    // directory, whatever the company toggle ("personal email never shows", PEEPS_PLAN Module 1; employees do not read each other's data). The
    // Developer half of this test is unchanged.
    const emp = await get("emp", `/api/people/${p.target!.employeeId}`);
    expect(emp.status).toBe(200);
    expect(emp.body.personalEmail).toBeUndefined();
  });

  it("the audit log hides every value from the Developer (as before)", async () => {
    const res = await get("dev", "/api/audit-logs?page=1&pageSize=5");
    expect(res.status).toBe(200);
    expect(res.body.valuesHidden).toBe(true);
  });
});
