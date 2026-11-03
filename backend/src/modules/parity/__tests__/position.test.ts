import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { businessToday } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupFullTestEmployee,
  cleanupTestRole,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  grantPermissions,
  loginAs,
  revokePermissions,
  type TestOrgMasters,
} from "../../employee/__tests__/employeeTestHelpers";

// A-9 G2 (docs/plans/GREYTHR_PARITY_EMPLOYEE_ADMIN.md, item 9): position history per attribute, changed only through the existing writers, with a reason.

type Person = Awaited<ReturnType<typeof createFullTestEmployee>>;
const TEAM_ROLE = `TEST_A9_POS_${Date.now()}`;
const addDays = (n: number) => new Date(businessToday().getTime() + n * 86_400_000).toISOString().slice(0, 10); // allow-number: a day count in a test

describe("A-9 G2 — position history", () => {
  let org: TestOrgMasters;
  let otherOrg: TestOrgMasters;
  let shiftId: string;
  const p: Record<string, Person> = {};
  const tok: Record<string, string> = {};
  const call = (who: string, method: "get" | "post", path: string, body?: object) => request(app)[method](path).set(...authHeader(tok[who]!)).send(body);
  const attr = (body: { attributes: Array<{ key: string }> }, key: string) => body.attributes.find((a) => a.key === key) as unknown as { current: { value: string; valueId: string | null } | null; entries: Array<{ value: string; status: string; reason: string | null; effectiveFrom: string }> };

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    otherOrg = await createEmployeeTestOrgMasters();
    shiftId = (await prisma.shift.create({ data: { code: `A9P${Date.now() % 100000}`, name: "A-9 late shift", startTime: "12:00", endTime: "21:00", sessions: { create: [{ sortOrder: 1, kind: "WORK", label: "Day", startTime: "12:00", endTime: "21:00" }] } } })).id;
    p.director = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.hrAdmin = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.hrExec = await createFullTestEmployee(org, { roleCode: "HR_EXECUTIVE" });
    p.dev = await createFullTestEmployee(org, { roleCode: DEVELOPER_ROLE_CODE });
    p.emp = await createFullTestEmployee(org);
    await prisma.role.create({ data: { code: TEAM_ROLE, name: TEAM_ROLE, dataScope: "TEAM" } });
    await grantPermissions(TEAM_ROLE, ["employee.view", "employee.edit"]);
    p.lead = await createFullTestEmployee(org, { roleCode: TEAM_ROLE });
    p.target = await createFullTestEmployee(org, { managerId: p.lead.employeeId });
    for (const k of Object.keys(p)) tok[k] = await loginAs(p[k]!.employeeCode);
    // HR Executive's role may carry attendance.config.manage from an earlier local run; the test needs it without.
    await revokePermissions("HR_EXECUTIVE", ["attendance.config.manage"]);
  }, 120_000);

  afterAll(async () => {
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await deleteWithDependents("Shift", [shiftId]);
    await cleanupTestRole(TEAM_ROLE);
    await cleanupEmployeeTestOrgMasters(org);
    await cleanupEmployeeTestOrgMasters(otherOrg);
  }, 120_000);

  it("the Developer role, an employee and an unsigned caller are refused; HR without the shift key cannot change a shift", async () => {
    const target = p.target!.employeeId;
    const change = { attribute: "department", valueId: otherOrg.departmentId, effectiveFrom: addDays(1), reason: "moving teams" };
    for (const who of ["dev", "emp"]) {
      expect((await call(who, "get", `/api/employee-extras/${target}/position`)).status, who).toBe(403);
      expect((await call(who, "post", `/api/employee-extras/${target}/position`, change)).status, who).toBe(403);
    }
    expect((await request(app).get(`/api/employee-extras/${target}/position`)).status).toBe(401);
    const shift = await call("hrExec", "post", `/api/employee-extras/${target}/position`, { attribute: "shift", valueId: shiftId, effectiveFrom: addDays(1), reason: "later hours" });
    expect([shift.status, shift.body.error.code]).toEqual([403, "FORBIDDEN"]);
  });

  it("a card per attribute shows the current value; a change is a new dated entry through the existing writer, needs a reason, keeps every earlier row and is audited", async () => {
    const target = p.target!.employeeId;
    const before = await call("hrExec", "get", `/api/employee-extras/${target}/position`);
    expect(before.status).toBe(200);
    expect(before.body.attributes.map((a: { key: string }) => a.key)).toEqual(["department", "designation", "location", "grade", "costCentre", "shift"]);
    expect(attr(before.body, "department").current?.valueId).toBe(org.departmentId);
    expect(before.body.division.built).toBe(false);
    const rowsBefore = await prisma.employeeJobHistory.count({ where: { employeeId: target } });

    expect((await call("hrExec", "post", `/api/employee-extras/${target}/position`, { attribute: "department", valueId: otherOrg.departmentId, effectiveFrom: addDays(5) })).status).toBe(400); // no reason
    const moved = await call("hrExec", "post", `/api/employee-extras/${target}/position`, { attribute: "department", valueId: otherOrg.departmentId, effectiveFrom: addDays(5), reason: "moving to the other branch team" });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    const dept = attr(moved.body, "department");
    expect(dept.current?.valueId).toBe(org.departmentId); // still the current one until the day
    expect(dept.entries[0]).toMatchObject({ status: "scheduled", effectiveFrom: addDays(5), reason: "moving to the other branch team" });
    expect(attr(moved.body, "grade").entries).toHaveLength(1); // a department move is not a grade change
    expect(await prisma.employeeJobHistory.count({ where: { employeeId: target } })).toBe(rowsBefore + 1); // append, never overwrite
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "employee.job.changed", entityId: target }, orderBy: { createdAt: "desc" } });
    expect(JSON.stringify(audit.after)).toContain(otherOrg.departmentId);

    const grade = await call("hrExec", "post", `/api/employee-extras/${target}/position`, { attribute: "grade", valueId: null, effectiveFrom: addDays(5), reason: "grade withdrawn" });
    expect(grade.status, JSON.stringify(grade.body)).toBe(200);
    expect(attr(grade.body, "grade").entries[0]).toMatchObject({ value: "Not set", status: "scheduled" });
  });

  it("the shift goes through the attendance writer: HR Admin may, nobody changes their own, and the history shows it", async () => {
    const target = p.target!.employeeId;
    const res = await call("hrAdmin", "post", `/api/employee-extras/${target}/position`, { attribute: "shift", valueId: shiftId, effectiveFrom: addDays(3), reason: "later hours" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(attr(res.body, "shift").entries[0]).toMatchObject({ value: "A-9 late shift", status: "scheduled", reason: "later hours" });
    expect(await prisma.auditLog.count({ where: { action: "attendance.assignment.changed", entityId: target } })).toBeGreaterThan(0);
    const own = await call("hrAdmin", "post", `/api/employee-extras/${p.hrAdmin!.employeeId}/position`, { attribute: "shift", valueId: shiftId, effectiveFrom: addDays(3), reason: "my own" });
    expect([own.status, own.body.error.code]).toEqual([403, "OWN_ATTENDANCE"]);
  });

  it("a team-scoped editor reaches their own people only (an outsider reads as not found); switching the key off is immediate", async () => {
    expect((await call("lead", "get", `/api/employee-extras/${p.target!.employeeId}/position`)).status).toBe(200);
    expect((await call("lead", "get", `/api/employee-extras/${p.emp!.employeeId}/position`)).status).toBe(404);
    const rows = await prisma.employeeJobHistory.count({ where: { employeeId: p.emp!.employeeId } });
    expect((await call("lead", "post", `/api/employee-extras/${p.emp!.employeeId}/position`, { attribute: "department", valueId: otherOrg.departmentId, effectiveFrom: addDays(2), reason: "not mine" })).status).toBe(404);
    expect(await prisma.employeeJobHistory.count({ where: { employeeId: p.emp!.employeeId } })).toBe(rows); // refused before anything was written
    await revokePermissions(TEAM_ROLE, ["employee.edit"]);
    expect((await call("lead", "get", `/api/employee-extras/${p.target!.employeeId}/position`)).status).toBe(403);
  });
});
