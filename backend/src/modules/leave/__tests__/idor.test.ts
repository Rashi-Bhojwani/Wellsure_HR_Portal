import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupLoginableTestEmployee, createEmployeeTestOrgMasters, createLoginableTestEmployee, loginAs, type TestOrgMasters } from "./leaveTestHelpers";
import { writeLedgerEntry } from "../ledger";

// SELF/TEAM/ALL enforcement on the leave endpoints — the same IDOR class
// commit C's employee module tests caught for /employees/:id, now proven
// for leave requests/balances. "Out of scope" always reads as 404 (never
// confirming another employee's id exists to a caller who can't see
// them); "no leave.view/leave.approve at all" reads as 403 (a distinct,
// permission-level gate on top of scope — see requests.ts).
describe("Leave — SELF/TEAM/ALL scope and IDOR", () => {
  let org: TestOrgMasters;
  let manager1Id: string;
  let manager1Token: string;
  let manager2Token: string;
  let report1Id: string;
  let report1Token: string;
  let strangerToken: string;
  let hrAdminToken: string;
  let plTypeId: string;
  const employeeIds: string[] = [];

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();

    const manager1 = await createLoginableTestEmployee(org, { roleCode: "MANAGER" });
    manager1Id = manager1.employeeId;
    employeeIds.push(manager1Id);
    manager1Token = await loginAs(manager1.employeeCode);

    const manager2 = await createLoginableTestEmployee(org, { roleCode: "MANAGER" });
    employeeIds.push(manager2.employeeId);
    manager2Token = await loginAs(manager2.employeeCode);

    const report1 = await createLoginableTestEmployee(org, { roleCode: "EMPLOYEE", managerId: manager1Id });
    report1Id = report1.employeeId;
    employeeIds.push(report1Id);
    report1Token = await loginAs(report1.employeeCode);

    const stranger = await createLoginableTestEmployee(org, { roleCode: "EMPLOYEE" });
    employeeIds.push(stranger.employeeId);
    strangerToken = await loginAs(stranger.employeeCode);

    const hrAdmin = await createLoginableTestEmployee(org, { roleCode: "HR_ADMIN" });
    employeeIds.push(hrAdmin.employeeId);
    hrAdminToken = await loginAs(hrAdmin.employeeCode);

    const plType = await prisma.leaveType.findUniqueOrThrow({ where: { code: "PL" } });
    plTypeId = plType.id;

    // A starting balance — every apply call below needs one to succeed.
    await writeLedgerEntry(prisma, { employeeId: report1Id, leaveTypeId: plTypeId, leaveYear: 2026, entryDate: new Date("2026-01-01"), entryType: "ACCRUAL", days: 10 });
  });

  afterAll(async () => {
    // Reverse creation order — see requests.integration.test.ts's cleanup
    // comment: the reportingManagerId FK requires reports to be cleaned up
    // before the manager they reference.
    for (const id of [...employeeIds].reverse()) await cleanupLoginableTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  let report1RequestId: string;
  beforeAll(async () => {
    const res = await request(app)
      .post("/api/leave/requests")
      .set(...authHeader(report1Token))
      .send({ leaveTypeId: plTypeId, fromDate: "2026-12-01", toDate: "2026-12-01", fromDayPart: "FULL", toDayPart: "FULL" }); // Tue
    if (res.status !== 201) throw new Error(`Test setup failed: applying for report1's leave returned ${res.status}: ${JSON.stringify(res.body)}`);
    report1RequestId = res.body.id as string;
  });

  describe("GET /api/leave/requests?employeeId=", () => {
    it("a plain employee (no leave.view) gets 403 requesting someone else's", async () => {
      const res = await request(app)
        .get("/api/leave/requests")
        .query({ employeeId: report1Id })
        .set(...authHeader(strangerToken));
      expect(res.status).toBe(403);
    });

    it("an unrelated manager (has leave.view, but report1 isn't on their team) gets 404, not their data", async () => {
      const res = await request(app)
        .get("/api/leave/requests")
        .query({ employeeId: report1Id })
        .set(...authHeader(manager2Token));
      expect(res.status).toBe(404);
    });

    it("the actual manager sees their report's requests", async () => {
      const res = await request(app)
        .get("/api/leave/requests")
        .query({ employeeId: report1Id })
        .set(...authHeader(manager1Token));
      expect(res.status).toBe(200);
      expect(res.body.rows.some((r: { id: string }) => r.id === report1RequestId)).toBe(true);
    });

    it("HR_ADMIN (ALL scope) sees it too", async () => {
      const res = await request(app)
        .get("/api/leave/requests")
        .query({ employeeId: report1Id })
        .set(...authHeader(hrAdminToken));
      expect(res.status).toBe(200);
      expect(res.body.rows.some((r: { id: string }) => r.id === report1RequestId)).toBe(true);
    });

    it("a caller with no leave.view listing without a filter only ever sees their own", async () => {
      const res = await request(app).get("/api/leave/requests").set(...authHeader(strangerToken));
      expect(res.status).toBe(200);
      expect(res.body.rows.every((r: { employeeId: string }) => r.employeeId !== report1Id)).toBe(true);
    });
  });

  describe("GET /api/leave/requests/:id", () => {
    it("an unrelated stranger gets 404 for someone else's request id", async () => {
      const res = await request(app)
        .get(`/api/leave/requests/${report1RequestId}`)
        .set(...authHeader(strangerToken));
      expect(res.status).toBe(404);
    });

    it("the employee themselves can always see their own request", async () => {
      const res = await request(app)
        .get(`/api/leave/requests/${report1RequestId}`)
        .set(...authHeader(report1Token));
      expect(res.status).toBe(200);
    });
  });

  describe("POST /api/leave/requests/:id/approve", () => {
    it("a caller with no leave.approve at all gets 403", async () => {
      const res = await request(app)
        .post(`/api/leave/requests/${report1RequestId}/approve`)
        .set(...authHeader(strangerToken))
        .send({});
      expect(res.status).toBe(403);
    });

    it("a manager outside the reporting line gets 404, never approves someone else's team's leave", async () => {
      const res = await request(app)
        .post(`/api/leave/requests/${report1RequestId}/approve`)
        .set(...authHeader(manager2Token))
        .send({});
      expect(res.status).toBe(404);

      const stillPending = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: report1RequestId } });
      expect(stillPending.status).toBe("PENDING");
    });
  });

  describe("POST /api/leave/requests (apply on behalf)", () => {
    it("a caller with no leave.apply.onBehalf gets 403", async () => {
      const res = await request(app)
        .post("/api/leave/requests")
        .set(...authHeader(strangerToken))
        .send({ employeeId: report1Id, leaveTypeId: plTypeId, fromDate: "2026-12-08", toDate: "2026-12-08", fromDayPart: "FULL", toDayPart: "FULL" });
      expect(res.status).toBe(403);
    });

    it("a manager with onBehalf but outside scope gets 404", async () => {
      const res = await request(app)
        .post("/api/leave/requests")
        .set(...authHeader(manager2Token))
        .send({ employeeId: report1Id, leaveTypeId: plTypeId, fromDate: "2026-12-08", toDate: "2026-12-08", fromDayPart: "FULL", toDayPart: "FULL" });
      expect(res.status).toBe(404);
    });

    it("the actual manager can apply on behalf of their own report", async () => {
      const res = await request(app)
        .post("/api/leave/requests")
        .set(...authHeader(manager1Token))
        .send({ employeeId: report1Id, leaveTypeId: plTypeId, fromDate: "2026-12-09", toDate: "2026-12-09", fromDayPart: "FULL", toDayPart: "FULL" }); // Wed
      expect(res.status).toBe(201);
      expect(res.body.employeeId).toBe(report1Id);
    });
  });

  describe("GET /api/leave/balances?employeeId=", () => {
    it("no leave.view -> 403 for someone else's balances", async () => {
      const res = await request(app)
        .get("/api/leave/balances")
        .query({ employeeId: report1Id })
        .set(...authHeader(strangerToken));
      expect(res.status).toBe(403);
    });

    it("out-of-scope manager -> 404", async () => {
      const res = await request(app)
        .get("/api/leave/balances")
        .query({ employeeId: report1Id })
        .set(...authHeader(manager2Token));
      expect(res.status).toBe(404);
    });

    it("the employee's own manager can see it", async () => {
      const res = await request(app)
        .get("/api/leave/balances")
        .query({ employeeId: report1Id })
        .set(...authHeader(manager1Token));
      expect(res.status).toBe(200);
    });

    it("every employee can always see their own, no permission required", async () => {
      const res = await request(app).get("/api/leave/balances").set(...authHeader(report1Token));
      expect(res.status).toBe(200);
    });
  });
});
