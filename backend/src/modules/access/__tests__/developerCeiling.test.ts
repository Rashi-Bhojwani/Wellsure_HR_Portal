import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { META_PERMISSION_KEYS, PERMISSION_CATALOG, PERMISSION_KEYS } from "@shared/constants/permissions";
import { DEVELOPER_ROLE_CODE, DEVELOPER_ROLE_PERMISSIONS, REVIEWED_NOT_SENSITIVE, SENSITIVE_CLASSES, SENSITIVE_PERMISSION_KEYS, classesOf } from "@shared/constants/sensitiveData";
import { ensureAccessCatalog } from "../../../lib/accessCatalog";
import { resolveAccess } from "../../../lib/permissions";
import { prisma } from "../../../lib/prisma";
import { SYSTEM_ROLES } from "../../../lib/systemRoles";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, cleanupTestRole, createEmployeeTestOrgMasters, createFullTestEmployee, grantPermissions, loginAs, revokePermissions, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { assignRole, setOverride, updateRole, type AccessActor } from "../service";

// The developer ceiling (docs/plans/PHASE_6.md §14J): the person who builds and runs the system holds none of the owners' secrets, whatever anyone clicks and whatever the database holds.

describe("the sensitive registry", () => {
  it("classifies every permission: sensitive, or reviewed as not sensitive, never both and never neither", () => {
    const sensitive = new Set<string>(SENSITIVE_PERMISSION_KEYS);
    const reviewed = new Set<string>(REVIEWED_NOT_SENSITIVE);
    expect(PERMISSION_KEYS.filter((k) => !sensitive.has(k) && !reviewed.has(k))).toEqual([]);
    expect(PERMISSION_KEYS.filter((k) => sensitive.has(k) && reviewed.has(k))).toEqual([]);
    expect([...reviewed].filter((k) => !(PERMISSION_KEYS as readonly string[]).includes(k))).toEqual([]);
    expect([...sensitive].filter((k) => !(PERMISSION_KEYS as readonly string[]).includes(k))).toEqual([]);
  });

  it("covers every permission that reveals salary, bank, statutory or identifier data, and every power over other people's access", () => {
    for (const k of ["payroll.salary.view", "payroll.payslip.view", "payroll.bank.view", "reports.salary.view", "documents.pay.view", "employee.bank.view", "employee.bank.edit", "employee.statutory.view", "employee.statutory.edit", "payroll.identifiers.manage", "payroll.banklayout.manage", "helpdesk.sensitive.view", "employee.documents.view"]) {
      expect(classesOf(k).length, k).toBeGreaterThan(0);
    }
    for (const k of META_PERMISSION_KEYS) expect(classesOf(k).map((c) => c.class.id), k).toContain("ACCESS_CONTROL");
    // The permissions with "Sensitive data" as their group in the catalogue are all in the registry.
    for (const k of PERMISSION_KEYS.filter((key) => PERMISSION_CATALOG[key].group === "Sensitive data")) expect(classesOf(k).length, k).toBeGreaterThan(0);
    expect(SENSITIVE_CLASSES.map((c) => c.id)).toContain("COMPANY_IDENTIFIERS");
  });

  it("the Developer role's definition holds nothing in the registry, and the system role rows say the same", () => {
    expect(DEVELOPER_ROLE_PERMISSIONS.filter((k) => (SENSITIVE_PERMISSION_KEYS as readonly string[]).includes(k))).toEqual([]);
    const def = SYSTEM_ROLES.find((r) => r.code === DEVELOPER_ROLE_CODE)!;
    expect([...def.permissions].sort()).toEqual([...DEVELOPER_ROLE_PERMISSIONS].sort());
  });

  it("no other default role gives the new secret permissions to the wrong people", () => {
    const holders = (k: string) => SYSTEM_ROLES.filter((r) => r.permissions.includes(k) && r.code !== "SUPER_ADMIN").map((r) => r.code);
    expect(holders("payroll.identifiers.manage")).toEqual(["PAYROLL_ADMIN"]);
    expect(holders("payroll.identifiers.confirm")).toEqual(["PAYROLL_APPROVER"]);
    expect(holders("payroll.banklayout.manage")).toEqual(["PAYROLL_ADMIN"]);
    expect(holders("payroll.banklayout.confirm")).toEqual(["PAYROLL_APPROVER"]);
    expect(SYSTEM_ROLES.find((r) => r.code === "HR_ADMIN")!.permissions.filter((k) => k.startsWith("payroll.identifiers") || k.startsWith("payroll.banklayout"))).toEqual([]);
  });
});

