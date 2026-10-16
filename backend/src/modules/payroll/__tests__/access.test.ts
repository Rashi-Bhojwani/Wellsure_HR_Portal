import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MANAGER_GRANTABLE_KEYS, PERMISSION_KEYS } from "@shared/constants/permissions";
import { GATE_KEYS } from "../../../middleware/rbac";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { ensurePayrollRules } from "../rules/governed";
import { payrollRouter } from "../routes";
import { cleanupPayrollRowsBy } from "./payrollTestHelpers";

// Who can reach payroll: nobody a manager, nobody without the keys, and the Payroll audit trail exactly as open as salary and not a hair more.

const PAYROLL_KEYS = PERMISSION_KEYS.filter((k) => k.startsWith("payroll.") || k === "reports.salary.view");

describe("payroll permissions", () => {
  it("none of them can ever be granted to a manager", () => {
    expect(PAYROLL_KEYS.length).toBeGreaterThanOrEqual(12);
    for (const k of PAYROLL_KEYS) expect(MANAGER_GRANTABLE_KEYS as readonly string[], k).not.toContain(k);
    for (const k of PERMISSION_KEYS.filter((k) => /^(bank|salary)\.|\.salary\.|\.bank\./.test(k) && !k.startsWith("employee.bank"))) expect(MANAGER_GRANTABLE_KEYS as readonly string[], k).not.toContain(k);
  });

  it("the Payroll audit trail is gated by payroll.salary.view and nothing weaker: it cannot be more open than salary", () => {
    const gates: Record<string, string[]> = {};
    for (const layer of (payrollRouter as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: object }> } }> }).stack) {
      if (!layer.route) continue;
      for (const m of Object.keys(layer.route.methods)) {
        const keys = layer.route.stack.flatMap((s) => ((s.handle as Record<symbol, string[] | undefined>)[GATE_KEYS] ?? []) as string[]);
        gates[`${m.toUpperCase()} ${layer.route.path}`] = keys;
      }
    }
    expect(gates["GET /audit"]).toEqual(["payroll.salary.view"]);
    // Every route is gated on at least one payroll key; none is open to a signed-in employee by accident.
    for (const [route, keys] of Object.entries(gates)) {
      expect(keys.length, route).toBeGreaterThan(0);
      for (const k of keys) expect(PAYROLL_KEYS, `${route} uses ${k}`).toContain(k);
    }
  });
});

