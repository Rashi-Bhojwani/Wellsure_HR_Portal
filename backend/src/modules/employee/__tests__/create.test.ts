import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupEmployeesByCode,
  cleanupFullTestEmployee,
  cleanupTestRole,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  grantPermissions,
  loginAs,
  type TestOrgMasters,
} from "./employeeTestHelpers";

describe("POST /api/employees (Add Employee wizard)", () => {
  const roleCode = `TEST_HR_CREATE_${Date.now()}`;
  let org: TestOrgMasters;
  let hrToken: string;
  const employeeIds: string[] = [];
  const createdEmployeeCodes: string[] = [];

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    await grantPermissions(roleCode, ["employee.create"]);
    const hr = await createFullTestEmployee(org, { roleCode });
    employeeIds.push(hr.employeeId);
    hrToken = await loginAs(hr.employeeCode);
  });

  afterAll(async () => {
    await cleanupEmployeesByCode(createdEmployeeCodes);
    for (const id of employeeIds) await cleanupFullTestEmployee(id);
    await cleanupTestRole(roleCode);
    await cleanupEmployeeTestOrgMasters(org);
  });

  function wizardPayload(overrides: Partial<{ deviceUserId: string; employeeCode: string }> = {}) {
    const suffix = randomUUID().slice(0, 8);
    const code = overrides.employeeCode ?? overrides.deviceUserId ?? `NEW-${suffix}`;
    return {
      official: {
        deviceUserId: overrides.deviceUserId ?? code,
        employeeCode: code,
        dateOfJoining: "2026-01-15",
        departmentId: org.departmentId,
        designationId: org.designationId,
        locationId: org.locationId,
        employmentType: "PERMANENT",
      },
      personal: {
        fullName: `New Hire ${suffix}`,
        dateOfBirth: "1995-06-01",
        gender: "MALE",
        personalEmail: `new.hire.${suffix}@gmail.com`,
        mobile: "9876543210",
        currentAddress: "Some address",
        permanentAddress: "Some address",
        emergencyContactName: "Emergency Contact",
        emergencyContactPhone: "9876543211",
        emergencyContactRelation: "Parent",
      },
    };
  }

  it("creates a new employee end to end and sends an invitation", async () => {
    const payload = wizardPayload();
    createdEmployeeCodes.push(payload.official.employeeCode);

    const res = await request(app).post("/api/employees").set(...authHeader(hrToken)).send(payload);
    expect(res.status).toBe(201);
    expect(res.body.employeeCode).toBe(payload.official.employeeCode);

    const employee = await prisma.employee.findUnique({ where: { employeeCode: payload.official.employeeCode }, include: { user: true } });
    expect(employee).not.toBeNull();
    expect(employee?.user?.status).toBe("INVITED");

    const invitation = await prisma.invitationToken.findFirst({ where: { userId: employee!.user!.id } });
    expect(invitation).not.toBeNull();

    const auditRow = await prisma.auditLog.findFirst({ where: { action: "employee.created", entityId: employee!.id } });
    expect(auditRow).not.toBeNull();
  });

  describe("attendance capture is a deliberate choice (Phase 2, D2)", () => {
    const withCapture = (capture: "DEVICE" | "MANUAL" | undefined, deviceUserId: string | undefined) => {
      const payload = wizardPayload();
      const official: Record<string, unknown> = { ...payload.official, deviceUserId };
      if (capture) official.attendanceCapture = capture;
      createdEmployeeCodes.push(payload.official.employeeCode);
      return { ...payload, official };
    };

    it("MANUAL: no Device User ID, no device mapping, the company default assignment, and the profile says manual", async () => {
      const payload = withCapture("MANUAL", undefined);
      const res = await request(app).post("/api/employees").set(...authHeader(hrToken)).send(payload);
      expect(res.status).toBe(201);
      const e = await prisma.employee.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(await prisma.deviceUserMapping.count({ where: { employeeId: e.id } })).toBe(0);
      const a = await prisma.attendanceAssignment.findMany({ where: { employeeId: e.id }, include: { shift: true, weekOffPattern: true, policy: true } });
      expect(a.map((x) => [x.shift.code, x.weekOffPattern.code, x.policy.code, x.effectiveFrom.toISOString().slice(0, 10), x.effectiveTo])).toEqual([["GEN", "SUN", "DEFAULT", "2026-01-15", null]]);
      const hrAdmin = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" }); // company-wide scope sees the new hire
      employeeIds.push(hrAdmin.employeeId);
      const token = await loginAs(hrAdmin.employeeCode);
      const profile = await request(app).get(`/api/employees/${e.id}`).set(...authHeader(token));
      expect(profile.status).toBe(200);
      expect(profile.body.attendanceCapture).toBe("MANUAL");
    });

    it("DEVICE (the default for older clients): the mapping is created and the profile says device", async () => {
      const payload = withCapture(undefined, `DEV-${randomUUID().slice(0, 6)}`);
      const res = await request(app).post("/api/employees").set(...authHeader(hrToken)).send(payload);
      expect(res.status).toBe(201);
      expect(await prisma.deviceUserMapping.count({ where: { employeeId: res.body.id } })).toBe(1);
      expect(await prisma.attendanceAssignment.count({ where: { employeeId: res.body.id } })).toBe(1);
    });

    it("DEVICE without a Device User ID, or MANUAL with one, is refused with a message naming the choice", async () => {
      const noId = await request(app).post("/api/employees").set(...authHeader(hrToken)).send(withCapture("DEVICE", ""));
      expect(noId.status).toBe(400);
      expect(JSON.stringify(noId.body)).toContain("No device: attendance is marked manually");
      const both = await request(app).post("/api/employees").set(...authHeader(hrToken)).send(withCapture("MANUAL", "12345"));
      expect(both.status).toBe(400);
      expect(JSON.stringify(both.body)).toContain("Manual attendance has no Device User ID");
    });

    it("refuses to add anyone while the company default shift is inactive — never a person with no shift", async () => {
      await prisma.shift.update({ where: { id: "shift_gen" }, data: { isActive: false } });
      try {
        const res = await request(app).post("/api/employees").set(...authHeader(hrToken)).send(withCapture("MANUAL", undefined));
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe("ATTENDANCE_DEFAULTS_MISSING");
      } finally {
        await prisma.shift.update({ where: { id: "shift_gen" }, data: { isActive: true } });
      }
    });
  });

  it("rejects a duplicate Employee Code with a 409", async () => {
    const payload = wizardPayload();
    createdEmployeeCodes.push(payload.official.employeeCode);
    const first = await request(app).post("/api/employees").set(...authHeader(hrToken)).send(payload);
    expect(first.status).toBe(201);

    const dupe = wizardPayload({ employeeCode: payload.official.employeeCode, deviceUserId: `OTHER-${randomUUID().slice(0, 6)}` });
    const res = await request(app).post("/api/employees").set(...authHeader(hrToken)).send(dupe);
    expect(res.status).toBe(409);
  });

  it("blocks employees without employee.create from creating a new hire", async () => {
    const plainRoleCode = `TEST_PLAIN_${Date.now()}`;
    await grantPermissions(plainRoleCode, []);
    const plain = await createFullTestEmployee(org, { roleCode: plainRoleCode });
    employeeIds.push(plain.employeeId);
    const plainToken = await loginAs(plain.employeeCode);

    const res = await request(app).post("/api/employees").set(...authHeader(plainToken)).send(wizardPayload());
    expect(res.status).toBe(403);
    await cleanupTestRole(plainRoleCode);
  });

  describe("device ID / Employee Code collision + suggestion flow (spec §3)", () => {
    it("reports no collision for a fresh device user ID", async () => {
      const id = `FRESH-${randomUUID().slice(0, 8)}`;
      const res = await request(app).get(`/api/employees/device-code-check?deviceUserId=${id}`).set(...authHeader(hrToken));
      expect(res.status).toBe(200);
      expect(res.body.collision).toBeNull();
      expect(res.body.suggestedEmployeeCode).toBe(id);
    });

    it("flags a collision when the raw ID matches an existing (even separated) Employee Code, and suggests the next free '-N' code", async () => {
      const payload = wizardPayload();
      createdEmployeeCodes.push(payload.official.employeeCode);
      await request(app).post("/api/employees").set(...authHeader(hrToken)).send(payload);
      // Separate them, freeing their device ID for real-world reuse, but their Employee Code stays permanently taken.
      await prisma.employee.update({ where: { employeeCode: payload.official.employeeCode }, data: { status: "SEPARATED", lastWorkingDate: new Date("2026-02-01") } });

      const res = await request(app)
        .get(`/api/employees/device-code-check?deviceUserId=${payload.official.employeeCode}`)
        .set(...authHeader(hrToken));
      expect(res.status).toBe(200);
      expect(res.body.collision).not.toBeNull();
      expect(res.body.collision.employeeCode).toBe(payload.official.employeeCode);
      expect(res.body.collision.separatedOn).toBe("2026-02-01");
      expect(res.body.suggestedEmployeeCode).toBe(`${payload.official.employeeCode}-2`);
    });

    it("suggests -3 once -2 is also taken", async () => {
      const base = wizardPayload();
      createdEmployeeCodes.push(base.official.employeeCode, `${base.official.employeeCode}-2`);
      await request(app).post("/api/employees").set(...authHeader(hrToken)).send(base);
      const second = wizardPayload({ employeeCode: `${base.official.employeeCode}-2`, deviceUserId: `${base.official.employeeCode}-2` });
      await request(app).post("/api/employees").set(...authHeader(hrToken)).send(second);

      const res = await request(app)
        .get(`/api/employees/device-code-check?deviceUserId=${base.official.employeeCode}`)
        .set(...authHeader(hrToken));
      expect(res.body.suggestedEmployeeCode).toBe(`${base.official.employeeCode}-3`);
    });
  });
});
