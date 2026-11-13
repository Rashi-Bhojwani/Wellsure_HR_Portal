import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { POLICY_SETTINGS } from "@shared/constants/policySettings";
import { policyInForce } from "../service";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupFullTestEmployee,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  loginAs,
  type TestOrgMasters,
} from "../../employee/__tests__/employeeTestHelpers";
import { setPolicy, resetPolicy } from "./policyTestHelpers";

// M session block 2: the policy settings. plain = a default in force; activation = no effect until turned on by one director and confirmed by another.
describe("policy settings", () => {
  let org: TestOrgMasters;
  const ids: string[] = [];
  const t: Record<string, string> = {};
  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    for (const [k, roleCode] of [["d1", "SUPER_ADMIN"], ["d2", "SUPER_ADMIN"], ["hr", "HR_ADMIN"], ["emp", undefined], ["dev", DEVELOPER_ROLE_CODE], ["mgr", "MANAGER"]] as const) {
      const e = await createFullTestEmployee(org, roleCode ? { roleCode } : {});
      ids.push(e.employeeId);
      t[k] = await loginAs(e.employeeCode);
    }
  });
  afterAll(async () => {
    await resetPolicy("policy.probation", t.d1!, t.d2!);
    await resetPolicy("policy.overtime", t.d1!, t.d2!);
    for (const id of ids) await cleanupFullTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("lists every setting with its label: a default, off until turned on, or Not set", async () => {
    const res = await request(app).get("/api/policy-settings").set(...authHeader(t.d1!));
    expect(res.status).toBe(200);
    expect(res.body.settings.map((s: { key: string }) => s.key)).toEqual(POLICY_SETTINGS.map((s) => s.key));
    const by = Object.fromEntries(res.body.settings.map((s: { key: string }) => [s.key, s]));
    expect(by["policy.probation"]).toMatchObject({ state: "DEFAULT", label: "Default, change in settings", value: { months: 3 } });
    expect(by["policy.overtime"]).toMatchObject({ state: "INACTIVE", active: false, suggestion: { minimumMinutes: 60 } });
    expect(by["policy.retention"]).toMatchObject({ state: "NOT_SET", label: "Not set", value: null });
  });

  it("HR, an employee, a manager and the Developer are refused", async () => {
    for (const who of ["hr", "emp", "mgr", "dev"]) {
      expect((await request(app).get("/api/policy-settings").set(...authHeader(t[who]!))).status, who).toBe(403);
      expect((await request(app).post("/api/policy-settings/policy.probation/proposals").set(...authHeader(t[who]!)).send({ value: { months: 6, reminderDays: 15 }, reason: "Try" })).status, who).toBe(403);
    }
  });

  it("an activation setting has no effect until another director confirms it on", async () => {
    expect(await policyInForce("policy.overtime")).toBeNull();
    const p = await request(app).post("/api/policy-settings/policy.overtime/proposals").set(...authHeader(t.d1!)).send({ value: { active: true, minimumMinutes: 60, roundToMinutes: 30, approver: "DIRECTOR" }, reason: "Turn on overtime" });
    expect(p.status).toBe(201);
    expect(await policyInForce("policy.overtime")).toBeNull();
    expect((await request(app).post(`/api/policy-settings/proposals/${p.body.id}/confirm`).set(...authHeader(t.d1!))).body.error.code).toBe("CHECKER_IS_MAKER");
    expect(await policyInForce("policy.overtime")).toBeNull();
    expect((await request(app).post(`/api/policy-settings/proposals/${p.body.id}/confirm`).set(...authHeader(t.d2!))).status).toBe(200);
    expect(await policyInForce("policy.overtime")).toMatchObject({ active: true, approver: "DIRECTOR" });
    expect(await prisma.auditLog.count({ where: { action: "settings.policy.confirmed", entityId: p.body.id } })).toBe(1);
    // Turned off again: no effect.
    await setPolicy("policy.overtime", { active: false, minimumMinutes: 60, roundToMinutes: 30, approver: "DIRECTOR" }, t.d1!, t.d2!);
    expect(await policyInForce("policy.overtime")).toBeNull();
  });

  it("a plain setting changes only once confirmed; values are validated; behaviours cannot confirm a policy proposal", async () => {
    expect((await request(app).post("/api/policy-settings/policy.probation/proposals").set(...authHeader(t.d1!)).send({ value: { months: 99, reminderDays: 15 }, reason: "Too long" })).status).toBe(400);
    expect((await request(app).post("/api/policy-settings/policy.onboarding/proposals").set(...authHeader(t.d1!)).send({ value: { items: ["BOSS | 1 | x"] }, reason: "Bad line" })).status).toBe(400);
    const p = await request(app).post("/api/policy-settings/policy.probation/proposals").set(...authHeader(t.d1!)).send({ value: { months: 6, reminderDays: 20 }, reason: "Six months" });
    expect(await policyInForce("policy.probation")).toMatchObject({ months: 3 });
    expect((await request(app).post(`/api/behaviours/proposals/${p.body.id}/confirm`).set(...authHeader(t.d2!))).status).toBe(404);
    expect((await request(app).post(`/api/policy-settings/proposals/${p.body.id}/confirm`).set(...authHeader(t.d2!))).status).toBe(200);
    expect(await policyInForce("policy.probation")).toMatchObject({ months: 6, reminderDays: 20 });
  });
});