describe("the developer ceiling", () => {
  let org: TestOrgMasters;
  let sa: { employeeId: string; employeeCode: string; userId: string };
  let dev: { employeeId: string; employeeCode: string; userId: string };
  let devToken: string;
  const extra: string[] = [];
  const meta = () => ({ actorUserId: sa.userId, ipAddress: null, userAgent: null });
  const actorOf = async (): Promise<AccessActor> => {
    const a = await resolveAccess(sa.userId);
    return { userId: sa.userId, employeeId: sa.employeeId, roleCodes: a.roleCodes, permissions: a.permissions, dataScope: a.dataScope };
  };

  beforeAll(async () => {
    await ensureAccessCatalog();
    org = await createEmployeeTestOrgMasters();
    sa = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    dev = await createFullTestEmployee(org, { roleCode: DEVELOPER_ROLE_CODE });
    devToken = await loginAs(dev.employeeCode);
  });
  afterAll(async () => {
    await cleanupFullTestEmployee(dev.employeeId);
    for (const id of extra) await cleanupFullTestEmployee(id);
    await cleanupFullTestEmployee(sa.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("a developer holds what the role defines and no key in the registry", async () => {
    const a = await resolveAccess(dev.userId);
    expect(a.isSuperAdmin).toBe(false);
    expect([...a.permissions].sort()).toEqual([...DEVELOPER_ROLE_PERMISSIONS].sort());
    expect([...a.permissions].filter((k) => (SENSITIVE_PERMISSION_KEYS as readonly string[]).includes(k))).toEqual([]);
  });

  it("whatever is stored, a developer still holds none: a per-user grant, and a key put on the role by raw SQL, are both removed at resolution", async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: DEVELOPER_ROLE_CODE } });
    const keys = ["payroll.salary.view", "employee.bank.view", "payroll.identifiers.manage", "payroll.banklayout.manage", "settings.manage"];
    const perms = await prisma.permission.findMany({ where: { key: { in: keys } } });
    await prisma.userPermissionOverride.createMany({ data: perms.map((p) => ({ userId: dev.userId, permissionId: p.id, effect: "GRANT" as const, reason: "raw", createdByUserId: sa.userId })) });
    await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })), skipDuplicates: true });
    try {
      const a = await resolveAccess(dev.userId);
      for (const k of keys) expect(a.permissions.has(k), k).toBe(false);
      // And the API agrees: the developer's token is refused at the figures.
      expect((await request(app).get("/api/payroll/salary/employees").set(...authHeader(devToken))).status).toBe(403);
      expect((await request(app).get("/api/payroll/runs").set(...authHeader(devToken))).status).toBe(403);
    } finally {
      await prisma.userPermissionOverride.deleteMany({ where: { userId: dev.userId } });
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: { in: perms.map((p) => p.id) } } });
    }
  });

  it("a Super Admin cannot be made a developer, nor a developer a Super Admin; the database refuses it too", async () => {
    await expect(assignRole(sa.employeeId, DEVELOPER_ROLE_CODE, await actorOf(), meta())).rejects.toMatchObject({ code: "DEVELOPER_CEILING" });
    await expect(assignRole(dev.employeeId, "SUPER_ADMIN", await actorOf(), meta())).rejects.toMatchObject({ code: "DEVELOPER_CEILING" });
    const role = await prisma.role.findUniqueOrThrow({ where: { code: "SUPER_ADMIN" } });
    await expect(prisma.userRole.create({ data: { userId: dev.userId, roleId: role.id } })).rejects.toThrow(/DEVELOPER_NOT_SUPER_ADMIN/);
  });

  it("if both roles are somehow held (the trigger removed for a moment), the person is resolved as a developer and never as a Super Admin", async () => {
    const both = await createFullTestEmployee(org, { roleCode: DEVELOPER_ROLE_CODE });
    extra.push(both.employeeId);
    const sup = await prisma.role.findUniqueOrThrow({ where: { code: "SUPER_ADMIN" } });
    await prisma.$executeRawUnsafe('ALTER TABLE "user_roles" DISABLE TRIGGER "user_roles_developer_not_super_admin"');
    try {
      await prisma.userRole.create({ data: { userId: both.userId, roleId: sup.id } });
      const a = await resolveAccess(both.userId);
      expect(a.isSuperAdmin).toBe(false);
      expect(a.roleCodes).not.toContain("SUPER_ADMIN");
      expect([...a.permissions].filter((k) => (SENSITIVE_PERMISSION_KEYS as readonly string[]).includes(k))).toEqual([]);
      const token = await loginAs(both.employeeCode);
      expect((await request(app).get("/api/payroll/salary/employees").set(...authHeader(token))).status).toBe(403);
      expect((await request(app).get("/api/payroll/rules").set(...authHeader(token))).status).toBe(200); // statuses only: payroll.rules.view
    } finally {
      await prisma.userRole.deleteMany({ where: { userId: both.userId, roleId: sup.id } });
      await prisma.$executeRawUnsafe('ALTER TABLE "user_roles" ENABLE TRIGGER "user_roles_developer_not_super_admin"');
    }
  });

  it("nobody can give a developer a sensitive grant, a sensitive role, or put one on the Developer role", async () => {
    await expect(setOverride(dev.employeeId, "payroll.salary.view", { effect: "GRANT", reason: "please" }, await actorOf(), meta())).rejects.toMatchObject({ code: "DEVELOPER_CEILING" });
    await expect(setOverride(dev.employeeId, "settings.manage", { effect: "GRANT", reason: "please" }, await actorOf(), meta())).rejects.toMatchObject({ code: "DEVELOPER_CEILING" });
    await expect(assignRole(dev.employeeId, "HR_ADMIN", await actorOf(), meta())).rejects.toMatchObject({ code: "DEVELOPER_CEILING" });
    await expect(assignRole(dev.employeeId, "PAYROLL_ADMIN", await actorOf(), meta())).rejects.toMatchObject({ code: "DEVELOPER_CEILING" });
    await expect(updateRole(DEVELOPER_ROLE_CODE, { permissions: [...DEVELOPER_ROLE_PERMISSIONS, "employee.bank.view"] }, await actorOf(), meta())).rejects.toMatchObject({ code: "DEVELOPER_CEILING" });
    // An ordinary grant is fine: the ceiling is only about the registry.
    await grantPermissions("EMPLOYEE", []);
    await expect(setOverride(dev.employeeId, "reports.view", { effect: "GRANT", reason: "needed" }, await actorOf(), meta())).resolves.toBeDefined();
    await prisma.userPermissionOverride.deleteMany({ where: { userId: dev.userId } });
  });

  it("the developer cannot reach any secret through the API: figures, bank and statutory reveal, identifiers, layout, setup sign-off, role changes", async () => {
    const call = (method: "get" | "post" | "put" | "patch", path: string, body?: object) => request(app)[method](path).set(...authHeader(devToken)).send(body);
    for (const [m, p] of [
      ["get", "/api/payroll/salary/employees"],
      ["get", "/api/payroll/runs"],
      ["get", "/api/payroll/audit"],
      ["get", `/api/employees/${dev.employeeId}/bank`],
      ["get", `/api/employees/${dev.employeeId}/statutory/reveal`],
    ] as const) {
      expect([403, 404], `${m} ${p}`).toContain((await call(m, p)).status);
    }
    // The bank layout: the developer is told it exists and in what state, and sees nothing of it.
    const layout = await call("get", "/api/payroll/layouts/BANK_TEMPLATE");
    expect(layout.status).toBe(200);
    expect(layout.body.layout.current === null || layout.body.layout.current.value?.restricted === true).toBe(true);
    expect(JSON.stringify(layout.body)).not.toMatch(/columns|debitAccount/);
    expect((await call("post", "/api/payroll/rules/PF_ESTABLISHMENT_CODE/reveal")).status).toBe(403);
    expect((await call("put", "/api/payroll/layouts/BANK_TEMPLATE", { value: {}, fingerprint: "x".repeat(12) })).status).toBe(403);
    expect((await call("put", "/api/payroll/rules/PF_ESTABLISHMENT_CODE", { value: "X", fingerprint: "x" })).status).toBe(403);
    expect((await call("put", `/api/access/employees/${dev.employeeId}/roles/SUPER_ADMIN`)).status).toBeGreaterThanOrEqual(400);
  });
});

