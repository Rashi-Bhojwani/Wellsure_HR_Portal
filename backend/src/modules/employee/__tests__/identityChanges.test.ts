import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import { keyUsage } from "../../../lib/fieldKeyRotation";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupEmployeesByCode,
  cleanupFullTestEmployee,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  grantPermissions,
  loginAs,
  type TestOrgMasters,
} from "./employeeTestHelpers";

// M session, task 1 (docs/plans/M_CHECKLIST.md): HR's bank and statutory changes wait for a director (decision b). Every number here is made up.
const KEY = "identity.directorConfirmsHrChanges";
const bank = (n: string) => ({ accountHolderName: "Made Up Holder", accountNumber: n, accountNumberConfirm: n, ifsc: "TEST0000123", bankName: "Test Bank", branchName: "Test Branch" });

describe("HR's bank and statutory changes wait for a director", () => {
  let org: TestOrgMasters;
  const ids: string[] = [];
  const createdCodes: string[] = [];
  const t: Record<string, string> = {};
  const u: Record<string, { employeeId: string; userId: string }> = {};

  const as = (who: string) => ({
    get: (p: string) => request(app).get(p).set(...authHeader(t[who]!)),
    post: (p: string, body: object = {}) => request(app).post(p).set(...authHeader(t[who]!)).send(body),
    patch: (p: string, body: object) => request(app).patch(p).set(...authHeader(t[who]!)).send(body),
  });
  const openBank = (employeeId: string) => prisma.employeeBankAccount.findFirst({ where: { employeeId, effectiveTo: null } });
  async function setSetting(value: boolean) {
    const p = await as("d1").post(`/api/behaviours/${KEY}/proposals`, { value, reason: "Test of the identity setting" });
    expect(p.status).toBe(201);
    expect((await as("d2").post(`/api/behaviours/proposals/${p.body.id}/confirm`)).status).toBe(200);
  }

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    for (const [k, roleCode] of [
      ["d1", "SUPER_ADMIN"],
      ["d2", "SUPER_ADMIN"],
      ["hrAdmin", "HR_ADMIN"],
      ["hrExec", "HR_EXECUTIVE"],
      ["mgr", "MANAGER"],
      ["emp", undefined],
      ["dev", DEVELOPER_ROLE_CODE],
      ["target", undefined],
      ["target2", undefined],
    ] as const) {
      const e = await createFullTestEmployee(org, roleCode ? { roleCode } : {});
      ids.push(e.employeeId);
      u[k] = e;
      t[k] = await loginAs(e.employeeCode);
    }
  });

  afterAll(async () => {
    // Leave the setting as every other test file expects it: on (its default) — a confirmed "true" is the same as the default for the code.
    await setSetting(true);
    await cleanupEmployeesByCode(createdCodes);
    for (const id of ids) await cleanupFullTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("an HR Executive's bank change is held, masked and not written; the directors are told and it is audited", async () => {
    const before = await openBank(u.target!.employeeId);
    const res = await as("hrExec").patch(`/api/employees/${u.target!.employeeId}/bank`, bank("50000000001234"));
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ pending: true, kind: "BANK", status: "PENDING", accountNumberLast4: "1234" });
    expect(JSON.stringify(res.body)).not.toContain("50000000001234");
    expect((await openBank(u.target!.employeeId))?.id).toBe(before?.id);
    const row = await prisma.identityChangeRequest.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(JSON.stringify(row.payload)).not.toContain("50000000001234");
    expect(row).toMatchObject({ source: "HR_EDIT", enteredByUserId: u.hrExec!.userId });
    expect(await prisma.auditLog.count({ where: { action: "employee.identity_change.held", entityId: row.id } })).toBe(1);
    for (const d of ["d1", "d2"]) expect(await prisma.notification.count({ where: { userId: u[d]!.userId, type: "identity.change.pending" } })).toBeGreaterThan(0);
    // A held payload is ciphertext the key-rotation status must count, so its key cannot be retired while it waits.
    expect((await keyUsage()).some((k) => k.column.startsWith("IdentityChangeRequest.payload"))).toBe(true);
    // A second change of the same kind for the same person waits for the first to be decided.
    expect((await as("hrAdmin").patch(`/api/employees/${u.target!.employeeId}/bank`, bank("50000000005678"))).status).toBe(409);
  });

  it("HR can neither confirm nor reject; another HR cannot withdraw it; a director other than the person who entered it confirms, and it is written", async () => {
    const row = await prisma.identityChangeRequest.findFirstOrThrow({ where: { employeeId: u.target!.employeeId, kind: "BANK", status: "PENDING" } });
    expect((await as("hrExec").post(`/api/employees/identity-changes/${row.id}/confirm`)).body.error.code).toBe("DIRECTOR_ONLY");
    expect((await as("hrAdmin").post(`/api/employees/identity-changes/${row.id}/reject`, { reason: "Not this one" })).status).toBe(403);
    expect((await as("hrAdmin").post(`/api/employees/identity-changes/${row.id}/withdraw`)).body.error.code).toBe("NOT_YOURS");
    expect((await as("emp").post(`/api/employees/identity-changes/${row.id}/confirm`)).status).toBe(403);
    expect((await as("dev").post(`/api/employees/identity-changes/${row.id}/confirm`)).status).toBe(403);

    const ok = await as("d1").post(`/api/employees/identity-changes/${row.id}/confirm`);
    expect(ok.status).toBe(200);
    expect((await openBank(u.target!.employeeId))?.accountNumberLast4).toBe("1234");
    expect((await prisma.identityChangeRequest.findUniqueOrThrow({ where: { id: row.id } })).decidedByUserId).toBe(u.d1!.userId);
    expect(await prisma.notification.count({ where: { userId: u.hrExec!.userId, type: "identity.change.decided" } })).toBe(1);
    // Decided once: a second click, or the other director, changes nothing.
    expect((await as("d2").post(`/api/employees/identity-changes/${row.id}/confirm`)).status).toBe(409);
  });

  it("a statutory change is held and a rejection (with its reason) leaves the record as it was", async () => {
    const before = await prisma.employeeStatutory.findUnique({ where: { employeeId: u.target!.employeeId } });
    const res = await as("hrAdmin").patch(`/api/employees/${u.target!.employeeId}/statutory`, { pan: "ZZZZZ9999Z" });
    expect(res.status).toBe(202);
    expect(res.body.panLast4).toBe("999Z");
    expect((await as("d2").post(`/api/employees/identity-changes/${res.body.id}/reject`, { reason: "" })).status).toBe(400);
    expect((await as("d2").post(`/api/employees/identity-changes/${res.body.id}/reject`, { reason: "Does not match the card" })).status).toBe(200);
    expect((await prisma.employeeStatutory.findUnique({ where: { employeeId: u.target!.employeeId } }))?.panLast4).toBe(before?.panLast4);
    const decided = await prisma.identityChangeRequest.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(decided).toMatchObject({ status: "REJECTED", reason: "Does not match the card" });
  });

  it("the person who entered a change may withdraw it while it waits", async () => {
    const res = await as("hrAdmin").patch(`/api/employees/${u.target2!.employeeId}/statutory`, { uan: "999900001111" });
    expect(res.status).toBe(202);
    expect((await as("hrAdmin").post(`/api/employees/identity-changes/${res.body.id}/withdraw`)).status).toBe(200);
    expect((await prisma.identityChangeRequest.findUniqueOrThrow({ where: { id: res.body.id } })).status).toBe("WITHDRAWN");
    expect((await as("d1").post(`/api/employees/identity-changes/${res.body.id}/confirm`)).status).toBe(409);
  });

  it("a director's entry for someone else is written at once (the director switch for their own entries is not set)", async () => {
    const res = await as("d1").patch(`/api/employees/${u.target2!.employeeId}/bank`, bank("50000000002468"));
    expect(res.status).toBe(200);
    expect((await openBank(u.target2!.employeeId))?.accountNumberLast4).toBe("2468");
  });

  it("a director's change to their own record waits for the other director", async () => {
    const res = await as("d1").patch(`/api/employees/${u.d1!.employeeId}/bank`, bank("50000000001357"));
    expect(res.status).toBe(202);
    expect(res.body.source).toBeUndefined(); // the response is the masked view only
    const row = await prisma.identityChangeRequest.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.source).toBe("DIRECTOR_EDIT");
    expect((await as("d1").post(`/api/employees/identity-changes/${row.id}/confirm`)).body.error.code).toBe("CHECKER_IS_MAKER");
    // Nor is a director asked to confirm a change to their own record entered by HR.
    const hrForD2 = await as("hrAdmin").patch(`/api/employees/${u.d2!.employeeId}/statutory`, { uan: "999900002222" });
    expect((await as("d2").post(`/api/employees/identity-changes/${hrForD2.body.id}/confirm`)).body.error.code).toBe("OWN_RECORD");
    expect((await as("d1").post(`/api/employees/identity-changes/${hrForD2.body.id}/confirm`)).status).toBe(200);
    expect((await as("d2").post(`/api/employees/identity-changes/${row.id}/confirm`)).status).toBe(200);
    expect((await openBank(u.d1!.employeeId))?.accountNumberLast4).toBe("1357");
  });

  it("who may list held changes: directors and HR (masked); never an employee, a manager or the Developer; no whole number in any list", async () => {
    for (const who of ["emp", "mgr", "dev"]) expect((await as(who).get("/api/employees/identity-changes")).status).toBe(403);
    const hr = await as("hrExec").get("/api/employees/identity-changes");
    expect(hr.status).toBe(200);
    expect(hr.body.changes.length).toBeGreaterThan(0);
    expect(hr.body.changes.every((c: { canDecide: boolean }) => c.canDecide === false)).toBe(true);
    const dir = await as("d2").get("/api/employees/identity-changes?status=CONFIRMED");
    expect(dir.status).toBe(200);
    for (const body of [JSON.stringify(hr.body), JSON.stringify(dir.body)]) {
      for (const secret of ["50000000001234", "50000000001357", "ZZZZZ9999Z", "999900001111", "999900002222"]) expect(body).not.toContain(secret);
    }
    expect((await as("dev").get(`/api/employees/identity-changes?employeeId=${u.target!.employeeId}`)).status).toBe(403);
  });

  it("Add Employee by HR: the bank and statutory details are held, the rest of the record is created", async () => {
    const suffix = randomUUID().slice(0, 8);
    const code = `IDH-${suffix}`;
    createdCodes.push(code);
    await grantPermissions("HR_ADMIN", ["employee.create"]);
    const res = await as("hrAdmin").post("/api/employees", {
      official: { deviceUserId: code, employeeCode: code, dateOfJoining: "2026-01-15", departmentId: org.departmentId, designationId: org.designationId, locationId: org.locationId, employmentType: "PERMANENT" },
      personal: {
        fullName: `Held Hire ${suffix}`,
        dateOfBirth: "1995-06-01",
        gender: "MALE",
        personalEmail: `held.hire.${suffix}@gmail.com`,
        mobile: "9876543210",
        currentAddress: "Some address",
        permanentAddress: "Some address",
        emergencyContactName: "Emergency Contact",
        emergencyContactPhone: "9876543211",
        emergencyContactRelation: "Parent",
      },
      statutory: { pan: "YYYYY8888Y" },
      bank: bank("50000000009999"),
    });
    expect([res.status, res.body.error]).toEqual([201, undefined]);
    expect(res.body.identityPending).toHaveLength(2);
    const employeeId = res.body.id as string;
    expect(await prisma.employeeBankAccount.count({ where: { employeeId } })).toBe(0);
    expect(await prisma.employeeStatutory.count({ where: { employeeId } })).toBe(0);
    const held = await prisma.identityChangeRequest.findMany({ where: { employeeId }, orderBy: { kind: "asc" } });
    expect(held.map((h) => [h.kind, h.source, h.status])).toEqual([
      ["BANK", "ADD_EMPLOYEE", "PENDING"],
      ["STATUTORY", "ADD_EMPLOYEE", "PENDING"],
    ]);
    expect(held[0]!.effectiveFrom?.toISOString().slice(0, 10)).toBe("2026-01-15");
    expect((await as("d2").post(`/api/employees/identity-changes/${held[0]!.id}/confirm`)).status).toBe(200);
    expect((await openBank(employeeId))?.accountNumberLast4).toBe("9999");
  });

  it("two directors confirming at the same moment: one confirms, the other is told it is decided, and it is written once", async () => {
    const res = await as("hrAdmin").patch(`/api/employees/${u.target2!.employeeId}/statutory`, { uan: "999900004444" });
    expect(res.status).toBe(202);
    const both = await Promise.all(["d1", "d2"].map((d) => as(d).post(`/api/employees/identity-changes/${res.body.id}/confirm`)));
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.auditLog.count({ where: { action: "employee.identity_change.confirmed", entityId: res.body.id } })).toBe(1);
  });

  it("the database refuses a decider who entered it, a change to a decided row, and a delete", async () => {
    const res = await as("hrAdmin").patch(`/api/employees/${u.target2!.employeeId}/statutory`, { uan: "999900003333" });
    const id = res.body.id as string;
    await expect(prisma.identityChangeRequest.update({ where: { id }, data: { status: "CONFIRMED", decidedByUserId: u.hrAdmin!.userId, decidedAt: new Date() } })).rejects.toThrow(/identity_change_requests_other_person/);
    await expect(prisma.identityChangeRequest.update({ where: { id }, data: { payload: { uanLast4: "0000" } } })).rejects.toThrow(/IDENTITY_CHANGE_FIXED/);
    await expect(prisma.identityChangeRequest.delete({ where: { id } })).rejects.toThrow(/IDENTITY_CHANGE_KEPT/);
    expect((await as("d1").post(`/api/employees/identity-changes/${id}/reject`, { reason: "Test row" })).status).toBe(200);
    await expect(prisma.identityChangeRequest.update({ where: { id }, data: { reason: "changed later" } })).rejects.toThrow(/IDENTITY_CHANGE_DECIDED/);
  });

  it("with the director setting off, HR's entry is written at once, as before the setting existed", async () => {
    await setSetting(false);
    const res = await as("hrExec").patch(`/api/employees/${u.target2!.employeeId}/bank`, bank("50000000004321"));
    expect(res.status).toBe(200);
    expect((await openBank(u.target2!.employeeId))?.accountNumberLast4).toBe("4321");
    expect(JSON.stringify(res.body)).not.toContain("50000000004321");
    await setSetting(true);
    expect((await as("hrExec").patch(`/api/employees/${u.target2!.employeeId}/bank`, bank("50000000008765"))).status).toBe(202);
  });
});
