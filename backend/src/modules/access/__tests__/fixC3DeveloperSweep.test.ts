import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEVELOPER_FORBIDDEN_KEYS, DEVELOPER_ROLE_PERMISSIONS, DEVELOPER_WRITE_FORBIDDEN } from "@shared/constants/sensitiveData";
import { DEVELOPER_SELF_SERVICE, developerWriteRefused } from "../../../lib/developerFirewall";
import { resolveAccess } from "../../../lib/permissions";
import { prisma } from "../../../lib/prisma";
import { SYSTEM_ROLES } from "../../../lib/systemRoles";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { listApiRoutes } from "../../managers/__tests__/routeList";

// FIX-C3/H5/M7 (independent audit 2026-11-20): the Developer role keeps view and diagnostics only. The audit's Developer gave themselves 30 days of paid
// leave through Import, could read import batches carrying personal and bank details, and could change attendance policy, rosters and processing.

/** Routes that never pass through authenticate (machine credentials, public links, sign-in itself): the Developer firewall is not where they are guarded. */
const NOT_SIGNED_IN = [/^\/api\/auth\//, /^\/api\/biometric\/agent/, /^\/api\/public\//, /^\/api\/joining\//, /^\/api\/letter-check/, /^\/iclock/];
const concrete = (p: string) => p.replace(/:([A-Za-z]+)/g, "zz-missing-0000");

describe("FIX-C3/H5/M7: the Developer role is view and diagnostics only", () => {
  let org: TestOrgMasters;
  let dev: { employeeId: string; employeeCode: string; userId: string };
  let token: string;

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    dev = await createFullTestEmployee(org, { roleCode: "DEVELOPER" });
    token = await loginAs(dev.employeeCode);
  });
  afterAll(async () => {
    await cleanupFullTestEmployee(dev.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("the default Developer permissions hold no write or import key, and every such key is forbidden to a Developer", () => {
    for (const key of ["import.manage", "import.details.manage", "attendance.config.manage", "attendance.process", "attendance.roster.manage", "org.manage", "leave.grant", "employee.edit"]) {
      expect(DEVELOPER_ROLE_PERMISSIONS).not.toContain(key);
      expect(DEVELOPER_FORBIDDEN_KEYS).toContain(key);
    }
    const role = SYSTEM_ROLES.find((r) => r.code === "DEVELOPER")!;
    for (const key of role.permissions) expect(DEVELOPER_WRITE_FORBIDDEN as readonly string[]).not.toContain(key);
  });

  it("a write key stored on the Developer role, or granted to a Developer personally, never resolves", async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: "DEVELOPER" } });
    const perm = await prisma.permission.findUniqueOrThrow({ where: { key: "import.manage" } });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
    try {
      const access = await resolveAccess(dev.userId);
      expect(access.permissions.has("import.manage")).toBe(false);
      for (const k of DEVELOPER_WRITE_FORBIDDEN) expect(access.permissions.has(k)).toBe(false);
    } finally {
      await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } } });
    }
  });

  it("the audit's attack: the Developer cannot download the leave-grants template, upload it, or commit a batch", async () => {
    expect((await request(app).get("/api/import/leave-grants/template").set(...authHeader(token))).status).toBe(403);
    expect((await request(app).post("/api/import/leave-grants/upload").set(...authHeader(token)).attach("file", Buffer.from("x"), "g.xlsx")).status).toBe(403);
    expect((await request(app).post("/api/import/batches/zz-missing-0000/commit").set(...authHeader(token)).send({})).status).toBe(403);
    expect((await request(app).post("/api/leave/grants").set(...authHeader(token)).send({ employeeId: dev.employeeId, leaveTypeId: "x", days: 30, entryDate: "2026-06-01" })).status).toBe(403);
  });

  it("H5: the Developer reads no import batch, preview, error report or uploaded file", async () => {
    for (const path of ["/api/import/batches", "/api/import/batches/zz-missing-0000", "/api/import/batches/zz-missing-0000/error-report", "/api/import/reconciliation", "/api/update-import/waiting", "/api/update-import/zz-missing-0000", "/api/recruitment/joining-documents/zz-missing-0000/file", "/api/autofill/documents/zz-missing-0000/file", "/api/biometric/batches"]) {
      const res = await request(app).get(path).set(...authHeader(token));
      expect(res.status, path).toBe(403);
    }
  });

  it("walks EVERY write route the API serves: as the Developer each one is refused with 403, except the person's own self-service", async () => {
    const routes = listApiRoutes().map((r) => r.id).filter((id) => !id.startsWith("GET "));
    expect(routes.length).toBeGreaterThan(300);
    const notRefused: string[] = [];
    let checked = 0;
    for (const id of routes) {
      const [method, path] = id.split(" ") as [string, string];
      if (NOT_SIGNED_IN.some((re) => re.test(path))) continue;
      if (!developerWriteRefused(["DEVELOPER", "EMPLOYEE"], method, path)) continue; // self-service: listed with its reason in DEVELOPER_SELF_SERVICE
      const res = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[method.toLowerCase()]!(concrete(path)).set(...authHeader(token)).send({});
      checked += 1;
      if (res.status !== 403) notRefused.push(`${id} -> ${res.status}`);
    }
    expect(notRefused).toEqual([]);
    expect(checked).toBeGreaterThan(300);
  });

  it("every self-service entry says why it is the person's own record", () => {
    for (const e of DEVELOPER_SELF_SERVICE) expect(e.why.length).toBeGreaterThan(5);
    expect(developerWriteRefused(["DEVELOPER"], "POST", "/api/leave/requests")).toBe(false);
    expect(developerWriteRefused(["DEVELOPER"], "POST", "/api/leave/grants")).toBe(true);
    expect(developerWriteRefused(["DEVELOPER", "SUPER_ADMIN"], "POST", "/api/leave/grants")).toBe(false);
    expect(developerWriteRefused(["DEVELOPER"], "GET", "/api/employees")).toBe(false);
  });
});
