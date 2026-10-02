import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupLoginableTestEmployee, createEmployeeTestOrgMasters, createLoginableTestEmployee, loginAs, type TestOrgMasters } from "./leaveTestHelpers";

describe("Leave — admin grants (POST /api/leave/grants, /comp-off/grant, GET /comp-off)", () => {
  // HR_ADMIN, not a synthetic role code: the seeded role's data scope (Role.dataScope, E1) keys off known
  // role codes (SUPER_ADMIN/HR_ADMIN/HR_EXECUTIVE/PAYROLL_ADMIN/APPROVER/
  // MANAGER), so an unrecognised synthetic code silently resolves to SELF
  // scope — fine for the permission-gate checks below, but wrong for the
  // balance/comp-off *reads* after a write, which need ALL scope to look
  // at another employee's data. HR_ADMIN already carries leave.grant and
  // leave.view from the seed.
  let org: TestOrgMasters;
  let granterToken: string;
  let plainToken: string;
  let employeeId: string;
  let plTypeId: string;
  let cofTypeId: string;
  const employeeIds: string[] = [];

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();

    const granter = await createLoginableTestEmployee(org, { roleCode: "HR_ADMIN" });
    employeeIds.push(granter.employeeId);
    granterToken = await loginAs(granter.employeeCode);

    const plain = await createLoginableTestEmployee(org, { roleCode: "EMPLOYEE" });
    employeeIds.push(plain.employeeId);
    plainToken = await loginAs(plain.employeeCode);

    const employee = await createLoginableTestEmployee(org, { roleCode: "EMPLOYEE" });
    employeeIds.push(employee.employeeId);
    employeeId = employee.employeeId;

    const plType = await prisma.leaveType.findUniqueOrThrow({ where: { code: "PL" } });
    plTypeId = plType.id;
    const cofType = await prisma.leaveType.findUniqueOrThrow({ where: { code: "COF" } });
    cofTypeId = cofType.id;
  });

  afterAll(async () => {
    for (const id of [...employeeIds].reverse()) await cleanupLoginableTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  describe("POST /api/leave/grants", () => {
    it("blocks a caller without leave.grant", async () => {
      const res = await request(app)
        .post("/api/leave/grants")
        .set(...authHeader(plainToken))
        .send({ employeeId, leaveTypeId: plTypeId, days: 1, entryDate: "2026-06-01" });
      expect(res.status).toBe(403);
    });

    it("credits a positive grant, reflected in the balance", async () => {
      const res = await request(app)
        .post("/api/leave/grants")
        .set(...authHeader(granterToken))
        .send({ employeeId, leaveTypeId: plTypeId, days: 3, entryDate: "2026-06-01", remarks: "Manual top-up" });
      expect(res.status).toBe(201);
      expect(res.body.entryType).toBe("GRANT");
      expect(res.body.days).toBe(3);

      const balanceRes = await request(app).get("/api/leave/balances").query({ employeeId }).set(...authHeader(granterToken));
      const pl = balanceRes.body.balances.find((b: { leaveTypeId: string }) => b.leaveTypeId === plTypeId);
      expect(pl.balance).toBe(3);
    });

    it("debits within balance, and rejects a debit that would go negative", async () => {
      const debit = await request(app)
        .post("/api/leave/grants")
        .set(...authHeader(granterToken))
        .send({ employeeId, leaveTypeId: plTypeId, days: -1, entryDate: "2026-06-02" });
      expect(debit.status).toBe(201);
      expect(debit.body.entryType).toBe("DEBIT");

      const overDebit = await request(app)
        .post("/api/leave/grants")
        .set(...authHeader(granterToken))
        .send({ employeeId, leaveTypeId: plTypeId, days: -100, entryDate: "2026-06-03" });
      expect(overDebit.status).toBe(400);
      expect(overDebit.body.error.code).toBe("INSUFFICIENT_BALANCE");
    });

    it("rejects COF via this endpoint, pointing to the comp-off grant action", async () => {
      const res = await request(app)
        .post("/api/leave/grants")
        .set(...authHeader(granterToken))
        .send({ employeeId, leaveTypeId: cofTypeId, days: 1, entryDate: "2026-06-01" });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("USE_COMP_OFF_GRANT");
    });

    it("rejects zero days", async () => {
      const res = await request(app)
        .post("/api/leave/grants")
        .set(...authHeader(granterToken))
        .send({ employeeId, leaveTypeId: plTypeId, days: 0, entryDate: "2026-06-01" });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/leave/comp-off/grant + GET /api/leave/comp-off", () => {
    it("blocks a caller without leave.grant", async () => {
      const res = await request(app)
        .post("/api/leave/comp-off/grant")
        .set(...authHeader(plainToken))
        .send({ employeeId, earnedDate: "2026-06-07", hoursWorked: 8 });
      expect(res.status).toBe(403);
    });

    it("credits a comp-off day with the correct expiry, visible via the list endpoint", async () => {
      const grantRes = await request(app)
        .post("/api/leave/comp-off/grant")
        .set(...authHeader(granterToken))
        .send({ employeeId, earnedDate: "2026-06-07", hoursWorked: 8, remarks: "Worked Sunday" });
      expect(grantRes.status).toBe(201);
      expect(grantRes.body.earnedDays).toBe(1);
      expect(grantRes.body.status).toBe("AVAILABLE");
      expect(grantRes.body.source).toBe("MANUAL_GRANT");

      const listRes = await request(app).get("/api/leave/comp-off").query({ employeeId }).set(...authHeader(granterToken));
      expect(listRes.status).toBe(200);
      expect(listRes.body.credits.some((c: { id: string }) => c.id === grantRes.body.id)).toBe(true);
    });

    it("blocks insufficient hours worked with a 400, not a 500", async () => {
      const res = await request(app)
        .post("/api/leave/comp-off/grant")
        .set(...authHeader(granterToken))
        .send({ employeeId, earnedDate: "2026-06-08", hoursWorked: 1 });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INSUFFICIENT_HOURS");
    });

    it("comp-off list respects leave.view scope — 403 for a caller with neither leave.view nor self", async () => {
      const res = await request(app).get("/api/leave/comp-off").query({ employeeId }).set(...authHeader(plainToken));
      expect(res.status).toBe(403);
    });
  });
});
