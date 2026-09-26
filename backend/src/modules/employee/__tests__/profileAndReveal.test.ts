import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupFullTestEmployee,
  cleanupTestRole,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  grantPermissions,
  revokePermissions,
  loginAs,
  type TestOrgMasters,
} from "./employeeTestHelpers";

describe("Employee profile, reveal + history — scope and permission IDOR", () => {
  // resolveDataScope (lib/dataScope.ts) matches these exact literal role
  // codes to decide SELF/TEAM/ALL — a randomized TEST_* role code would
  // never match any of them and would silently fall through to SELF
  // regardless of intent (found the hard way: every one of these scope
  // tests failed until this switched from randomized codes to the real
  // ones). grantPermissions() finds-or-creates, so this is safe to run
  // against a DB that already has these roles seeded — it only adds
  // permissions/role rows, and afterAll never deletes the shared role
  // itself, only this test's own user-role links and fixture employees.
  const managerRoleCode = "MANAGER";
  const employeeRoleCode = `TEST_EMPLOYEE_${Date.now()}`; // no literal match needed — unmatched code correctly defaults to SELF
  const hrAdminRoleCode = "HR_ADMIN";
  const hrExecRoleCode = "HR_EXECUTIVE";
  let org: TestOrgMasters;
  const employeeIds: string[] = [];

  let managerId: string;
  let managerToken: string;
  let reportId: string;
  let reportToken: string;
  let strangerId: string;
  let hrAdminToken: string;
  let hrExecToken: string;

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    await Promise.all([
      grantPermissions(managerRoleCode, ["employee.view"]),
      // employee.view here is deliberate: /:id is permission-gated (matches
      // rbac.ts's "may this endpoint be called at all" vs. "which rows can
      // it see" split), so a SELF-scoped role still needs the permission to
      // exercise scope narrowing at all — otherwise every /:id call 403s
      // before scope is ever evaluated, and these tests would only be
      // proving the permission gate, not the scope logic. Real EMPLOYEE
      // accounts hold neither this permission nor call /:id in practice —
      // they use /me (covered separately below).
      grantPermissions(employeeRoleCode, ["employee.view"]),
      grantPermissions(hrAdminRoleCode, ["employee.view", "employee.bank.view", "employee.statutory.view"]),
      // Mirrors the seed's HR_EXECUTIVE: explicitly NOT given bank.view or statutory.view.
      grantPermissions(hrExecRoleCode, ["employee.view"]),
    ]);
    // Deterministic starting point regardless of what this shared literal
    // role already carried (e.g. a stale grant from an earlier local seed
    // run, before HR_EXECUTIVE's permissions were tightened) — see
    // revokePermissions' own comment.
    await revokePermissions(hrExecRoleCode, ["employee.bank.view", "employee.bank.edit", "employee.statutory.view", "employee.statutory.edit"]);

    const manager = await createFullTestEmployee(org, { roleCode: managerRoleCode });
    managerId = manager.employeeId;
    employeeIds.push(managerId);
    managerToken = await loginAs(manager.employeeCode);

    const report = await createFullTestEmployee(org, { roleCode: employeeRoleCode, managerId });
    reportId = report.employeeId;
    employeeIds.push(reportId);
    reportToken = await loginAs(report.employeeCode);

    const stranger = await createFullTestEmployee(org, { roleCode: employeeRoleCode });
    strangerId = stranger.employeeId;
    employeeIds.push(strangerId);

    const hrAdmin = await createFullTestEmployee(org, { roleCode: hrAdminRoleCode });
    employeeIds.push(hrAdmin.employeeId);
    hrAdminToken = await loginAs(hrAdmin.employeeCode);

    const hrExec = await createFullTestEmployee(org, { roleCode: hrExecRoleCode });
    employeeIds.push(hrExec.employeeId);
    hrExecToken = await loginAs(hrExec.employeeCode);
  });

  afterAll(async () => {
    // cleanupFullTestEmployee already unlinks each fixture user from its
    // role (userRole.deleteMany by userId) — only the randomized-code role
    // is safe to delete outright; MANAGER/HR_ADMIN/HR_EXECUTIVE are shared,
    // possibly-seeded roles this test only ever added permissions to.
    for (const id of employeeIds) await cleanupFullTestEmployee(id);
    await cleanupTestRole(employeeRoleCode);
    await cleanupEmployeeTestOrgMasters(org);
  });

  describe("data scope (SELF / TEAM / ALL)", () => {
    it("lets an employee view their own profile (SELF)", async () => {
      const res = await request(app).get(`/api/employees/${reportId}`).set(...authHeader(reportToken));
      expect(res.status).toBe(200);
    });

    it("404s an employee trying to view a colleague who isn't their manager (not IDOR-leaked as 403)", async () => {
      const res = await request(app).get(`/api/employees/${strangerId}`).set(...authHeader(reportToken));
      expect(res.status).toBe(404);
    });

    it("lets a manager view their direct report (TEAM)", async () => {
      const res = await request(app).get(`/api/employees/${reportId}`).set(...authHeader(managerToken));
      expect(res.status).toBe(200);
    });

    it("404s a manager trying to view someone outside their team", async () => {
      const res = await request(app).get(`/api/employees/${strangerId}`).set(...authHeader(managerToken));
      expect(res.status).toBe(404);
    });

    it("lets HR (ALL scope) view anyone", async () => {
      const res = await request(app).get(`/api/employees/${strangerId}`).set(...authHeader(hrAdminToken));
      expect(res.status).toBe(200);
    });
  });

  describe("HR_EXECUTIVE is blocked from bank and statutory endpoints", () => {
    it("omits bank and statutory sections from the profile response for HR_EXECUTIVE", async () => {
      const res = await request(app).get(`/api/employees/${strangerId}`).set(...authHeader(hrExecToken));
      expect(res.status).toBe(200);
      expect(res.body.bank).toBeUndefined();
      expect(res.body.statutory).toBeUndefined();
    });

    it("includes masked bank and statutory sections for HR_ADMIN", async () => {
      const res = await request(app).get(`/api/employees/${strangerId}`).set(...authHeader(hrAdminToken));
      expect(res.status).toBe(200);
      expect(res.body.bank).not.toBeNull();
      expect(res.body.bank.accountNumberLast4).toBeTypeOf("string");
      expect(res.body.statutory.panLast4).toBeTypeOf("string");
    });

    it("403s HR_EXECUTIVE calling the bank reveal endpoint directly", async () => {
      const res = await request(app).get(`/api/employees/${strangerId}/bank/reveal`).set(...authHeader(hrExecToken));
      expect(res.status).toBe(403);
    });

    it("403s HR_EXECUTIVE calling the statutory reveal endpoint directly", async () => {
      const res = await request(app).get(`/api/employees/${strangerId}/statutory/reveal`).set(...authHeader(hrExecToken));
      expect(res.status).toBe(403);
    });

    it("403s HR_EXECUTIVE calling the bank history endpoint directly", async () => {
      const res = await request(app).get(`/api/employees/${strangerId}/history/bank`).set(...authHeader(hrExecToken));
      expect(res.status).toBe(403);
    });

    it("allows HR_ADMIN to reveal bank and statutory details, and audit-logs each reveal", async () => {
      const bankRes = await request(app).get(`/api/employees/${strangerId}/bank/reveal`).set(...authHeader(hrAdminToken));
      expect(bankRes.status).toBe(200);
      expect(bankRes.body.accountNumber).toBeTypeOf("string");

      const statutoryRes = await request(app).get(`/api/employees/${strangerId}/statutory/reveal`).set(...authHeader(hrAdminToken));
      expect(statutoryRes.status).toBe(200);
      expect(statutoryRes.body.pan).toBeTypeOf("string");

      const { prisma } = await import("../../../lib/prisma");
      const revealedActions = await prisma.auditLog.findMany({
        where: { entityId: strangerId, action: { in: ["employee.bank.revealed", "employee.statutory.revealed"] } },
      });
      expect(revealedActions.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("View My Info always shows the caller's own masked bank/statutory, even without the view permission", () => {
    it("returns masked bank/statutory for a plain EMPLOYEE viewing their own /me", async () => {
      const res = await request(app).get("/api/employees/me").set(...authHeader(reportToken));
      expect(res.status).toBe(200);
      expect(res.body.bank).not.toBeNull();
      expect(res.body.bank.accountNumberLast4).toBeTypeOf("string");
      expect(res.body.statutory.panLast4).toBeTypeOf("string");
    });
  });

  describe("history timelines", () => {
    it("returns the job history timeline for an in-scope employee", async () => {
      const res = await request(app).get(`/api/employees/${reportId}/history/job`).set(...authHeader(managerToken));
      expect(res.status).toBe(200);
      expect(res.body.history.length).toBeGreaterThanOrEqual(1);
    });

    it("404s a job-history request for an out-of-scope employee", async () => {
      const res = await request(app).get(`/api/employees/${strangerId}/history/job`).set(...authHeader(reportToken));
      expect(res.status).toBe(404);
    });
  });
});
