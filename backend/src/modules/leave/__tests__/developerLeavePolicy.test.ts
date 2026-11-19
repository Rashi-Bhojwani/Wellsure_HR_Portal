import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEVELOPER_FORBIDDEN_KEYS, DEVELOPER_ROLE_CODE, DEVELOPER_ROLE_PERMISSIONS } from "@shared/constants/sensitiveData";
import { resolveAccess } from "../../../lib/permissions";
import { prisma } from "../../../lib/prisma";
import { SYSTEM_ROLES } from "../../../lib/systemRoles";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";

// Final merge 2026-11-19 (docs/plans/FINAL_MERGE_REPORT.md, item 3c): leave.policy.manage is no longer the Developer's. It is out of the role's defaults, in
// DEVELOPER_FORBIDDEN_KEYS (so the access resolver removes it whatever is stored, and nobody can grant it), and every leave policy route answers the Developer
// with 403. HR keeps it. Made-up people.
const POLICY_ROUTES: Array<[method: "get" | "post" | "patch" | "put" | "delete", path: string, body?: object]> = [
  ["get", "/api/leave/types/all"],
  ["post", "/api/leave/types", { code: "ZZ", name: "Made-up type" }],
  ["patch", "/api/leave/types/x-type", { name: "Renamed" }],
  ["put", "/api/leave/types/x-type/policy", {}],
  ["post", "/api/holidays", { name: "Made-up holiday", date: "2031-01-02" }],
  ["patch", "/api/holidays/x-holiday", { name: "Renamed" }],
  ["delete", "/api/holidays/x-holiday"],
  ["post", "/api/restricted-holidays", { name: "Made-up RH", date: "2031-01-03" }],
  ["patch", "/api/restricted-holidays/x-holiday", { name: "Renamed" }],
  ["delete", "/api/restricted-holidays/x-holiday"],
  ["get", "/api/workforce/holidays/locations"],
  ["put", "/api/workforce/holidays/x-holiday/locations", { locationIds: [], reason: "testing" }],
];

describe("the Developer does not manage leave policies", () => {
  let org: TestOrgMasters;
  const p: Record<string, { employeeId: string; employeeCode: string; userId: string }> = {};
  const t: Record<string, string> = {};
  let overrideId: string | null = null;

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    for (const [k, roleCode] of [["d1", "SUPER_ADMIN"], ["hr", "HR_ADMIN"], ["dev", DEVELOPER_ROLE_CODE]] as const) {
      p[k] = await createFullTestEmployee(org, { roleCode });
      t[k] = await loginAs(p[k]!.employeeCode);
    }
  }, 120_000);

  afterAll(async () => {
    if (overrideId) await prisma.userPermissionOverride.deleteMany({ where: { id: overrideId } });
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  }, 120_000);

  it("the key is out of the Developer's defaults and in its forbidden keys; HR Admin keeps it", async () => {
    expect(DEVELOPER_ROLE_PERMISSIONS).not.toContain("leave.policy.manage");
    expect(SYSTEM_ROLES.find((r) => r.code === DEVELOPER_ROLE_CODE)!.permissions).not.toContain("leave.policy.manage");
    expect(DEVELOPER_FORBIDDEN_KEYS).toContain("leave.policy.manage");
    expect(SYSTEM_ROLES.find((r) => r.code === "HR_ADMIN")!.permissions).toContain("leave.policy.manage");
    const devRole = await prisma.role.findUniqueOrThrow({ where: { code: DEVELOPER_ROLE_CODE }, include: { permissions: { include: { permission: true } } } });
    expect(devRole.permissions.map((rp) => rp.permission.key)).not.toContain("leave.policy.manage"); // the migration took it off the stored role
    expect((await resolveAccess(p.dev!.userId)).permissions.has("leave.policy.manage")).toBe(false);
    expect((await resolveAccess(p.hr!.userId)).permissions.has("leave.policy.manage")).toBe(true);
  });

  it("a director cannot grant it to the Developer, and a grant stored anyway is ignored by the resolver", async () => {
    const res = await request(app).put(`/api/access/employees/${p.dev!.employeeId}/overrides/leave.policy.manage`).set(...authHeader(t.d1!)).send({ effect: "GRANT", reason: "testing the ceiling" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("DEVELOPER_CEILING");
    const perm = await prisma.permission.findUniqueOrThrow({ where: { key: "leave.policy.manage" } });
    overrideId = (await prisma.userPermissionOverride.create({ data: { userId: p.dev!.userId, permissionId: perm.id, effect: "GRANT", reason: "stored behind the service's back (test)", createdByUserId: p.d1!.userId } })).id;
    expect((await resolveAccess(p.dev!.userId)).permissions.has("leave.policy.manage")).toBe(false);
  });

  it("every leave policy route answers the Developer with 403; HR reaches them", async () => {
    const devToken = await loginAs(p.dev!.employeeCode); // after the stored grant above: still refused
    for (const [method, path, body] of POLICY_ROUTES) {
      const res = await request(app)[method](path).set(...authHeader(devToken)).send(body ?? {});
      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(403);
    }
    expect((await request(app).get("/api/leave/types/all").set(...authHeader(t.hr!))).status).toBe(200);
    expect((await request(app).get("/api/workforce/holidays/locations").set(...authHeader(t.hr!))).status).toBe(200);
  });
});
