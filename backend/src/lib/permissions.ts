import { PERMISSION_KEYS } from "@shared/constants/permissions";
import type { DataScope } from "@shared/constants/roles";
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

export async function resolveAccess(userId: string): Promise<ResolvedAccess> {
  const [userRoles, overrides] = await Promise.all([
    prisma.userRole.findMany({ where: { userId }, include: { role: { include: { permissions: { include: { permission: true } } } } } }),
    prisma.userPermissionOverride.findMany({ where: { userId }, include: { permission: true } }),
  ]);
  const roleCodes = userRoles.map((ur) => ur.role.code);
  if (roleCodes.includes(SUPER_ADMIN_ROLE_CODE)) {
    return { roleCodes, permissions: new Set<string>(PERMISSION_KEYS), dataScope: "ALL", isSuperAdmin: true };
  }
  const permissions = new Set<string>();
  for (const ur of userRoles) for (const rp of ur.role.permissions) permissions.add(rp.permission.key);
  for (const o of overrides) if (o.effect === "GRANT") permissions.add(o.permission.key);
  for (const o of overrides) if (o.effect === "REVOKE") permissions.delete(o.permission.key);
  return { roleCodes, permissions, dataScope: widestScope(userRoles.map((ur) => ur.role.dataScope)), isSuperAdmin: false };
}

export async function resolveUserPermissions(userId: string): Promise<Set<string>> {
  return (await resolveAccess(userId)).permissions;
}

export async function resolveUserRoleCodes(userId: string): Promise<string[]> {
  const userRoles = await prisma.userRole.findMany({ where: { userId }, include: { role: true } });
  return userRoles.map((userRole) => userRole.role.code);
}
