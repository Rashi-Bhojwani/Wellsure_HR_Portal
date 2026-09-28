import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupLoginableTestEmployee, cleanupTestRole, createEmployeeTestOrgMasters, createLoginableTestEmployee, grantPermissions, loginAs, type TestOrgMasters } from "./leaveTestHelpers";

describe("Leave — admin catalog (types/policies/holidays, leave.policy.manage)", () => {
  const adminRole = `TEST_LEAVEPOLICY_${Date.now()}`;
  let org: TestOrgMasters;
  let adminToken: string;
  let plainToken: string;
  let secondLocationId: string;
  const employeeIds: string[] = [];
  const leaveTypeIdsToCleanup: string[] = [];
  const holidayIdsToCleanup: string[] = [];

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    await grantPermissions(adminRole, ["leave.policy.manage"]);

    const admin = await createLoginableTestEmployee(org, { roleCode: adminRole });
    employeeIds.push(admin.employeeId);
    adminToken = await loginAs(admin.employeeCode);

    const plain = await createLoginableTestEmployee(org, { roleCode: "EMPLOYEE" });
    employeeIds.push(plain.employeeId);
    plainToken = await loginAs(plain.employeeCode);

    const suffix = randomUUID().slice(0, 8);
    const secondLocation = await prisma.location.create({
      data: { code: `TEST-LOC2-${suffix}`, name: `Test Branch 2 ${suffix}`, addressLine1: "2 Test Rd", city: "Testville", state: "TS", pincode: "123456" },
    });
    secondLocationId = secondLocation.id;
  });

  afterAll(async () => {
    for (const id of holidayIdsToCleanup) await prisma.holiday.deleteMany({ where: { id } });
    await prisma.restrictedHoliday.deleteMany({ where: { locationId: { in: [org.locationId, secondLocationId] } } });
    for (const id of leaveTypeIdsToCleanup) {
      await prisma.leavePolicy.deleteMany({ where: { leaveTypeId: id } });
      await prisma.leaveType.deleteMany({ where: { id } });
    }
    await prisma.location.delete({ where: { id: secondLocationId } }).catch(() => undefined);
    for (const id of [...employeeIds].reverse()) await cleanupLoginableTestEmployee(id);
    await cleanupTestRole(adminRole);
    await cleanupEmployeeTestOrgMasters(org);
  });

  describe("leave types", () => {
    it("blocks every mutating route without leave.policy.manage", async () => {
      const res = await request(app)
        .post("/api/leave/types")
        .set(...authHeader(plainToken))
        .send({ code: "SHOULD_FAIL", name: "Should Fail" });
      expect(res.status).toBe(403);
    });

    it("GET /types/all requires leave.policy.manage and includes policy", async () => {
      const blocked = await request(app).get("/api/leave/types/all").set(...authHeader(plainToken));
      expect(blocked.status).toBe(403);

      const res = await request(app).get("/api/leave/types/all").set(...authHeader(adminToken));
      expect(res.status).toBe(200);
      const pl = res.body.leaveTypes.find((t: { code: string }) => t.code === "PL");
      expect(pl.policy).not.toBeNull();
      expect(typeof pl.policy.accrualDaysPerMonth).toBe("number"); // Decimal must serialize as number, not string
    });

    it("creates, updates and rejects a duplicate code", async () => {
      const suffix = randomUUID().slice(0, 6).toUpperCase();
      const code = `TEST_${suffix}`;
      const createRes = await request(app)
        .post("/api/leave/types")
        .set(...authHeader(adminToken))
        .send({ code, name: "Test Leave", isPaid: true, allowHalfDay: false });
      expect(createRes.status).toBe(201);
      leaveTypeIdsToCleanup.push(createRes.body.id);

      const dupRes = await request(app)
        .post("/api/leave/types")
        .set(...authHeader(adminToken))
        .send({ code, name: "Duplicate", isPaid: true, allowHalfDay: true });
      expect(dupRes.status).toBe(409);

      const updateRes = await request(app)
        .patch(`/api/leave/types/${createRes.body.id}`)
        .set(...authHeader(adminToken))
        .send({ name: "Test Leave Renamed", isActive: false });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.name).toBe("Test Leave Renamed");
      expect(updateRes.body.isActive).toBe(false);
    });

    it("upserts a policy with partial updates that don't clobber untouched fields", async () => {
      const wfhType = await prisma.leaveType.findUniqueOrThrow({ where: { code: "WFH" } });

      const first = await request(app)
        .put(`/api/leave/types/${wfhType.id}/policy`)
        .set(...authHeader(adminToken))
        .send({ wfhMonthlyLimit: 5 });
      expect(first.status).toBe(200);
      expect(first.body.wfhMonthlyLimit).toBe(5);

      const second = await request(app)
        .put(`/api/leave/types/${wfhType.id}/policy`)
        .set(...authHeader(adminToken))
        .send({ wfhYearlyLimit: 40 });
      expect(second.status).toBe(200);
      expect(second.body.wfhYearlyLimit).toBe(40);
      expect(second.body.wfhMonthlyLimit).toBe(5); // untouched by the second call

      // Explicitly clearing back to unlimited (null) must work too.
      const third = await request(app)
        .put(`/api/leave/types/${wfhType.id}/policy`)
        .set(...authHeader(adminToken))
        .send({ wfhMonthlyLimit: null });
      expect(third.body.wfhMonthlyLimit).toBeNull();
      expect(third.body.wfhYearlyLimit).toBe(40);
    });
  });

  describe("holidays", () => {
    it("blocks mutations without leave.policy.manage", async () => {
      const res = await request(app)
        .post("/api/holidays")
        .set(...authHeader(plainToken))
        .send({ locationId: org.locationId, date: "2026-12-25", name: "Test Holiday" });
      expect(res.status).toBe(403);
    });

    it("creates, updates, rejects a duplicate, then deletes", async () => {
      const suffix = randomUUID().slice(0, 6);
      const createRes = await request(app)
        .post("/api/holidays")
        .set(...authHeader(adminToken))
        .send({ locationId: org.locationId, date: "2026-11-11", name: `Test Holiday ${suffix}` });
      expect(createRes.status).toBe(201);
      const holidayId = createRes.body.id as string;

      const dupRes = await request(app)
        .post("/api/holidays")
        .set(...authHeader(adminToken))
        .send({ locationId: org.locationId, date: "2026-11-11", name: "Another Name" });
      expect(dupRes.status).toBe(409);

      const updateRes = await request(app)
        .patch(`/api/holidays/${holidayId}`)
        .set(...authHeader(adminToken))
        .send({ name: `Renamed ${suffix}` });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.name).toBe(`Renamed ${suffix}`);

      const deleteRes = await request(app)
        .delete(`/api/holidays/${holidayId}`)
        .set(...authHeader(adminToken));
      expect(deleteRes.status).toBe(204);

      const gone = await prisma.holiday.findUnique({ where: { id: holidayId } });
      expect(gone).toBeNull();
    });

    it("bulk-creates across multiple branches, per-location results distinguishing created from skipped", async () => {
      const suffix = randomUUID().slice(0, 6);
      // Pre-seed a conflicting holiday on the second location for the same date.
      const existing = await prisma.holiday.create({ data: { locationId: secondLocationId, date: new Date("2026-10-10"), name: "Pre-existing" } });
      holidayIdsToCleanup.push(existing.id);

      const bulkRes = await request(app)
        .post("/api/holidays/bulk")
        .set(...authHeader(adminToken))
        .send({ locationIds: [org.locationId, secondLocationId], date: "2026-10-10", name: `Bulk Holiday ${suffix}` });
      expect(bulkRes.status).toBe(200);
      const results = bulkRes.body.results as { locationId: string; status: string }[];
      expect(results.find((r) => r.locationId === org.locationId)?.status).toBe("created");
      expect(results.find((r) => r.locationId === secondLocationId)?.status).toBe("skipped");

      const created = await prisma.holiday.findFirst({ where: { locationId: org.locationId, date: new Date("2026-10-10") } });
      expect(created).not.toBeNull();
      holidayIdsToCleanup.push(created!.id);
    });
  });

  describe("restricted holidays", () => {
    it("creates and bulk-creates the same way as holidays", async () => {
      const suffix = randomUUID().slice(0, 6);
      const createRes = await request(app)
        .post("/api/restricted-holidays")
        .set(...authHeader(adminToken))
        .send({ locationId: org.locationId, date: "2026-09-05", name: `Test RH ${suffix}` });
      expect(createRes.status).toBe(201);

      const bulkRes = await request(app)
        .post("/api/restricted-holidays/bulk")
        .set(...authHeader(adminToken))
        .send({ locationIds: [secondLocationId], date: "2026-09-06", name: `Bulk RH ${suffix}` });
      expect(bulkRes.status).toBe(200);
      expect(bulkRes.body.results[0].status).toBe("created");
    });
  });
});
