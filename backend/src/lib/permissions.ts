import { PERMISSION_KEYS, MANAGER_GRANTABLE_KEYS } from "@shared/constants/permissions";
import type { DataScope } from "@shared/constants/roles";
import { DEVELOPER_FORBIDDEN_KEYS, DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { prisma } from "./prisma";

// THE one place effective access is computed (Phase 5 commit E1). Used by
// middleware/authenticate.ts, the Socket.IO handshake, the photo route and
// /api/auth/me — so every surface agrees.
//
//   SUPER_ADMIN holder → every key in PERMISSION_KEYS, data scope ALL —
//     computed here in code, never read from role_permissions rows. No row
//     (even one deleted directly in the database) can take anything away,
//     and keys added by later commits are held automatically.
//   everyone else      → union of their roles' permissions
//                        + their GRANT overrides − their REVOKE overrides;
//                        data scope = the widest of their roles' scopes.
export const SUPER_ADMIN_ROLE_CODE = "SUPER_ADMIN";

export interface ResolvedAccess {
  roleCodes: string[];
  permissions: Set<string>;
  dataScope: DataScope;
  isSuperAdmin: boolean;
}

const SCOPE_RANK: Record<DataScope, number> = { SELF: 0, TEAM: 1, ALL: 2 };

export function widestScope(scopes: DataScope[]): DataScope {
  return scopes.reduce<DataScope>((acc, s) => (SCOPE_RANK[s] > SCOPE_RANK[acc] ? s : acc), "SELF");
}

const MANAGER_ROLE = "MANAGER";
const MANAGER_GRANTABLE = new Set<string>(MANAGER_GRANTABLE_KEYS);
const DEVELOPER_FORBIDDEN = new Set<string>(DEVELOPER_FORBIDDEN_KEYS);

export async function resolveAccess(userId: string): Promise<ResolvedAccess> {
  const [userRoles, overrides] = await Promise.all([
    prisma.userRole.findMany({ where: { userId }, include: { role: { include: { permissions: { include: { permission: true } } } } } }),
    prisma.userPermissionOverride.findMany({ where: { userId }, include: { permission: true } }),
  ]);
  const roleCodes = userRoles.map((ur) => ur.role.code);
  if (roleCodes.includes(DEVELOPER_ROLE_CODE)) {
    // P6-6, the developer ceiling (docs/plans/PHASE_6.md §14J): the person who builds and runs the system never holds an owner's secret. Whatever the role definitions, a
    // per-user grant or a raw SQL row say, every key in the sensitive registry is removed here, the one place access is resolved. Someone who somehow holds this role
    // together with SUPER_ADMIN is treated as a developer only: the Super Admin role is dropped from what they are seen to hold.
    const permissions = new Set<string>();
    for (const ur of userRoles) for (const rp of ur.role.permissions) permissions.add(rp.permission.key);
    for (const o of overrides) if (o.effect === "GRANT") permissions.add(o.permission.key);
    for (const o of overrides) if (o.effect === "REVOKE") permissions.delete(o.permission.key);
    for (const key of [...permissions]) if (DEVELOPER_FORBIDDEN.has(key)) permissions.delete(key);
    return { roleCodes: roleCodes.filter((c) => c !== SUPER_ADMIN_ROLE_CODE), permissions, dataScope: widestScope(userRoles.map((ur) => ur.role.dataScope)), isSuperAdmin: false };
  }
  if (roleCodes.includes(SUPER_ADMIN_ROLE_CODE)) {
    return { roleCodes, permissions: new Set<string>(PERMISSION_KEYS), dataScope: "ALL", isSuperAdmin: true };
  }
  const permissions = new Set<string>();
  for (const ur of userRoles) for (const rp of ur.role.permissions) permissions.add(rp.permission.key);
  for (const o of overrides) if (o.effect === "GRANT") permissions.add(o.permission.key);
  for (const o of overrides) if (o.effect === "REVOKE") permissions.delete(o.permission.key);
  const dataScope = widestScope(userRoles.map((ur) => ur.role.dataScope));
  if (roleCodes.includes(MANAGER_ROLE)) {
    // E2 manager-grantable guard, enforced at resolution as well as on every
    // write: whatever rows say (a stale role definition, a raw SQL grant, a
    // role combination that predates the guard), a MANAGER holder gets only
    // manager-grantable keys, and never more than TEAM scope.
    for (const key of [...permissions]) if (!MANAGER_GRANTABLE.has(key)) permissions.delete(key);
    return { roleCodes, permissions, dataScope: dataScope === "ALL" ? "TEAM" : dataScope, isSuperAdmin: false };
  }
  return { roleCodes, permissions, dataScope, isSuperAdmin: false };
}

export async function resolveUserPermissions(userId: string): Promise<Set<string>> {
  return (await resolveAccess(userId)).permissions;
}

export async function resolveUserRoleCodes(userId: string): Promise<string[]> {
  const userRoles = await prisma.userRole.findMany({ where: { userId }, include: { role: true } });
  return userRoles.map((userRole) => userRole.role.code);
}

// Every ACTIVE user who effectively holds `key` right now — for notifying
// "whoever can deal with this" (e.g. E2: a separated manager's team needs
// reassigning). Candidates are found cheaply, then each is resolved exactly.
export async function activeUsersHoldingPermission(key: string): Promise<Array<{ userId: string; employeeId: string }>> {
  const candidates = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      OR: [
        { roles: { some: { role: { code: SUPER_ADMIN_ROLE_CODE } } } },
        { roles: { some: { role: { permissions: { some: { permission: { key } } } } } } },
        { permissionOverrides: { some: { effect: "GRANT", permission: { key } } } },
      ],
    },
    select: { id: true, employeeId: true },
  });
  const out: Array<{ userId: string; employeeId: string }> = [];
  for (const c of candidates) if ((await resolveAccess(c.id)).permissions.has(key)) out.push({ userId: c.id, employeeId: c.employeeId });
  return out;
}
