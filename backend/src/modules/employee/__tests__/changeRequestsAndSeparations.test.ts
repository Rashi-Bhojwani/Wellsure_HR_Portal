import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import { processScheduledSeparations } from "../separations";
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
} from "./employeeTestHelpers";

describe("Profile change requests", () => {
  const hrRoleCode = `TEST_HR_APPROVE_${Date.now()}`;
  const employeeRoleCode = `TEST_EMP_CR_${Date.now()}`;
  let org: TestOrgMasters;
  let hrToken: string;
  let employeeId: string;
  let employeeToken: string;
  const employeeIds: string[] = [];

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    await grantPermissions(hrRoleCode, ["profile.changerequest.approve", "employee.view"]);
    await grantPermissions(employeeRoleCode, []);

    const hr = await createFullTestEmployee(org, { roleCode: hrRoleCode });
    employeeIds.push(hr.employeeId);
    hrToken = await loginAs(hr.employeeCode);

    const emp = await createFullTestEmployee(org, { roleCode: employeeRoleCode });
    employeeId = emp.employeeId;
    employeeIds.push(employeeId);
    employeeToken = await loginAs(emp.employeeCode);
  });

  afterAll(async () => {
    for (const id of employeeIds) await cleanupFullTestEmployee(id);
    await cleanupTestRole(hrRoleCode);
    await cleanupTestRole(employeeRoleCode);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("lets an employee submit a personal-field change request, invisible to other employees but visible to HR", async () => {
    const res = await request(app)
      .post("/api/employees/change-requests")
      .set(...authHeader(employeeToken))
      .send({ fieldGroup: "personal", changes: { mobile: "9123456780" } });
    expect(res.status).toBe(201);

    const mine = await request(app).get("/api/employees/change-requests").set(...authHeader(employeeToken));
    expect(mine.body.requests.some((r: { id: string }) => r.id === res.body.id)).toBe(true);

    const hrView = await request(app).get("/api/employees/change-requests").set(...authHeader(hrToken));
    expect(hrView.body.requests.some((r: { id: string }) => r.id === res.body.id)).toBe(true);
  });

  it("approving a bank change request applies it as a new effective-dated bank row, never storing the raw account number in changesJson", async () => {
    const submit = await request(app)
      .post("/api/employees/change-requests")
      .set(...authHeader(employeeToken))
      .send({
        fieldGroup: "bank",
        changes: { accountHolderName: "Self Employee", accountNumber: "70011122233", accountNumberConfirm: "70011122233", ifsc: "ICIC0001789", bankName: "ICICI Bank", branchName: "Branch A" },
      });
    expect(submit.status).toBe(201);

    const stored = await prisma.profileChangeRequest.findUnique({ where: { id: submit.body.id } });
    expect(JSON.stringify(stored?.changesJson)).not.toContain("70011122233");

    const approve = await request(app)
      .post(`/api/employees/change-requests/${submit.body.id}/approve`)
      .set(...authHeader(hrToken))
      .send({ remarks: "Verified with employee" });
    expect(approve.status).toBe(204);

    const openBank = await prisma.employeeBankAccount.findFirst({ where: { employeeId, effectiveTo: null } });
    expect(openBank?.accountNumberLast4).toBe("2233");

    const decided = await prisma.profileChangeRequest.findUnique({ where: { id: submit.body.id } });
    expect(decided?.status).toBe("APPROVED");
  });

  it("rejecting a change request leaves the underlying record untouched", async () => {
    const before = await prisma.employeePersonal.findUnique({ where: { employeeId } });
    const submit = await request(app)
      .post("/api/employees/change-requests")
      .set(...authHeader(employeeToken))
      .send({ fieldGroup: "personal", changes: { bloodGroup: "AB+" } });

    const reject = await request(app)
      .post(`/api/employees/change-requests/${submit.body.id}/reject`)
      .set(...authHeader(hrToken))
      .send({ remarks: "Please attach proof" });
    expect(reject.status).toBe(204);

    const after = await prisma.employeePersonal.findUnique({ where: { employeeId } });
    expect(after?.bloodGroup).toBe(before?.bloodGroup);
  });

  it("blocks a plain employee from approving their own change request", async () => {
    const submit = await request(app)
      .post("/api/employees/change-requests")
      .set(...authHeader(employeeToken))
      .send({ fieldGroup: "personal", changes: { bloodGroup: "O+" } });

    const res = await request(app)
      .post(`/api/employees/change-requests/${submit.body.id}/approve`)
      .set(...authHeader(employeeToken))
      .send({});
    expect(res.status).toBe(403);
  });
});

