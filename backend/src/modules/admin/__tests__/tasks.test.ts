import { afterAll, describe, expect, it } from "vitest";
import { grantManager, LEGACY_MANAGER_GRANTS } from "../../../lib/__tests__/testHelpers";
import request from "supertest";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupLoginableTestEmployee,
  createEmployeeTestOrgMasters,
  createLoginableTestEmployee,
  loginAs,
  type TestOrgMasters,
} from "../../leave/__tests__/leaveTestHelpers";
import { prisma } from "../../../lib/prisma";
import { cleanupTestRole, grantPermissions } from "../../employee/__tests__/employeeTestHelpers";

const VIEW_ALL_ROLE = "TEST_VIEW_ALL_NO_APPROVE";
import { writeLedgerEntry } from "../../leave/ledger";
import { getRegularizationRequestSink, setRegularizationRequestSink, type RegularizationRequestSink } from "../regularizationIntegration";

// Admin Homepage "My Tasks" (spec §7.1) — review (pending within the
// caller's own approval scope) vs monitor (org-wide pending elsewhere,
// ALL-scope viewers only), plus the RegularizationRequestSink seam.
describe("GET /api/admin/tasks/counts", () => {
  let org: TestOrgMasters;
  let managerId: string;
  let managerToken: string;
  let employeeId: string;
  let employeeToken: string;
  let hrAdminToken: string;
  let payrollAdminToken: string;
  let plTypeId: string;
  const employeeIds: string[] = [];
  const requestIds: string[] = [];
  const originalSink = getRegularizationRequestSink();

  afterAll(async () => {
    // (the view-only role is removed after its holder, below)
    // Later tests in this file depend on the pending request the first
    // test creates staying PENDING throughout — deleted only at the very
    // end, not between tests (an afterEach here would wipe it right after
    // the first `it`, leaving every later "monitor" assertion looking at
    // zero pending requests).
    await prisma.leaveRequest.deleteMany({ where: { id: { in: requestIds } } });
    for (const id of [...employeeIds].reverse()) await cleanupLoginableTestEmployee(id);
    await cleanupTestRole(VIEW_ALL_ROLE);
    await cleanupEmployeeTestOrgMasters(org);
    setRegularizationRequestSink(originalSink);
  });

  it("counts a pending request in the manager's own review total, not their monitor total", async () => {
    org = await createEmployeeTestOrgMasters();
    const manager = await createLoginableTestEmployee(org, { roleCode: "MANAGER" });
    await grantManager(manager.userId, LEGACY_MANAGER_GRANTS); // a manager has no powers until Admin grants them (2026-10-03)
    managerId = manager.employeeId;
    employeeIds.push(managerId);
    managerToken = await loginAs(manager.employeeCode);

    const employee = await createLoginableTestEmployee(org, { roleCode: "EMPLOYEE", managerId });
    employeeId = employee.employeeId;
    employeeIds.push(employeeId);
    employeeToken = await loginAs(employee.employeeCode);

    const hrAdmin = await createLoginableTestEmployee(org, { roleCode: "HR_ADMIN" });
    employeeIds.push(hrAdmin.employeeId);
    hrAdminToken = await loginAs(hrAdmin.employeeCode);

    // A viewer with leave.view + ALL scope but NOT leave.approve — unlike HR_ADMIN,
    // its own "review" query (canApprove gated) never runs, so the org-wide pending
    // count shows up entirely under "monitor" instead of being absorbed into
    // "review" first. (It used to be PAYROLL_ADMIN; the payroll roles are for
    // directors only now, so this is a role made for the test.)
    await grantPermissions(VIEW_ALL_ROLE, ["leave.view"]);
    await prisma.role.update({ where: { code: VIEW_ALL_ROLE }, data: { dataScope: "ALL" } });
    const payrollAdmin = await createLoginableTestEmployee(org, { roleCode: VIEW_ALL_ROLE });
    employeeIds.push(payrollAdmin.employeeId);
    payrollAdminToken = await loginAs(payrollAdmin.employeeCode);

    const plType = await prisma.leaveType.findUniqueOrThrow({ where: { code: "PL" } });
    plTypeId = plType.id;
    await writeLedgerEntry(prisma, { employeeId, leaveTypeId: plTypeId, leaveYear: 2026, entryDate: new Date("2026-01-01"), entryType: "ACCRUAL", days: 10 });

    // 24-25 Aug 2026 — Mon/Tue, no week-off exclusion to account for.
    const applyRes = await request(app)
      .post("/api/leave/requests")
      .set(...authHeader(employeeToken))
      .send({ leaveTypeId: plTypeId, fromDate: "2026-08-24", toDate: "2026-08-25", fromDayPart: "FULL", toDayPart: "FULL" });
    expect(applyRes.status).toBe(201);
    requestIds.push(applyRes.body.id);

    const managerRes = await request(app).get("/api/admin/tasks/counts").set(...authHeader(managerToken));
    expect(managerRes.status).toBe(200);
    expect(managerRes.body.review.total).toBeGreaterThanOrEqual(1);
    expect(managerRes.body.review.byType.find((t: { type: string }) => t.type === "LEAVE").count).toBeGreaterThanOrEqual(1);
  });

  it("a plain employee with neither leave.approve nor leave.view sees zero review and zero monitor", async () => {
    const res = await request(app).get("/api/admin/tasks/counts").set(...authHeader(employeeToken));
    expect(res.status).toBe(200);
    expect(res.body.review.total).toBe(0);
    expect(res.body.monitor.total).toBe(0);
  });

  it("an ALL-scope, leave.view-only viewer (no leave.approve) sees the org-wide pending count under monitor, not review", async () => {
    const res = await request(app).get("/api/admin/tasks/counts").set(...authHeader(payrollAdminToken));
    expect(res.status).toBe(200);
    expect(res.body.review.total).toBe(0); // this viewer has no leave.approve at all
    expect(res.body.monitor.total).toBeGreaterThanOrEqual(1);
    expect(res.body.monitor.byType.find((t: { type: string }) => t.type === "LEAVE").count).toBeGreaterThanOrEqual(1);
  });

  it("an ALL-scope HR_ADMIN's own review query already sees every org-wide pending request, leaving nothing extra for monitor", async () => {
    // HR_ADMIN has both leave.approve and ALL scope, so its own
    // listLeaveRequests({status: PENDING}) call — the exact query "review"
    // reuses — already returns every pending request org-wide, not just
    // ones it's the nominal approver for. Monitor is "the rest beyond
    // review", so it nets to 0 here — that's correct, not a gap.
    const res = await request(app).get("/api/admin/tasks/counts").set(...authHeader(hrAdminToken));
    expect(res.status).toBe(200);
    expect(res.body.review.total).toBeGreaterThanOrEqual(1);
    expect(res.body.monitor.total).toBe(0);
  });

  it("defaults to the no-op RegularizationRequestSink, contributing zero to both totals", async () => {
    const res = await request(app).get("/api/admin/tasks/counts").set(...authHeader(hrAdminToken));
    expect(res.body.review.byType.some((t: { type: string }) => t.type === "REGULARIZATION")).toBe(false);
    expect(res.body.monitor.byType.some((t: { type: string }) => t.type === "REGULARIZATION")).toBe(false);
  });

  it("surfaces a non-zero RegularizationRequestSink's counts under the REGULARIZATION type", async () => {
    const fakeSink: RegularizationRequestSink = {
      async getPendingCounts() {
        return { review: 3, monitor: 7 };
      },
    };
    setRegularizationRequestSink(fakeSink);
    try {
      const res = await request(app).get("/api/admin/tasks/counts").set(...authHeader(hrAdminToken));
      const reviewRow = res.body.review.byType.find((t: { type: string }) => t.type === "REGULARIZATION");
      const monitorRow = res.body.monitor.byType.find((t: { type: string }) => t.type === "REGULARIZATION");
      expect(reviewRow?.count).toBe(3);
      expect(monitorRow?.count).toBe(7);
      expect(res.body.review.total).toBeGreaterThanOrEqual(3);
      expect(res.body.monitor.total).toBeGreaterThanOrEqual(7);
    } finally {
      setRegularizationRequestSink(originalSink);
    }
  });

  it("rejects an unauthenticated request", async () => {
    const res = await request(app).get("/api/admin/tasks/counts");
    expect(res.status).toBe(401);
  });
});
