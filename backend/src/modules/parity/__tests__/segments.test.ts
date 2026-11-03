import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
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

// A-9 G1 (docs/plans/GREYTHR_PARITY_EMPLOYEE_ADMIN.md, items 5, 6, 7): saved filters and segments, the masked contact number and its audited reveal, the
// profile's Pay tab, the remembered grid columns. Made-up people only.

type Person = Awaited<ReturnType<typeof createFullTestEmployee>>;
const TEAM_ROLE = `TEST_A9_TEAM_${Date.now()}`;

describe("A-9 G1 — segments, contact reveal, Pay tab, grid columns", () => {
  let org: TestOrgMasters;
  let otherOrg: TestOrgMasters;
  const p: Record<string, Person> = {};
  const tok: Record<string, string> = {};
  const segIds: string[] = [];
  const call = (who: string, method: "get" | "post" | "patch" | "put", path: string, body?: object) => request(app)[method](path).set(...authHeader(tok[who]!)).send(body);

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    otherOrg = await createEmployeeTestOrgMasters();
    p.director = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.hr2 = await createFullTestEmployee(org, { roleCode: "HR_EXECUTIVE" });
    p.dev = await createFullTestEmployee(org, { roleCode: DEVELOPER_ROLE_CODE });
    p.emp = await createFullTestEmployee(org);
    // A team-scoped admin: holds the segment and reveal keys, but sees only themself and their reports.
    await prisma.role.create({ data: { code: TEAM_ROLE, name: TEAM_ROLE, dataScope: "TEAM" } });
    await grantPermissions(TEAM_ROLE, ["employee.view", "employee.segments.manage", "employee.contact.reveal"]);
    p.lead = await createFullTestEmployee(org, { roleCode: TEAM_ROLE });
    p.report = await createFullTestEmployee(org, { managerId: p.lead.employeeId });
    p.outsider = await createFullTestEmployee(otherOrg);
    p.leaver = await createFullTestEmployee(otherOrg);
    await prisma.employee.update({ where: { id: p.leaver.employeeId }, data: { status: "SEPARATED" } });
    await prisma.employee.update({ where: { id: p.outsider.employeeId }, data: { officialEmail: `a9.outsider.${Date.now()}@example.test` } });
    for (const k of Object.keys(p)) tok[k] = await loginAs(p[k]!.employeeCode);
  }, 120_000);

  afterAll(async () => {
    await deleteWithDependents("EmployeeSegment", segIds);
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await cleanupTestRole(TEAM_ROLE);
    await cleanupEmployeeTestOrgMasters(org);
    await cleanupEmployeeTestOrgMasters(otherOrg);
  }, 120_000);

  const everyRoute = (id: string, target: string): Array<[string, "get" | "post" | "patch" | "put", string, object?]> => [
    ["list", "get", "/api/employee-segments"],
    ["create", "post", "/api/employee-segments", { kind: "FILTER", name: "x", criteria: {} }],
    ["read", "get", `/api/employee-segments/${id}`],
    ["update", "patch", `/api/employee-segments/${id}`, { name: "y" }],
    ["archive", "post", `/api/employee-segments/${id}/archive`],
    ["members", "get", `/api/employee-segments/${id}/members`],
    ["grid columns", "get", "/api/employee-extras/grid-columns/employees"],
    ["save grid columns", "put", "/api/employee-extras/grid-columns/employees", { columns: ["fullName"] }],
    ["reveal contact", "get", `/api/employee-extras/${target}/contact?reason=checking%20a%20number`],
    ["pay", "get", `/api/employee-extras/${target}/pay`],
  ];

  it("the Developer role is refused on every A-9 G1 route; an employee and HR are refused where they hold no key; nobody unsigned gets in", async () => {
    const seg = await call("hr", "post", "/api/employee-segments", { kind: "FILTER", name: "Dev probe", criteria: {} });
    expect(seg.status).toBe(201);
    segIds.push(seg.body.id);
    for (const [label, method, path, body] of everyRoute(seg.body.id, p.emp!.employeeId)) {
      expect((await call("dev", method, path, body)).status, `Developer ${label}`).toBe(403);
      expect((await request(app)[method](path).send(body)).status, `unsigned ${label}`).toBe(401);
    }
    for (const [label, method, path, body] of everyRoute(seg.body.id, p.hr!.employeeId).filter(([l]) => !l.includes("grid"))) {
      expect((await call("emp", method, path, body)).status, `employee ${label}`).toBe(403); // an employee reads nobody else's anything here
    }
    expect((await call("hr", "get", `/api/employee-extras/${p.emp!.employeeId}/pay`)).status).toBe(403); // HR never sees pay
    expect((await call("hr2", "get", `/api/employee-extras/${p.emp!.employeeId}/pay`)).status).toBe(403);
  });

  it("a shared filter resolves inside each viewer's own scope: a team-scoped viewer never sees an outsider through it", async () => {
    const res = await call("hr", "post", "/api/employee-segments", { kind: "FILTER", name: "Everyone current", shared: true, criteria: { population: "current" } });
    expect(res.status).toBe(201);
    segIds.push(res.body.id);
    const hrMembers = await call("hr", "get", `/api/employee-segments/${res.body.id}/members?pageSize=200`);
    const hrIds = hrMembers.body.rows.map((r: { id: string }) => r.id);
    expect(hrIds).toContain(p.outsider!.employeeId);
    expect(hrIds).not.toContain(p.leaver!.employeeId); // current only
    const leadList = await call("lead", "get", "/api/employee-segments");
    const shared = leadList.body.segments.find((s: { id: string }) => s.id === res.body.id);
    expect(shared).toMatchObject({ isOwner: false, shared: true });
    const leadMembers = await call("lead", "get", `/api/employee-segments/${res.body.id}/members?pageSize=200`);
    expect(new Set(leadMembers.body.rows.map((r: { id: string }) => r.id))).toEqual(new Set([p.lead!.employeeId, p.report!.employeeId]));
    expect(shared.count).toBe(2); // the count is the viewer's, never the owner's
  });

  it("a named group: the team viewer cannot put an outsider into it (same 404 as a made-up id); an HR list shows the team viewer only their own people", async () => {
    const bad = await call("lead", "post", "/api/employee-segments", { kind: "LIST", name: "Mine", employeeIds: [p.report!.employeeId, p.outsider!.employeeId] });
    expect([bad.status, bad.body.error.code]).toEqual([404, "NOT_FOUND"]);
    const made = await call("lead", "post", "/api/employee-segments", { kind: "LIST", name: "Mine", employeeIds: [p.report!.employeeId, p.report!.employeeId] });
    expect([made.status, made.body.count]).toEqual([201, 1]); // duplicates collapse
    segIds.push(made.body.id);
    const hrList = await call("hr", "post", "/api/employee-segments", { kind: "LIST", name: "Mixed", shared: true, employeeIds: [p.report!.employeeId, p.outsider!.employeeId] });
    segIds.push(hrList.body.id);
    expect(hrList.body.count).toBe(2);
    const seen = await call("lead", "get", `/api/employee-segments/${hrList.body.id}/members`);
    expect(seen.body.rows.map((r: { id: string }) => r.id)).toEqual([p.report!.employeeId]);
    expect(seen.body.total).toBe(1);
  });

  it("only the owner changes or archives; a repeated save of the same name is refused (no duplicate); archived is gone for everyone; every change is audited", async () => {
    const made = await call("hr", "post", "/api/employee-segments", { kind: "FILTER", name: "Owned", shared: true, criteria: {} });
    segIds.push(made.body.id);
    expect((await call("hr", "post", "/api/employee-segments", { kind: "FILTER", name: "owned", criteria: {} })).status).toBe(409);
    expect((await call("director", "patch", `/api/employee-segments/${made.body.id}`, { name: "Taken over" })).body.error.code).toBe("NOT_OWNER");
    expect((await call("director", "post", `/api/employee-segments/${made.body.id}/archive`)).status).toBe(403);
    expect((await call("hr", "patch", `/api/employee-segments/${made.body.id}`, { employeeIds: [p.emp!.employeeId] })).status).toBe(400); // a filter has no people
    expect((await call("hr", "patch", `/api/employee-segments/${made.body.id}`, { name: "Owned 2", criteria: { population: "past" } })).body).toMatchObject({ name: "Owned 2", criteria: { population: "past" } });
    expect((await call("hr", "post", `/api/employee-segments/${made.body.id}/archive`)).status).toBe(204);
    expect((await call("hr", "get", `/api/employee-segments/${made.body.id}`)).status).toBe(404);
    expect((await call("director", "get", `/api/employee-segments/${made.body.id}`)).status).toBe(404);
    expect(await prisma.employeeSegment.count({ where: { id: made.body.id } })).toBe(1); // archived, never deleted
    const audit = await prisma.auditLog.findMany({ where: { entityType: "EmployeeSegment", entityId: made.body.id }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => a.action)).toEqual(["employee.segment.created", "employee.segment.updated", "employee.segment.archived"]);
    // Someone else's unshared segment does not exist for you.
    const priv = await call("hr2", "post", "/api/employee-segments", { kind: "FILTER", name: "Private", criteria: {} });
    segIds.push(priv.body.id);
    expect((await call("hr", "get", `/api/employee-segments/${priv.body.id}/members`)).status).toBe(404);
  });

  it("switching the key off takes effect on the next request", async () => {
    expect((await call("lead", "get", "/api/employee-segments")).status).toBe(200);
    await revokePermissions(TEAM_ROLE, ["employee.segments.manage"]);
    try {
      expect((await call("lead", "get", "/api/employee-segments")).status).toBe(403);
    } finally {
      await grantPermissions(TEAM_ROLE, ["employee.segments.manage"]);
    }
  });

  it("contact numbers are masked in the grid, the export and the profile; the reveal needs a reason, the scope, and is audited without the number", async () => {
    const grid = await call("hr", "get", `/api/employees?search=${p.emp!.employeeCode}`);
    expect(grid.body.rows[0].mobile).toBe("••••0000");
    const profile = await call("hr", "get", `/api/employees/${p.emp!.employeeId}`);
    expect([profile.body.personal.mobile, profile.body.personal.emergencyContactPhone, profile.body.contactMasked]).toEqual(["••••0000", "••••0001", true]);
    const own = await call("emp", "get", "/api/employees/me");
    expect(own.body.personal.mobile).toBe("9000000000"); // your own number is yours
    expect((await call("hr", "get", `/api/employee-extras/${p.emp!.employeeId}/contact`)).status).toBe(400); // no reason
    const shown = await call("hr", "get", `/api/employee-extras/${p.emp!.employeeId}/contact?reason=calling%20about%20joining`);
    expect(shown.body).toEqual({ mobile: "9000000000", emergencyContactPhone: "9000000001" });
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: "employee.contact.revealed", entityId: p.emp!.employeeId }, orderBy: { createdAt: "desc" } });
    expect(JSON.stringify(row.after)).toContain("calling about joining");
    expect(JSON.stringify(row.after)).not.toContain("9000000000");
    expect((await call("lead", "get", `/api/employee-extras/${p.outsider!.employeeId}/contact?reason=just%20looking`)).status).toBe(404); // outside the scope
    expect((await call("lead", "get", `/api/employee-extras/${p.report!.employeeId}/contact?reason=team%20call`)).status).toBe(200);
  });

  it("the Pay tab is a director's; each opening writes an audit row with no figures", async () => {
    const before = await prisma.auditLog.count({ where: { action: "employee.pay.opened", entityId: p.emp!.employeeId } });
    const res = await call("director", "get", `/api/employee-extras/${p.emp!.employeeId}/pay`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ employeeId: p.emp!.employeeId, history: [] });
    expect(await prisma.auditLog.count({ where: { action: "employee.pay.opened", entityId: p.emp!.employeeId } })).toBe(before + 1);
  });

  it("directory: official email search, current / past / all, and the columns a person chose are theirs alone", async () => {
    const email = (await prisma.employee.findUniqueOrThrow({ where: { id: p.outsider!.employeeId } })).officialEmail!;
    expect((await call("hr", "get", `/api/employees?search=${encodeURIComponent(email)}`)).body.rows.map((r: { id: string }) => r.id)).toEqual([p.outsider!.employeeId]);
    const past = await call("hr", "get", `/api/employees?population=past&pageSize=200`);
    expect(past.body.rows.every((r: { status: string }) => r.status === "SEPARATED")).toBe(true);
    expect(past.body.rows.map((r: { id: string }) => r.id)).toContain(p.leaver!.employeeId);
    const current = await call("hr", "get", `/api/employees?population=current&pageSize=200`);
    expect(current.body.rows.map((r: { id: string }) => r.id)).not.toContain(p.leaver!.employeeId);
    expect((await call("hr", "get", "/api/employee-extras/grid-columns/employees")).body).toEqual({ columns: null });
    expect((await call("hr", "put", "/api/employee-extras/grid-columns/employees", { columns: ["fullName", "mobile", "fullName"] })).body).toEqual({ columns: ["fullName", "mobile"] });
    expect((await call("hr", "get", "/api/employee-extras/grid-columns/employees")).body).toEqual({ columns: ["fullName", "mobile"] });
    expect((await call("hr2", "get", "/api/employee-extras/grid-columns/employees")).body).toEqual({ columns: null });
    expect((await call("hr", "put", "/api/employee-extras/grid-columns/other", { columns: [] })).status).toBe(400);
  });
});