describe("who actually gets in", () => {
  let org: TestOrgMasters;
  const people: Record<string, { employeeId: string; userId: string; employeeCode: string }> = {};
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    await ensurePayrollRules();
    org = await createEmployeeTestOrgMasters();
    for (const [name, roleCode] of Object.entries({
      payrollAdmin: "PAYROLL_ADMIN",
      approver: "PAYROLL_APPROVER",
      hrAdmin: "HR_ADMIN",
      hrExec: "HR_EXECUTIVE",
      manager: "MANAGER",
      employee: "EMPLOYEE",
    })) {
      people[name] = await createFullTestEmployee(org, { roleCode });
      tokens[name] = await loginAs(people[name]!.employeeCode);
    }
    // An HR Executive who has been given the audit viewer and nothing else: the side door the audit screen could have been.
    const audit = await prisma.permission.findUniqueOrThrow({ where: { key: "audit.view" } });
    await prisma.userPermissionOverride.create({ data: { userId: people.hrExec!.userId, permissionId: audit.id, effect: "GRANT", reason: "test: audit viewer only", createdByUserId: people.hrAdmin!.userId } });
    // A manager somebody tried to give payroll keys to.
    for (const key of ["payroll.rules.view", "payroll.salary.view"]) {
      const p = await prisma.permission.findUniqueOrThrow({ where: { key } });
      await prisma.userPermissionOverride.create({ data: { userId: people.manager!.userId, permissionId: p.id, effect: "GRANT", reason: "test: someone tried to grant a manager payroll", createdByUserId: people.hrAdmin!.userId } });
    }
    tokens.hrExec = await loginAs(people.hrExec!.employeeCode);
    tokens.manager = await loginAs(people.manager!.employeeCode);
    // Something payroll-ish in the audit log for the audit tests to find: a rule edit by the payroll admin.
    const preview = await request(app).post("/api/payroll/rules/FIXED_DAYS_VALUE/edit-preview").set(...authHeader(tokens.payrollAdmin!)).send({ value: 30 });
    await request(app).put("/api/payroll/rules/FIXED_DAYS_VALUE").set(...authHeader(tokens.payrollAdmin!)).send({ value: 30, fingerprint: preview.body.fingerprint });
  });

  afterAll(async () => {
    await prisma.userPermissionOverride.deleteMany({ where: { userId: { in: Object.values(people).map((p) => p.userId) } } });
    await cleanupPayrollRowsBy(Object.values(people).map((p) => p.userId));
    for (const p of Object.values(people)) await cleanupFullTestEmployee(p.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  const get = (who: string, path: string) => request(app).get(path).set(...authHeader(tokens[who]!));

  it("rules: payroll admin, approver and HR admin may look; HR executive, manager (even with a payroll key somebody granted) and employee may not", async () => {
    for (const who of ["payrollAdmin", "approver", "hrAdmin"]) expect((await get(who, "/api/payroll/rules")).status, who).toBe(200);
    for (const who of ["hrExec", "manager", "employee"]) expect((await get(who, "/api/payroll/rules")).status, who).toBe(403);
  });

  it("writing and confirming are separate: the maker cannot confirm, the checker cannot edit, HR admin can do neither", async () => {
    const edit = (who: string) => request(app).post("/api/payroll/rules/FIXED_DAYS_VALUE/edit-preview").set(...authHeader(tokens[who]!)).send({ value: 31 });
    expect((await edit("payrollAdmin")).status).toBe(200);
    expect((await edit("approver")).status).toBe(403);
    expect((await edit("hrAdmin")).status).toBe(403);
    const confirm = (who: string) => request(app).post("/api/payroll/rules/FIXED_DAYS_VALUE/confirm-preview").set(...authHeader(tokens[who]!));
    expect((await confirm("approver")).status).toBe(200);
    expect((await confirm("payrollAdmin")).status).toBe(403);
    expect((await confirm("hrAdmin")).status).toBe(403);
  });

  it("the Payroll audit trail opens for exactly the people who may see salary", async () => {
    // PAYROLL_ADMIN, PAYROLL_APPROVER and HR_ADMIN hold payroll.salary.view; HR_EXECUTIVE (even with audit.view), MANAGER and EMPLOYEE do not.
    for (const who of ["payrollAdmin", "approver", "hrAdmin"]) expect((await get(who, "/api/payroll/audit")).status, who).toBe(200);
    for (const who of ["hrExec", "manager", "employee"]) expect((await get(who, "/api/payroll/audit")).status, who).toBe(403);
    const trail = await get("payrollAdmin", "/api/payroll/audit?pageSize=200");
    expect(trail.body.rows.length).toBeGreaterThan(0);
    expect(trail.body.rows.every((r: { action: string; entityType: string }) => r.action.startsWith("payroll.") || r.entityType.startsWith("Payroll"))).toBe(true);
    expect(trail.body.rows.some((r: { action: string; entityId: string }) => r.action === "payroll.rule.edited" && r.entityId === "FIXED_DAYS_VALUE")).toBe(true);
  });

  it("the general audit log viewer is not a side door: payroll rows are hidden from anyone who cannot see salary", async () => {
    const fromHr = await get("hrAdmin", "/api/audit-logs?pageSize=200&action=payroll.");
    expect(fromHr.status).toBe(200);
    expect(fromHr.body.rows.some((r: { action: string }) => r.action === "payroll.rule.edited")).toBe(true); // HR admin may see salary, so may see payroll rows here too
    const fromExec = await get("hrExec", "/api/audit-logs?pageSize=200&action=payroll.");
    expect(fromExec.status).toBe(200); // may open the audit viewer...
    expect(fromExec.body.total).toBe(0); // ...and sees no payroll row, even when searching for exactly them
    const everything = await get("hrExec", "/api/audit-logs?pageSize=200");
    expect(everything.body.rows.some((r: { action: string; entityType: string }) => r.action.startsWith("payroll.") || r.entityType.startsWith("Payroll"))).toBe(false);
    const byEntity = await get("hrExec", "/api/audit-logs?pageSize=200&entityType=PayrollRule");
    expect(byEntity.body.total).toBe(0);
  });

  it("a manager holding payroll keys somebody granted still gets nothing: resolution strips every key that is not manager-grantable", async () => {
    for (const path of ["/api/payroll/rules", "/api/payroll/audit", "/api/payroll/approvals/checkers?subject=RUN_APPROVAL"]) expect((await get("manager", path)).status, path).toBe(403);
  });

  it("checker availability is visible to makers and checkers, and to nobody else", async () => {
    for (const who of ["payrollAdmin", "approver", "hrAdmin"]) expect((await get(who, "/api/payroll/approvals/checkers?subject=RULE_CONFIRM")).status, who).toBe(200);
    for (const who of ["hrExec", "employee"]) expect((await get(who, "/api/payroll/approvals/checkers?subject=RULE_CONFIRM")).status, who).toBe(403);
    const seen = await get("payrollAdmin", "/api/payroll/approvals/checkers?subject=RULE_CONFIRM");
    expect(seen.body.eligible.length).toBeGreaterThanOrEqual(1);
    expect(["ONE", "MANY"]).toContain(seen.body.state);
    expect((await get("payrollAdmin", "/api/payroll/approvals/checkers?subject=SOMETHING_ELSE")).status).toBe(400);
  });

  it("salary screens: people who may see salary may look, only the maker roles may prepare, only a checker may decide, and nobody else gets anything", async () => {
    const reads = ["/components", "/structures", "/salary/employees", "/salary/revisions", "/adjustments", "/salary/people?q=x"];
    for (const path of reads) {
      for (const who of ["payrollAdmin", "approver", "hrAdmin"]) expect((await get(who, `/api/payroll${path}`)).status, `${who} ${path}`).toBe(200);
      for (const who of ["hrExec", "manager", "employee"]) expect((await get(who, `/api/payroll${path}`)).status, `${who} ${path}`).toBe(403);
    }
    const post = (who: string, path: string) => request(app).post(`/api/payroll${path}`).set(...authHeader(tokens[who]!)).send({}); // an empty body: 403 is the permission, 400 is "allowed in, but not a valid request"
    for (const path of ["/salary/revisions/preview", "/adjustments/preview", "/structures/breakup-preview"]) {
      for (const who of ["payrollAdmin", "hrAdmin"]) expect((await post(who, path)).status, `${who} ${path}`).toBe(400);
      for (const who of ["approver", "hrExec", "manager", "employee"]) expect((await post(who, path)).status, `${who} ${path}`).toBe(403);
    }
    // Deciding is the checker's alone: the makers are refused even though they can prepare.
    for (const who of ["payrollAdmin", "hrAdmin", "hrExec", "manager", "employee"]) expect((await post(who, "/salary/revisions/some-id/decision")).status, who).toBe(403);
    expect((await post("approver", "/salary/revisions/some-id/decision")).status).toBe(400);
    // Confirming a component or structure is the same permission as confirming a rule.
    for (const who of ["payrollAdmin", "hrAdmin", "hrExec", "manager", "employee"]) expect((await post(who, "/components/BASIC/confirm-preview")).status, who).toBe(403);
    for (const path of ["/salary/revisions", "/components", "/adjustments"]) expect((await request(app).get(`/api/payroll${path}`)).status, path).toBe(401);
  });

  it("is unreachable without signing in", async () => {
    expect((await request(app).get("/api/payroll/rules")).status).toBe(401);
    expect((await request(app).get("/api/payroll/audit")).status).toBe(401);
  });
});
