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
  clearRateLimits,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  loginAs,
  TEST_PASSWORD,
  type TestOrgMasters,
} from "../../employee/__tests__/employeeTestHelpers";

// A-9 G7 (docs/plans/GREYTHR_PARITY_EMPLOYEE_ADMIN.md, items 10 and 17): separation modes as company data, and turning a person's portal access off and on.

type Person = Awaited<ReturnType<typeof createFullTestEmployee>>;

describe("A-9 G7 — separation modes and portal access", () => {
  let org: TestOrgMasters;
  const p: Record<string, Person> = {};
  const tok: Record<string, string> = {};
  const modeIds: string[] = [];
  let sepId: string;
  const call = (who: string, method: "get" | "post" | "patch", path: string, body?: object) => request(app)[method](path).set(...authHeader(tok[who]!)).send(body);

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    p.director = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.director2 = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.dev = await createFullTestEmployee(org, { roleCode: DEVELOPER_ROLE_CODE });
    p.emp = await createFullTestEmployee(org);
    p.leaver = await createFullTestEmployee(org);
    for (const k of Object.keys(p)) tok[k] = await loginAs(p[k]!.employeeCode);
    sepId = (await prisma.separation.create({ data: { employeeId: p.leaver.employeeId, lastWorkingDate: new Date("2031-12-31"), reason: "made-up", initiatedByUserId: p.hr.userId } })).id;
  }, 120_000);

  afterAll(async () => {
    await prisma.separation.deleteMany({ where: { id: sepId } });
    await deleteWithDependents("SeparationMode", modeIds);
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  }, 120_000);

  it("modes are Not set until the company makes its list; HR (org.manage) keeps the list; the Developer and an employee are refused", async () => {
    expect((await call("hr", "get", "/api/separation-modes")).body.modes.filter((m: { code: string }) => m.code.startsWith("A9_"))).toEqual([]);
    for (const who of ["dev", "emp"]) {
      expect((await call(who, "get", "/api/separation-modes")).status, who).toBe(403);
      expect((await call(who, "post", "/api/separation-modes", { code: "A9_X", label: "x" })).status, who).toBe(403);
      expect((await call(who, "post", `/api/separation-modes/separations/${sepId}`, { modeId: null, reason: "nope nope" })).status, who).toBe(403);
      expect((await call(who, "get", "/api/separation-modes/by-separation")).status, who).toBe(403);
    }
    const made = await call("hr", "post", "/api/separation-modes", { code: `A9_RESIGN_${Date.now() % 100000}`, label: "Resignation (test)" });
    expect(made.status).toBe(201);
    modeIds.push(made.body.id);
    expect((await call("hr", "post", "/api/separation-modes", { code: made.body.code, label: "again" })).status).toBe(409);
    expect((await call("hr", "post", `/api/separation-modes/separations/${sepId}`, { modeId: made.body.id, reason: "x" })).status).toBe(400); // a reason
    const set = await call("hr", "post", `/api/separation-modes/separations/${sepId}`, { modeId: made.body.id, reason: "letter received" });
    expect(set.body).toEqual({ id: sepId, modeId: made.body.id });
    expect((await call("hr", "get", "/api/separation-modes/by-separation")).body.modes[sepId]).toMatchObject({ label: "Resignation (test)" });
    expect(await prisma.auditLog.count({ where: { action: "separation.mode.set", entityId: sepId } })).toBe(1);
    // Switched off: kept on the separation, not offered again, cannot be chosen.
    expect((await call("hr", "patch", `/api/separation-modes/${made.body.id}`, { isActive: false })).body.isActive).toBe(false);
    expect((await call("hr", "get", "/api/separation-modes")).body.modes.map((m: { id: string }) => m.id)).not.toContain(made.body.id);
    expect((await call("hr", "post", `/api/separation-modes/separations/${sepId}`, { modeId: made.body.id, reason: "again please" })).status).toBe(200); // unchanged: no-op
    expect((await call("hr", "post", `/api/separation-modes/separations/${sepId}`, { modeId: null, reason: "not known yet" })).body.modeId).toBeNull();
    expect((await call("hr", "post", `/api/separation-modes/separations/${sepId}`, { modeId: made.body.id, reason: "back again" })).status).toBe(400);
  });

  it("portal access: HR, the Developer and an employee cannot turn it off; a director can, with a reason; the person is signed out and refused until it is back on", async () => {
    const target = p.emp!.employeeId;
    for (const who of ["hr", "dev", "emp"]) expect((await call(who, "post", `/api/access/employees/${target}/portal-access`, { enabled: false, reason: "testing this" })).status, who).toBe(403);
    expect((await call("director", "post", `/api/access/employees/${target}/portal-access`, { enabled: false })).status).toBe(400);
    const off = await call("director", "post", `/api/access/employees/${target}/portal-access`, { enabled: false, reason: "on long leave" });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect((await call("emp", "get", "/api/auth/me")).status).toBe(401); // the very next request
    expect(await prisma.refreshToken.count({ where: { userId: p.emp!.userId, revokedAt: null } })).toBe(0); // signed out everywhere
    await clearRateLimits();
    expect((await request(app).post("/api/auth/login").send({ employeeCode: p.emp!.employeeCode, password: TEST_PASSWORD })).status).not.toBe(200);
    expect((await call("director", "post", `/api/access/employees/${target}/portal-access`, { enabled: false, reason: "twice over" })).body.error.code).toBe("WRONG_STATUS");
    expect((await call("director", "post", `/api/access/employees/${target}/portal-access`, { enabled: true, reason: "back from leave" })).status).toBe(200);
    tok.emp = await loginAs(p.emp!.employeeCode);
    expect((await call("emp", "get", "/api/auth/me")).status).toBe(200);
    const audit = await prisma.auditLog.findMany({ where: { action: { in: ["user.portal_access.disabled", "user.portal_access.enabled"] }, entityId: p.emp!.userId }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => a.action)).toEqual(["user.portal_access.disabled", "user.portal_access.enabled"]);
  });

  it("a director's own access only by another director, never your own", async () => {
    expect((await call("director", "post", `/api/access/employees/${p.director!.employeeId}/portal-access`, { enabled: false, reason: "myself" })).body.error.code).toBe("SELF");
    const other = await call("director2", "post", `/api/access/employees/${p.director!.employeeId}/portal-access`, { enabled: false, reason: "made-up test" });
    expect(other.status, JSON.stringify(other.body)).toBe(200);
    await call("director2", "post", `/api/access/employees/${p.director!.employeeId}/portal-access`, { enabled: true, reason: "made-up test" });
  });
});
