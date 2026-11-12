import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupFullTestEmployee,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  loginAs,
  type TestOrgMasters,
} from "./employeeTestHelpers";

// SS-15 (M session): download my own data. Only the caller's record; identifiers masked; audited.
describe("download my own data", () => {
  let org: TestOrgMasters;
  const ids: string[] = [];
  const who: Record<string, { employeeId: string; userId: string; employeeCode: string; token: string }> = {};

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    for (const [k, roleCode] of [["me", undefined], ["other", undefined], ["dev", DEVELOPER_ROLE_CODE], ["hr", "HR_ADMIN"]] as const) {
      const e = await createFullTestEmployee(org, roleCode ? { roleCode } : {});
      ids.push(e.employeeId);
      who[k] = { ...e, token: await loginAs(e.employeeCode) };
    }
  });
  afterAll(async () => {
    for (const id of ids) await cleanupFullTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("gives the signed-in person their own data, as a file, with identifiers masked, and audits it", async () => {
    const res = await request(app).get("/api/employees/me/data-export").set(...authHeader(who.me!.token));
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain(`my-data-${who.me!.employeeCode}`);
    expect(res.headers["cache-control"]).toContain("no-store");
    expect(res.body.employee.employeeCode).toBe(who.me!.employeeCode);
    expect(res.body.bankAccounts[0].accountNumberLast4).toMatch(/^\d{4}$/);
    expect(res.body.bankAccounts[0].accountNumber).toBeUndefined();
    expect(res.body.statutory.panLast4).toEqual(expect.any(String));
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/Encrypted|Hash/);
    expect(body).not.toContain(who.other!.employeeCode);
    expect(await prisma.auditLog.count({ where: { action: "employee.self_export.downloaded", entityId: who.me!.employeeId } })).toBe(1);
  });

  it("is always the caller's own: a query naming someone else is ignored, and HR and the Developer get only their own", async () => {
    const res = await request(app).get(`/api/employees/me/data-export?employeeId=${who.other!.employeeId}`).set(...authHeader(who.me!.token));
    expect(res.body.employee.employeeCode).toBe(who.me!.employeeCode);
    for (const k of ["hr", "dev"]) {
      const r = await request(app).get("/api/employees/me/data-export").set(...authHeader(who[k]!.token));
      expect(r.status).toBe(200);
      expect(r.body.employee.employeeCode).toBe(who[k]!.employeeCode);
      expect(JSON.stringify(r.body)).not.toContain(who.me!.employeeCode);
    }
    expect((await request(app).get("/api/employees/me/data-export")).status).toBe(401);
  });
});
