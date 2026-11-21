import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";

// FIX-L7 (independent audit 2026-11-20, finding L7): "the Developer got 200 on /api/payslips/mine, /api/tax/me and /api/tax/me/statement, but 403 on
// /api/tax/me/ytd, /api/loans/mine and /api/reimbursements/mine." Every one of their own payroll pages now refuses the Developer with 403; an employee is unchanged.
const MINE = ["/api/payslips/mine", "/api/payslips/mine/x", "/api/payslips/mine/x/why", "/api/payslips/mine/x/pdf", "/api/tax/me", "/api/tax/me/statement", "/api/tax/me/ytd", "/api/tax/me/salary-revisions", "/api/tax/me/form16?fy=2026-27", "/api/tax/me/proofs/x/file", "/api/loans/mine", "/api/loans/mine/x", "/api/reimbursements/mine", "/api/reimbursements/mine/statement"];

describe("FIX-L7: the Developer is refused consistently on every 'mine' payroll page", () => {
  let org: TestOrgMasters;
  let dev: { employeeId: string; employeeCode: string }, emp: { employeeId: string; employeeCode: string };
  let tDev: string, tEmp: string;
  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    dev = await createFullTestEmployee(org, { roleCode: "DEVELOPER" });
    emp = await createFullTestEmployee(org);
    [tDev, tEmp] = [await loginAs(dev.employeeCode), await loginAs(emp.employeeCode)];
  });
  afterAll(async () => {
    for (const p of [dev, emp]) await cleanupFullTestEmployee(p.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("every one answers 403 to the Developer", async () => {
    for (const path of MINE) expect((await request(app).get(path).set(...authHeader(tDev))).status, path).toBe(403);
  });
  it("an employee still reaches their own (200 for the lists; a missing id is 404, not 403)", async () => {
    for (const path of ["/api/payslips/mine", "/api/tax/me", "/api/tax/me/statement", "/api/loans/mine", "/api/reimbursements/mine"]) expect((await request(app).get(path).set(...authHeader(tEmp))).status, path).not.toBe(403);
  });
});
