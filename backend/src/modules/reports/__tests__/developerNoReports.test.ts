import { readFileSync } from "node:fs";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REPORT_KEYS } from "@shared/constants/reports";
import { DEVELOPER_ROLE_CODE, DEVELOPER_ROLE_PERMISSIONS } from "@shared/constants/sensitiveData";
import { prisma } from "../../../lib/prisma";
import { purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { ROUTE_CLASSIFICATION } from "../../managers/__tests__/routeInventory";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";

// Owners' decision (2026-11-14): every report is closed to the Developer. The Developer role holds no report key, an existing database loses the
// old grants (migration m_developer_no_reports, replayed below), and every report route in the route inventory refuses the Developer: the gallery,
// each report, each download and the report schedules. A report route added later is walked automatically.
const REPORT_KEYS_PERMS = ["reports.view", "reports.attendance.view", "reports.leave.view", "reports.salary.view", "reports.liability.view"];
const RANGE = "from=2026-10-01&to=2026-10-31&asOf=2026-10-31";
const MIGRATION = join(__dirname, "../../../../prisma/migrations/20261114090000_m_developer_no_reports/migration.sql");

describe("every report is closed to the Developer", () => {
  let org: TestOrgMasters;
  let dev: { employeeId: string; employeeCode: string; userId: string };
  let dir: { employeeId: string; employeeCode: string; userId: string };
  let devToken = "";
  let dirToken = "";

  const reportRoutes = Object.keys(ROUTE_CLASSIFICATION).filter((k) => / \/api\/(reports|payroll-reports)(\/|$)/.test(k));
  const concrete = (route: string): Array<[string, string]> => {
    const [method, path] = route.split(" ") as [string, string];
    const keys = path.includes(":key") ? [...REPORT_KEYS, "salary-register"] : [""];
    return keys.map((k) => [method.toLowerCase(), path.replace(":key", k).replace(":id", "sub-x") + (method === "GET" ? `?${RANGE}` : "")]);
  };

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    dev = await createFullTestEmployee(org, { roleCode: DEVELOPER_ROLE_CODE });
    dir = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    devToken = await loginAs(dev.employeeCode);
    dirToken = await loginAs(dir.employeeCode);
  });
  afterAll(async () => {
    await purgeAppendOnly("RolePermissionRemoval", { reason: { contains: "every report is closed to the Developer" } });
    await cleanupFullTestEmployee(dev.employeeId);
    await cleanupFullTestEmployee(dir.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("the Developer role's defaults hold no report key, and neither does the role in the database", async () => {
    for (const k of REPORT_KEYS_PERMS) expect(DEVELOPER_ROLE_PERMISSIONS as readonly string[], k).not.toContain(k);
    const held = await prisma.rolePermission.findMany({ where: { role: { code: DEVELOPER_ROLE_CODE } }, select: { permission: { select: { key: true } } } });
    expect(held.length).toBeGreaterThan(0);
    expect(held.map((h) => h.permission.key).filter((k) => k.startsWith("reports."))).toEqual([]);
  });

  it("the inventory has the report routes this test walks", () => {
    expect(reportRoutes).toEqual(expect.arrayContaining(["GET /api/reports", "GET /api/reports/:key", "GET /api/reports/:key/export", "GET /api/reports/subscriptions/mine", "POST /api/reports/subscriptions/mine", "DELETE /api/reports/subscriptions/mine/:id", "GET /api/payroll-reports/:key"]));
  });

  it("every report route, as the Developer, is refused with 403 (nothing read, nothing downloaded, nothing scheduled)", async () => {
    let walked = 0;
    for (const route of reportRoutes) {
      for (const [m, path] of concrete(route)) {
        const body = m === "post" ? { reportKey: "headcount", frequency: "WEEKLY" } : m === "put" ? { columns: [] } : undefined;
        const res = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[m]!(path).set(...authHeader(devToken)).send(body);
        expect(res.status, `${m.toUpperCase()} ${path}`).toBe(403);
        expect(res.headers["content-type"] ?? "", `${path} gives the Developer a file`).toContain("application/json");
        walked += 1;
      }
    }
    expect(walked).toBeGreaterThan(30);
    expect(await prisma.reportSubscription.count({ where: { userId: dev.userId } })).toBe(0);
  });

  it("a director still opens the reports (the control)", async () => {
    const res = await request(app).get("/api/reports").set(...authHeader(dirToken));
    expect(res.status).toBe(200);
    expect((await request(app).get(`/api/reports/headcount?${RANGE}`).set(...authHeader(dirToken))).status).toBe(200);
  });

  it("the migration removes the old grants from an existing database and records the removal", async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: DEVELOPER_ROLE_CODE } });
    const perms = await prisma.permission.findMany({ where: { key: { in: ["reports.view", "reports.attendance.view", "reports.leave.view"] } } });
    expect(perms).toHaveLength(3);
    // An existing database, as it was before the decision.
    await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
    expect((await request(app).get("/api/reports").set(...authHeader(await loginAs(dev.employeeCode)))).status).toBe(200);
    for (const stmt of readFileSync(MIGRATION, "utf8").replace(/^--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(stmt);
    expect(await prisma.rolePermission.count({ where: { roleId: role.id, permissionId: { in: perms.map((p) => p.id) } } })).toBe(0);
    const recorded = await prisma.rolePermissionRemoval.findMany({ where: { roleCode: DEVELOPER_ROLE_CODE, reason: { contains: "every report is closed to the Developer" } } });
    expect(recorded.map((r) => r.permissionKey).sort()).toEqual(["reports.attendance.view", "reports.leave.view", "reports.view"]);
    expect((await request(app).get("/api/reports").set(...authHeader(await loginAs(dev.employeeCode)))).status).toBe(403);
  });
});
