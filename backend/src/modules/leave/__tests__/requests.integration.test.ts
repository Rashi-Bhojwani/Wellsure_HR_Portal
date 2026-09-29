import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupLoginableTestEmployee, createEmployeeTestOrgMasters, createLoginableTestEmployee, loginAs, type TestOrgMasters } from "./leaveTestHelpers";
import { writeLedgerEntry } from "../ledger";

describe("Leave requests — apply/approve/reject/cancel/bulk-approve (integration)", () => {
  let org: TestOrgMasters;
  let managerId: string;
  let managerUserId: string;
  let managerToken: string;
  let employeeId: string;
  let employeeUserId: string;
  let employeeToken: string;
  let plTypeId: string;
  const employeeIds: string[] = [];

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    const manager = await createLoginableTestEmployee(org, { roleCode: "MANAGER" });
    managerId = manager.employeeId;
    managerUserId = manager.userId;
    employeeIds.push(managerId);
    managerToken = await loginAs(manager.employeeCode);

    const employee = await createLoginableTestEmployee(org, { roleCode: "EMPLOYEE", managerId });
    employeeId = employee.employeeId;
    employeeUserId = employee.userId;
    employeeIds.push(employeeId);
    employeeToken = await loginAs(employee.employeeCode);

    const plType = await prisma.leaveType.findUniqueOrThrow({ where: { code: "PL" } });
    plTypeId = plType.id;

    // A starting PL balance to apply against — dated well before any test's
    // leave dates so it's always inside the entryDate <= asOfDate window.
    await writeLedgerEntry(prisma, { employeeId, leaveTypeId: plTypeId, leaveYear: 2026, entryDate: new Date("2026-01-01"), entryType: "ACCRUAL", days: 10 });
  });

  afterAll(async () => {
    // Reverse creation order: the employee's own EmployeeJobHistory row
    // (deleted as part of its cleanup) is what references the manager via
    // reportingManagerId — deleting the manager's Employee row first would
    // violate that FK while the report's job history still points to it.
    for (const id of [...employeeIds].reverse()) await cleanupLoginableTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  let requestId: string;

  // 10 Aug 2026 is a Monday, 11 Aug a Tuesday — both weekdays, so this is
  // exactly 2 days with no week-off exclusion to account for.
  it("employee applies for PL leave", async () => {
    const res = await request(app)
      .post("/api/leave/requests")
      .set(...authHeader(employeeToken))
      .send({ leaveTypeId: plTypeId, fromDate: "2026-08-10", toDate: "2026-08-11", fromDayPart: "FULL", toDayPart: "FULL" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("PENDING");
    expect(res.body.totalDays).toBe(2);
    requestId = res.body.id as string;
  });

  it("applying for leave persists a Notification for the manager (spec §8)", async () => {
    const notification = await prisma.notification.findFirstOrThrow({
      where: { userId: managerUserId, type: "leave.applied" },
      orderBy: { createdAt: "desc" },
    });
    expect(notification.title).toBe("New leave request");
    expect(notification.readAt).toBeNull();
    expect(notification.link).toBe("/admin/workforce/leave/employee-leave");
  });

  it("employee cannot approve their own request", async () => {
    const res = await request(app)
      .post(`/api/leave/requests/${requestId}/approve`)
      .set(...authHeader(employeeToken))
      .send({});
    expect(res.status).toBe(403);
  });

  it("manager approves the request; the ledger reflects the consumption", async () => {
    const res = await request(app)
      .post(`/api/leave/requests/${requestId}/approve`)
      .set(...authHeader(managerToken))
      .send({ comments: "Approved" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("APPROVED");

    const balanceRes = await request(app).get("/api/leave/balances").set(...authHeader(employeeToken));
    const plBalance = balanceRes.body.balances.find((b: { leaveTypeId: string }) => b.leaveTypeId === plTypeId);
    expect(plBalance.balance).toBe(8); // 10 - 2
  });

  it("approving persists a Notification for the applicant, distinct from the applied one (spec §8)", async () => {
    const notification = await prisma.notification.findFirstOrThrow({
      where: { userId: employeeUserId, type: "leave.decided" },
      orderBy: { createdAt: "desc" },
    });
    expect(notification.title).toBe("Leave approved");
    expect((notification.payload as { status: string }).status).toBe("APPROVED");
  });

  it("cannot approve an already-decided request again", async () => {
    const res = await request(app)
      .post(`/api/leave/requests/${requestId}/approve`)
      .set(...authHeader(managerToken))
      .send({});
    expect(res.status).toBe(409);
  });

  it("employee cancels their own approved leave; a reversal restores the balance", async () => {
    const res = await request(app)
      .post(`/api/leave/requests/${requestId}/cancel`)
      .set(...authHeader(employeeToken))
      .send({ reason: "Plans changed" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CANCELLED");

    const balanceRes = await request(app).get("/api/leave/balances").set(...authHeader(employeeToken));
    const plBalance = balanceRes.body.balances.find((b: { leaveTypeId: string }) => b.leaveTypeId === plTypeId);
    expect(plBalance.balance).toBe(10); // fully restored
  });

  it("reject requires non-empty comments and moves status to REJECTED", async () => {
    const applyRes = await request(app)
      .post("/api/leave/requests")
      .set(...authHeader(employeeToken))
      .send({ leaveTypeId: plTypeId, fromDate: "2026-09-01", toDate: "2026-09-01", fromDayPart: "FULL", toDayPart: "FULL" }); // Tue
    const id = applyRes.body.id as string;

    const rejectNoComments = await request(app)
      .post(`/api/leave/requests/${id}/reject`)
      .set(...authHeader(managerToken))
      .send({});
    expect(rejectNoComments.status).toBe(400);

    const rejectRes = await request(app)
      .post(`/api/leave/requests/${id}/reject`)
      .set(...authHeader(managerToken))
      .send({ comments: "Not enough coverage" });
    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.status).toBe("REJECTED");

    const notification = await prisma.notification.findFirstOrThrow({
      where: { userId: employeeUserId, type: "leave.decided", title: "Leave rejected" },
      orderBy: { createdAt: "desc" },
    });
    expect((notification.payload as { leaveRequestId: string; status: string }).status).toBe("REJECTED");
    expect((notification.payload as { leaveRequestId: string }).leaveRequestId).toBe(id);
  });

  it("bulk-approve reports per-id success/failure for a mix of valid and invalid ids", async () => {
    // 10 Sep 2026 (Thu) and 14 Sep 2026 (Mon) — both weekdays.
    const apply1 = await request(app)
      .post("/api/leave/requests")
      .set(...authHeader(employeeToken))
      .send({ leaveTypeId: plTypeId, fromDate: "2026-09-10", toDate: "2026-09-10", fromDayPart: "FULL", toDayPart: "FULL" });
    const apply2 = await request(app)
      .post("/api/leave/requests")
      .set(...authHeader(employeeToken))
      .send({ leaveTypeId: plTypeId, fromDate: "2026-09-14", toDate: "2026-09-14", fromDayPart: "FULL", toDayPart: "FULL" });

    const res = await request(app)
      .post("/api/leave/requests/bulk-approve")
      .set(...authHeader(managerToken))
      .send({ ids: [apply1.body.id, apply2.body.id, randomUUID()] });
    expect(res.status).toBe(200);
    const results = res.body.results as Array<{ id: string; status: string }>;
    expect(results.filter((r) => r.status === "approved")).toHaveLength(2);
    expect(results.filter((r) => r.status === "failed")).toHaveLength(1);
  });

  it("an overlapping request is rejected with 409", async () => {
    // 5-7 Oct 2026 (Mon-Wed).
    const first = await request(app)
      .post("/api/leave/requests")
      .set(...authHeader(employeeToken))
      .send({ leaveTypeId: plTypeId, fromDate: "2026-10-05", toDate: "2026-10-07", fromDayPart: "FULL", toDayPart: "FULL" });
    expect(first.status).toBe(201);

    const overlapping = await request(app)
      .post("/api/leave/requests")
      .set(...authHeader(employeeToken))
      .send({ leaveTypeId: plTypeId, fromDate: "2026-10-06", toDate: "2026-10-08", fromDayPart: "FULL", toDayPart: "FULL" });
    expect(overlapping.status).toBe(409);
  });

  it("LOP always succeeds regardless of balance", async () => {
    const lopType = await prisma.leaveType.findUniqueOrThrow({ where: { code: "LOP" } });
    // 2-3 Nov 2026 (Mon-Tue).
    const res = await request(app)
      .post("/api/leave/requests")
      .set(...authHeader(employeeToken))
      .send({ leaveTypeId: lopType.id, fromDate: "2026-11-02", toDate: "2026-11-03", fromDayPart: "FULL", toDayPart: "FULL" });
    expect(res.status).toBe(201);
  });

  it("half-day arithmetic is reflected in the stored totalDays", async () => {
    // 16-18 Nov 2026 (Mon-Wed), half day on the first.
    const res = await request(app)
      .post("/api/leave/requests")
      .set(...authHeader(employeeToken))
      .send({ leaveTypeId: plTypeId, fromDate: "2026-11-16", toDate: "2026-11-18", fromDayPart: "FIRST_HALF", toDayPart: "FULL" });
    expect(res.status).toBe(201);
    expect(res.body.totalDays).toBe(2.5);
  });
});
