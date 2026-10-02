import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import * as dashboardService from "../dashboard";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupLoginableTestEmployee,
  cleanupMinimalTestEmployee,
  createEmployeeTestOrgMasters,
  createLoginableTestEmployee,
  createMinimalTestEmployee,
  loginAs,
  utcDate,
  type TestOrgMasters,
} from "./leaveTestHelpers";

// An ALL-scope viewer: company-wide figures (E1.1 scoped this endpoint).
const COMPANY_VIEWER = { employeeId: "test-viewer", dataScope: "ALL" as const };

// Workforce Overview dashboard — byMonthAndType/rhBreakdown both filter on
// a CLOSED fromDate range for the given year (unlike Year End's open-ended
// cutoff), so a fictional far-future year genuinely isolates this test's
// own fixtures from seed data and every other test file's real-2026 dates.
const YEAR = 2090;

describe("GET /api/leave/dashboard", () => {
  let plTypeId: string;
  let wfhTypeId: string;
  let rhTypeId: string;
  const employeeIds: string[] = [];
  const requestIds: string[] = [];
  const rhIds: string[] = [];

  beforeAll(async () => {
    plTypeId = (await prisma.leaveType.findUniqueOrThrow({ where: { code: "PL" } })).id;
    wfhTypeId = (await prisma.leaveType.findUniqueOrThrow({ where: { code: "WFH" } })).id;
    rhTypeId = (await prisma.leaveType.findUniqueOrThrow({ where: { code: "RH" } })).id;
  });

  afterEach(async () => {
    await prisma.leaveRequest.deleteMany({ where: { id: { in: requestIds } } });
    requestIds.length = 0;
    await prisma.restrictedHoliday.deleteMany({ where: { id: { in: rhIds } } });
    rhIds.length = 0;
    while (employeeIds.length) await cleanupMinimalTestEmployee(employeeIds.pop()!);
  });

  it("sums approved requests by (month, leaveTypeCode), excludes non-approved requests, and breaks down RH by date", async () => {
    const employeeId = await createMinimalTestEmployee(utcDate("2020-01-01"));
    employeeIds.push(employeeId);

    const plRequest = await prisma.leaveRequest.create({
      data: { employeeId, leaveTypeId: plTypeId, fromDate: utcDate(`${YEAR}-03-05`), toDate: utcDate(`${YEAR}-03-07`), totalDays: 3, status: "APPROVED", appliedByUserId: "test-applier" },
    });
    requestIds.push(plRequest.id);

    const wfhRequest = await prisma.leaveRequest.create({
      data: { employeeId, leaveTypeId: wfhTypeId, fromDate: utcDate(`${YEAR}-03-10`), toDate: utcDate(`${YEAR}-03-10`), totalDays: 1, status: "APPROVED", appliedByUserId: "test-applier" },
    });
    requestIds.push(wfhRequest.id);

    // Still PENDING — must not be counted.
    const pendingRequest = await prisma.leaveRequest.create({
      data: { employeeId, leaveTypeId: plTypeId, fromDate: utcDate(`${YEAR}-03-20`), toDate: utcDate(`${YEAR}-03-20`), totalDays: 1, status: "PENDING", appliedByUserId: "test-applier" },
    });
    requestIds.push(pendingRequest.id);

    const rh = await prisma.restrictedHoliday.create({ data: { date: utcDate(`${YEAR}-01-26`), name: "Test RH" } });
    rhIds.push(rh.id);
    const rhRequest = await prisma.leaveRequest.create({
      data: { employeeId, leaveTypeId: rhTypeId, fromDate: utcDate(`${YEAR}-01-26`), toDate: utcDate(`${YEAR}-01-26`), totalDays: 1, status: "APPROVED", appliedByUserId: "test-applier" },
    });
    requestIds.push(rhRequest.id);

    const result = await dashboardService.getWorkforceDashboard(YEAR, COMPANY_VIEWER);

    expect(result.leaveTypes).toEqual(expect.arrayContaining(["PL", "WFH", "RH"]));

    const plEntry = result.byMonthAndType.find((e) => e.month === 3 && e.leaveTypeCode === "PL");
    expect(plEntry?.days).toBe(3); // the approved 3-day request only — the pending 1-day one is excluded

    const wfhEntry = result.byMonthAndType.find((e) => e.month === 3 && e.leaveTypeCode === "WFH");
    expect(wfhEntry?.days).toBe(1);

    const rhEntry = result.rhBreakdown.find((r) => r.date === `${YEAR}-01-26`);
    expect(rhEntry).toEqual({ date: `${YEAR}-01-26`, name: "Test RH", employeeCount: 1 });
  });

  it("omits an RH date from the breakdown when no one took it", async () => {
    const rh = await prisma.restrictedHoliday.create({ data: { date: utcDate(`${YEAR}-02-14`), name: "Untaken RH" } });
    rhIds.push(rh.id);

    const result = await dashboardService.getWorkforceDashboard(YEAR, COMPANY_VIEWER);
    expect(result.rhBreakdown.find((r) => r.date === `${YEAR}-02-14`)).toBeUndefined();
  });

  describe("route wiring (leave.view)", () => {
    let org: TestOrgMasters;
    let viewerToken: string;
    let plainToken: string;
    const routeTestEmployeeIds: string[] = [];

    beforeAll(async () => {
      org = await createEmployeeTestOrgMasters();
      const viewer = await createLoginableTestEmployee(org, { roleCode: "HR_ADMIN" });
      routeTestEmployeeIds.push(viewer.employeeId);
      viewerToken = await loginAs(viewer.employeeCode);
      const plain = await createLoginableTestEmployee(org, { roleCode: "EMPLOYEE" });
      routeTestEmployeeIds.push(plain.employeeId);
      plainToken = await loginAs(plain.employeeCode);
    });

    afterAll(async () => {
      for (const id of [...routeTestEmployeeIds].reverse()) await cleanupLoginableTestEmployee(id);
      await cleanupEmployeeTestOrgMasters(org);
    });

    it("blocks a caller without leave.view", async () => {
      const res = await request(app).get("/api/leave/dashboard").query({ year: YEAR }).set(...authHeader(plainToken));
      expect(res.status).toBe(403);
    });

    it("lets an HR_ADMIN fetch the dashboard", async () => {
      const res = await request(app).get("/api/leave/dashboard").query({ year: YEAR }).set(...authHeader(viewerToken));
      expect(res.status).toBe(200);
      expect(res.body.year).toBe(YEAR);
      expect(Array.isArray(res.body.byMonthAndType)).toBe(true);
    });

    it("400s without a year", async () => {
      const res = await request(app).get("/api/leave/dashboard").set(...authHeader(viewerToken));
      expect(res.status).toBe(400);
    });
  });
});
