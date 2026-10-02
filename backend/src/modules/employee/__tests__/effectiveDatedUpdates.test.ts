import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { encryptBankFields } from "../service";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupFullTestEmployee,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  grantPermissions,
  loginAs,
  type TestOrgMasters,
} from "./employeeTestHelpers";

describe("Effective-dated updates + partial unique indexes", () => {
  // Literal "HR_ADMIN" — the seeded role's data scope (Role.dataScope, E1) only grants ALL scope to exact
  // role-code matches; a randomized code defaults to SELF, which would
  // 404 this file's own read-back-after-update assertions (found via the
  // same failure profileAndReveal.test.ts's scope tests hit).
  const roleCode = "HR_ADMIN";
  let org: TestOrgMasters;
  let hrToken: string;
  const employeeIds: string[] = [];

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    await grantPermissions(roleCode, ["employee.view", "employee.edit", "employee.bank.view", "employee.bank.edit"]);
    const hr = await createFullTestEmployee(org, { roleCode });
    employeeIds.push(hr.employeeId);
    hrToken = await loginAs(hr.employeeCode);
  });

  afterAll(async () => {
    // Shared literal role (HR_ADMIN) — only unlink, never delete it outright.
    for (const id of employeeIds) await cleanupFullTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  describe("a job change closes the old row and opens a new one", () => {
    it("via PATCH /:id/job", async () => {
      const target = await createFullTestEmployee(org);
      employeeIds.push(target.employeeId);
      const before = await prisma.employeeJobHistory.findFirst({ where: { employeeId: target.employeeId, effectiveTo: null } });

      const res = await request(app)
        .patch(`/api/employees/${target.employeeId}/job`)
        .set(...authHeader(hrToken))
        .send({ designationId: org.designationId, effectiveFrom: "2026-03-01", changeReason: "Promotion" });
      expect(res.status).toBe(200);

      const closedRow = await prisma.employeeJobHistory.findUnique({ where: { id: before!.id } });
      expect(closedRow?.effectiveTo?.toISOString().slice(0, 10)).toBe("2026-03-01");
      const openRows = await prisma.employeeJobHistory.findMany({ where: { employeeId: target.employeeId, effectiveTo: null } });
      expect(openRows).toHaveLength(1);
      expect(openRows[0]!.changeReason).toBe("Promotion");
    });
  });

  describe("a bank change closes the old row and opens a new one", () => {
    it("via PATCH /:id/bank, masking the account number in the response", async () => {
      const target = await createFullTestEmployee(org);
      employeeIds.push(target.employeeId);
      const before = await prisma.employeeBankAccount.findFirst({ where: { employeeId: target.employeeId, effectiveTo: null } });

      const res = await request(app)
        .patch(`/api/employees/${target.employeeId}/bank`)
        .set(...authHeader(hrToken))
        .send({
          accountHolderName: "Updated Holder",
          accountNumber: "99988877766",
          accountNumberConfirm: "99988877766",
          ifsc: "HDFC0000456",
          bankName: "HDFC Bank",
          branchName: "New Branch",
        });
      expect(res.status).toBe(200);
      expect(res.body.accountNumberLast4).toBe("7766");
      expect(JSON.stringify(res.body)).not.toContain("99988877766");

      const closedRow = await prisma.employeeBankAccount.findUnique({ where: { id: before!.id } });
      expect(closedRow?.effectiveTo).not.toBeNull();
      const openRows = await prisma.employeeBankAccount.findMany({ where: { employeeId: target.employeeId, effectiveTo: null } });
      expect(openRows).toHaveLength(1);
    });
  });

  describe("a name change closes the old row and opens a new one", () => {
    it("via PATCH /:id/name", async () => {
      const target = await createFullTestEmployee(org);
      employeeIds.push(target.employeeId);
      const before = await prisma.employeeNameHistory.findFirst({ where: { employeeId: target.employeeId, effectiveTo: null } });

      const res = await request(app)
        .patch(`/api/employees/${target.employeeId}/name`)
        .set(...authHeader(hrToken))
        .send({ fullName: "New Legal Name", effectiveFrom: "2026-04-01", changeReason: "Marriage" });
      expect(res.status).toBe(200);

      const closedRow = await prisma.employeeNameHistory.findUnique({ where: { id: before!.id } });
      expect(closedRow?.effectiveTo).not.toBeNull();
      const profile = await request(app).get(`/api/employees/${target.employeeId}`).set(...authHeader(hrToken));
      expect(profile.body.fullName).toBe("New Legal Name");
    });
  });

  describe("partial unique indexes reject a second open row when inserted directly", () => {
    it("rejects a second open EmployeeJobHistory row for the same employee", async () => {
      const target = await createFullTestEmployee(org);
      employeeIds.push(target.employeeId);

      await expect(
        prisma.employeeJobHistory.create({
          data: {
            employeeId: target.employeeId,
            departmentId: org.departmentId,
            designationId: org.designationId,
            locationId: org.locationId,
            effectiveFrom: new Date("2026-01-01"),
            createdByUserId: target.userId,
          },
        }),
      ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
    });

    it("rejects a second open EmployeeNameHistory row for the same employee", async () => {
      const target = await createFullTestEmployee(org);
      employeeIds.push(target.employeeId);

      await expect(
        prisma.employeeNameHistory.create({
          data: { employeeId: target.employeeId, fullName: "Duplicate Open Row", effectiveFrom: new Date("2026-01-01"), createdByUserId: target.userId },
        }),
      ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
    });

    it("rejects a second open EmployeeBankAccount row for the same employee", async () => {
      const target = await createFullTestEmployee(org);
      employeeIds.push(target.employeeId);

      await expect(
        prisma.employeeBankAccount.create({
          data: {
            employeeId: target.employeeId,
            ...encryptBankFields({ accountHolderName: "Dup", accountNumber: "11122233344", ifsc: "SBIN0001234", bankName: "SBI", branchName: "X" }),
            effectiveFrom: new Date("2026-01-01"),
            createdByUserId: target.userId,
          },
        }),
      ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
    });

    it("rejects a second employee holding the same *active* bank account number", async () => {
      const a = await createFullTestEmployee(org);
      const b = await createFullTestEmployee(org);
      employeeIds.push(a.employeeId, b.employeeId);
      const sharedAccountNumber = "555444333222";

      await prisma.employeeBankAccount.create({
        data: {
          employeeId: a.employeeId,
          ...encryptBankFields({ accountHolderName: "A", accountNumber: sharedAccountNumber, ifsc: "SBIN0001234", bankName: "SBI", branchName: "X" }),
          effectiveFrom: new Date("2020-01-01"),
          effectiveTo: new Date("2020-06-01"), // closed — should NOT collide
          createdByUserId: a.userId,
        },
      });

      await expect(
        prisma.employeeBankAccount.create({
          data: {
            employeeId: b.employeeId,
            ...encryptBankFields({ accountHolderName: "B", accountNumber: sharedAccountNumber, ifsc: "SBIN0001234", bankName: "SBI", branchName: "X" }),
            effectiveFrom: new Date("2026-01-01"),
            createdByUserId: b.userId,
          },
        }),
      ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
    });

    it("rejects a second active DeviceUserMapping for the same device user ID", async () => {
      const target = await createFullTestEmployee(org);
      const other = await createFullTestEmployee(org);
      employeeIds.push(target.employeeId, other.employeeId);

      await expect(
        prisma.deviceUserMapping.create({
          data: { employeeId: other.employeeId, deviceUserId: target.employeeCode, validFrom: new Date("2026-01-01"), createdByUserId: other.userId },
        }),
      ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
    });
  });
});