describe("who may approve a change to bank or statutory details, and who may import them", () => {
  const roleCode = `TEST_CEILING_HR_${Date.now()}`;
  let org: TestOrgMasters;
  let hr: { employeeId: string; employeeCode: string; userId: string };
  let emp: { employeeId: string; employeeCode: string; userId: string };
  let hrToken: string;
  let empToken: string;
  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    await grantPermissions(roleCode, ["profile.changerequest.approve", "employee.view", "import.manage"]);
    hr = await createFullTestEmployee(org, { roleCode });
    emp = await createFullTestEmployee(org, { roleCode: "EMPLOYEE" });
    hrToken = await loginAs(hr.employeeCode);
    empToken = await loginAs(emp.employeeCode);
  });
  afterAll(async () => {
    await cleanupFullTestEmployee(hr.employeeId);
    await cleanupFullTestEmployee(emp.employeeId);
    await cleanupTestRole(roleCode);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("an approver without employee.bank.edit or employee.statutory.edit cannot approve those requests, but can approve a personal-details one", async () => {
    const bank = await request(app).post("/api/employees/change-requests").set(...authHeader(empToken)).send({ fieldGroup: "bank", changes: { accountHolderName: "A B", accountNumber: "40011122233", accountNumberConfirm: "40011122233", ifsc: "ICIC0001789", bankName: "ICICI", branchName: "X" } });
    const stat = await request(app).post("/api/employees/change-requests").set(...authHeader(empToken)).send({ fieldGroup: "statutory", changes: { pan: "ABCDE1234F" } });
    const personal = await request(app).post("/api/employees/change-requests").set(...authHeader(empToken)).send({ fieldGroup: "personal", changes: { bloodGroup: "O+" } });
    expect([bank.status, stat.status, personal.status]).toEqual([201, 201, 201]);
    const decide = (id: string) => request(app).post(`/api/employees/change-requests/${id}/approve`).set(...authHeader(hrToken)).send({});
    expect((await decide(bank.body.id)).status).toBe(403);
    expect((await decide(stat.body.id)).status).toBe(403);
    expect((await decide(personal.body.id)).status).toBe(204);
    expect(await prisma.employeeBankAccount.count({ where: { employeeId: emp.employeeId } })).toBeLessThanOrEqual(1); // nothing was written by the refused approval
    await grantPermissions(roleCode, ["employee.bank.edit", "employee.statutory.edit"]);
    hrToken = await loginAs(hr.employeeCode);
    expect((await decide(bank.body.id)).status).toBe(204);
    expect((await decide(stat.body.id)).status).toBe(204);
    await revokePermissions(roleCode, ["employee.bank.edit", "employee.statutory.edit"]);
  });

  it("the statutory import is refused to someone without employee.statutory.edit, as the bank import is without employee.bank.edit", async () => {
    hrToken = await loginAs(hr.employeeCode);
    const file = Buffer.from("not read: the permission is checked first");
    for (const dataset of ["statutory", "bank"]) {
      const r = await request(app).post(`/api/import/${dataset}/upload`).set(...authHeader(hrToken)).attach("file", file, `${dataset}.xlsx`);
      expect([r.status, r.body.error?.code]).toEqual([403, "FORBIDDEN"]);
    }
  });
});
