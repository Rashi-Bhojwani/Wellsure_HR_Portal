import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { HR_CAPABILITIES } from "@shared/constants/hrCapabilities";
import { HR_FORBIDDEN_KEYS, HR_ROLE_CODES } from "@shared/constants/sensitiveData";
import { closeHrCapabilityQueue } from "../../../jobs/hrCapabilityQueue";
import { purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { ensureAccessCatalog } from "../../../lib/accessCatalog";
import { resolveAccess } from "../../../lib/permissions";
import { prisma } from "../../../lib/prisma";
import { SYSTEM_ROLES } from "../../../lib/systemRoles";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { setSwitch } from "../../hrCapabilities/service";
import { setOverride, updateRole, type AccessActor } from "../service";

// After Checkpoint 1 the HR hard lock holds four more keys. For each: HR cannot hold it by default, by a role edit, by a personal grant, by the database, or by turning every HR switch on; and
// every route behind it answers 403 to HR (both roles), to a manager and to an employee, and does not answer 403 to a director.

const FOUR = ["user.security.manage", "import.manage", "letters.generate", "leave.yearend.manage"] as const;
const ID = "00000000-0000-4000-8000-000000000000";

describe("the four keys added to the HR hard lock", () => {
  let org: TestOrgMasters;
  const p = {} as Record<"director" | "hrAdmin" | "hrExec" | "manager" | "employee", { employeeId: string; employeeCode: string; userId: string }>;
  const tok = {} as Record<keyof typeof p, string>;
  const meta = () => ({ actorUserId: p.director.userId, ipAddress: null, userAgent: null });
  const actorOf = async (): Promise<AccessActor> => {
    const a = await resolveAccess(p.director.userId);
    return { userId: p.director.userId, employeeId: p.director.employeeId, roleCodes: a.roleCodes, permissions: a.permissions, dataScope: a.dataScope };
  };
  const keyId = async (key: string) => (await prisma.permission.findUniqueOrThrow({ where: { key } })).id;
  // Every route behind each key. The director's call is made on made-up ids or harmless inputs: it must simply not be refused on permission.
  const ROUTES: Record<(typeof FOUR)[number], Array<{ method: "get" | "post"; path: () => string; body?: object; directorSkips?: boolean }>> = {
    // Issuing a letter has a narrow key for HR (Issue letters without pay figures, narrowKeys / letters tests): what stays the directors' is reissuing and reproducing, which open the contents of an issued letter.
    "letters.generate": [
      { method: "post", path: () => `/api/letters/${ID}/reissue`, body: {} },
      { method: "post", path: () => `/api/letters/${ID}/reproduce` },
    ],
    // Importing has a narrow key for HR (non-pay datasets, no pay column); salary, bank and statutory stay the directors'.
    "import.manage": [
      { method: "get", path: () => "/api/import/bank/template" },
      { method: "get", path: () => "/api/import/statutory/template" },
    ],
    "leave.yearend.manage": [
      { method: "get", path: () => "/api/leave/year-end" },
      { method: "post", path: () => "/api/leave/year-end/preview", body: {} },
      { method: "get", path: () => `/api/leave/year-end/${ID}` },
      { method: "get", path: () => `/api/leave/year-end/${ID}/report` },
      { method: "post", path: () => `/api/leave/year-end/${ID}/discard` },
      { method: "post", path: () => `/api/leave/year-end/${ID}/commit`, body: {} },
    ],
    "user.security.manage": [
      { method: "post", path: () => `/api/access/employees/${p.employee.employeeId}/unlock`, body: { reason: "test of the lock" } },
      { method: "post", path: () => `/api/access/employees/${p.employee.employeeId}/reset-2fa`, body: { reason: "test of the lock" }, directorSkips: true },
      { method: "post", path: () => `/api/access/employees/${p.employee.employeeId}/password-reset`, body: { reason: "test of the lock" }, directorSkips: true },
    ],
  };
  const call = async (who: keyof typeof p, r: (typeof ROUTES)[(typeof FOUR)[number]][number]) => (await request(app)[r.method](r.path()).set(...authHeader(tok[who])).send(r.body ?? {})).status;

  beforeAll(async () => {
    await ensureAccessCatalog();
    org = await createEmployeeTestOrgMasters();
    p.director = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.hrAdmin = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.hrExec = await createFullTestEmployee(org, { roleCode: "HR_EXECUTIVE" });
    p.manager = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    p.employee = await createFullTestEmployee(org);
    for (const k of Object.keys(p) as Array<keyof typeof p>) tok[k] = await loginAs(p[k].employeeCode);
  });
  afterEach(async () => {
    await purgeAppendOnly("HrCapabilitySwitch", { createdByUserId: p.director.userId });
    await prisma.userPermissionOverride.deleteMany({ where: { userId: { in: [p.hrAdmin.userId, p.hrExec.userId] } } });
  });
  afterAll(async () => {
    await closeHrCapabilityQueue();
    for (const k of Object.keys(p) as Array<keyof typeof p>) await cleanupFullTestEmployee(p[k].employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("are in the locked set, and in no default HR role", () => {
    for (const k of FOUR) expect((HR_FORBIDDEN_KEYS as readonly string[]).includes(k), k).toBe(true);
    for (const code of HR_ROLE_CODES) for (const k of FOUR) expect(SYSTEM_ROLES.find((r) => r.code === code)!.permissions, `${code} ${k}`).not.toContain(k);
  });

  it("HR Admin and HR Executive hold none of the four, and every route behind them answers 403; a manager and an employee likewise; a director is not refused", async () => {
    for (const who of ["hrAdmin", "hrExec"] as const) for (const k of FOUR) expect((await resolveAccess(p[who].userId)).permissions.has(k), `${who} ${k}`).toBe(false);
    for (const k of FOUR) {
      for (const r of ROUTES[k]) {
        for (const who of ["hrAdmin", "hrExec"] as const) expect(await call(who, r), `${who} ${r.method} ${r.path()} (${k})`).toBe(403);
        // A manager or an employee is refused too; the access screens hide a person they may not see, so there "not found" is also a refusal.
        for (const who of ["manager", "employee"] as const) expect([403, ...(k === "user.security.manage" ? [404] : [])], `${who} ${r.method} ${r.path()}`).toContain(await call(who, r));
        if (!r.directorSkips) expect(await call("director", r), `director ${r.method} ${r.path()}`).not.toBe(403);
      }
    }
  });

  it("turning every HR switch on, for the role and for the person, still does not open any of them", async () => {
    for (const c of HR_CAPABILITIES) {
      for (const roleCode of ["HR_ADMIN", "HR_EXECUTIVE"] as const) await setSwitch({ capability: c.id, subject: { kind: "ROLE", roleCode }, state: "ON", reason: "all on" } as never, meta());
      for (const who of ["hrAdmin", "hrExec"] as const) await setSwitch({ capability: c.id, subject: { kind: "USER", employeeId: p[who].employeeId }, state: "ON", reason: "all on" } as never, meta());
    }
    for (const who of ["hrAdmin", "hrExec"] as const) for (const k of FOUR) expect((await resolveAccess(p[who].userId)).permissions.has(k), `${who} ${k}`).toBe(false);
    for (const k of FOUR) for (const r of ROUTES[k]) expect(await call("hrAdmin", r), `${r.method} ${r.path()}`).toBe(403);
  });

  it("the access service refuses to put any of the four on an HR role or grant it to an HR person, in words", async () => {
    for (const k of FOUR) {
      await expect(updateRole("HR_ADMIN", { permissions: ["employee.view", k] }, await actorOf(), meta()), k).rejects.toMatchObject({ status: 403, code: "HR_CEILING" });
      await expect(updateRole("HR_EXECUTIVE", { permissions: ["employee.view", k] }, await actorOf(), meta()), k).rejects.toMatchObject({ code: "HR_CEILING" });
      await expect(setOverride(p.hrExec.employeeId, k, { effect: "GRANT", reason: "please" }, await actorOf(), meta()), k).rejects.toMatchObject({ code: "HR_CEILING" });
    }
  });

  it("the database refuses the rows on its own", async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: "HR_EXECUTIVE" } });
    for (const k of FOUR) {
      await expect(prisma.rolePermission.create({ data: { roleId: role.id, permissionId: await keyId(k) } }), k).rejects.toThrow(/HR_HARD_LOCK/);
      await expect(prisma.userPermissionOverride.create({ data: { userId: p.hrAdmin.userId, permissionId: await keyId(k), effect: "GRANT", reason: "raw", createdByUserId: p.director.userId } }), k).rejects.toThrow(/HR_HARD_LOCK/);
    }
  });

  it("with the database triggers off, the resolver still strips them and the routes still answer 403", async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: "HR_ADMIN" } });
    const off = async (table: string, trigger: string, on: boolean) => prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ${on ? "ENABLE" : "DISABLE"} TRIGGER "${trigger}"`);
    await off("role_permissions", "role_permissions_hr_hard_lock", false);
    await off("user_permission_overrides", "user_permission_overrides_hr_hard_lock", false);
    try {
      for (const k of FOUR) {
        await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: await keyId(k) } });
        await prisma.userPermissionOverride.create({ data: { userId: p.hrExec.userId, permissionId: await keyId(k), effect: "GRANT", reason: "raw", createdByUserId: p.director.userId } });
      }
      for (const k of FOUR) {
        expect((await resolveAccess(p.hrAdmin.userId)).permissions.has(k), k).toBe(false);
        expect((await resolveAccess(p.hrExec.userId)).permissions.has(k), k).toBe(false);
        for (const r of ROUTES[k]) {
          expect(await call("hrAdmin", r), `${r.method} ${r.path()}`).toBe(403);
          expect(await call("hrExec", r), `${r.method} ${r.path()}`).toBe(403);
        }
      }
    } finally {
      for (const k of FOUR) await prisma.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: await keyId(k) } });
      await off("role_permissions", "role_permissions_hr_hard_lock", true);
      await off("user_permission_overrides", "user_permission_overrides_hr_hard_lock", true);
    }
  });

  it("a director who also holds an HR role keeps all four", async () => {
    const both = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    try {
      const hrRole = await prisma.role.findUniqueOrThrow({ where: { code: "HR_ADMIN" } });
      await prisma.userRole.create({ data: { userId: both.userId, roleId: hrRole.id } });
      const a = await resolveAccess(both.userId);
      for (const k of FOUR) expect(a.permissions.has(k), k).toBe(true);
    } finally {
      await cleanupFullTestEmployee(both.employeeId);
    }
  });
});