describe("Separations — initiate, cancel, scheduled deactivation", () => {
  const hrRoleCode = `TEST_HR_SEPARATE_${Date.now()}`;
  let org: TestOrgMasters;
  let hrToken: string;
  const employeeIds: string[] = [];

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    await grantPermissions(hrRoleCode, ["employee.separate", "employee.separate.view"]);
    const hr = await createFullTestEmployee(org, { roleCode: hrRoleCode });
    employeeIds.push(hr.employeeId);
    hrToken = await loginAs(hr.employeeCode);
  });

  afterAll(async () => {
    for (const id of employeeIds) await cleanupFullTestEmployee(id);
    await cleanupTestRole(hrRoleCode);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("initiates a separation, does not deactivate immediately, and can be cancelled", async () => {
    const target = await createFullTestEmployee(org);
    employeeIds.push(target.employeeId);

    const initiate = await request(app)
      .post(`/api/employees/${target.employeeId}/separations`)
      .set(...authHeader(hrToken))
      .send({ lastWorkingDate: "2099-01-31", reason: "Resignation" });
    expect(initiate.status).toBe(201);

    const stillActive = await prisma.employee.findUnique({ where: { id: target.employeeId } });
    expect(stillActive?.status).toBe("ACTIVE");

    const cancel = await request(app)
      .post(`/api/employees/separations/${initiate.body.id}/cancel`)
      .set(...authHeader(hrToken));
    expect(cancel.status).toBe(204);

    const cancelled = await prisma.separation.findUnique({ where: { id: initiate.body.id } });
    expect(cancelled?.status).toBe("CANCELLED");
    const employeeAfterCancel = await prisma.employee.findUnique({ where: { id: target.employeeId } });
    expect(employeeAfterCancel?.lastWorkingDate).toBeNull();
  });

  it("processScheduledSeparations completes a separation whose last working date has passed: deactivates login, closes job history, frees the device ID", async () => {
    const target = await createFullTestEmployee(org);
    employeeIds.push(target.employeeId);

    const initiate = await request(app)
      .post(`/api/employees/${target.employeeId}/separations`)
      .set(...authHeader(hrToken))
      .send({ lastWorkingDate: "2020-01-01", reason: "Resignation" }); // before they joined (2024-01-01)
    expect(initiate.status).toBe(400); // EF1: history can't end before it starts
    const ok = await request(app)
      .post(`/api/employees/${target.employeeId}/separations`)
      .set(...authHeader(hrToken))
      .send({ lastWorkingDate: "2025-01-15", reason: "Resignation" }); // safely in the past
    expect(ok.status).toBe(201);

    const { processed } = await processScheduledSeparations();
    expect(processed).toBeGreaterThanOrEqual(1);

    const employee = await prisma.employee.findUnique({ where: { id: target.employeeId } });
    expect(employee?.status).toBe("SEPARATED");
    const user = await prisma.user.findUnique({ where: { employeeId: target.employeeId } });
    expect(user?.status).toBe("DEACTIVATED");
    const openJob = await prisma.employeeJobHistory.findFirst({ where: { employeeId: target.employeeId, effectiveTo: null } });
    expect(openJob).toBeNull();
    const openMapping = await prisma.deviceUserMapping.findFirst({ where: { employeeId: target.employeeId, validTo: null } });
    expect(openMapping).toBeNull();
    // EF1: both end the day AFTER the last working day, so they're in force on it.
    const job = await prisma.employeeJobHistory.findFirstOrThrow({ where: { employeeId: target.employeeId }, orderBy: { effectiveFrom: "desc" } });
    expect(job.effectiveTo?.toISOString().slice(0, 10)).toBe("2025-01-16");
    const mapping = await prisma.deviceUserMapping.findFirstOrThrow({ where: { employeeId: target.employeeId } });
    expect(mapping.validTo?.toISOString().slice(0, 10)).toBe("2025-01-16");
    const separation = await prisma.separation.findUnique({ where: { id: ok.body.id } });
    expect(separation?.status).toBe("COMPLETED");
  });

  it("blocks a deactivated (separated) employee from logging in", async () => {
    const target = await createFullTestEmployee(org);
    employeeIds.push(target.employeeId);
    await request(app)
      .post(`/api/employees/${target.employeeId}/separations`)
      .set(...authHeader(hrToken))
      .send({ lastWorkingDate: "2025-01-15", reason: "Resignation" });
    await processScheduledSeparations();

    const loginRes = await request(app).post("/api/auth/login").send({ employeeCode: target.employeeCode, password: "TestPass1234" });
    expect(loginRes.status).toBe(401);
  });
});
