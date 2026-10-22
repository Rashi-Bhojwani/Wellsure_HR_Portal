import { PERMISSION_CATALOG, type PermissionKey } from "@shared/constants/permissions";
import { DEVELOPER_ROLE_CODE, SENSITIVE_CLASSES, SENSITIVE_PERMISSION_KEYS } from "@shared/constants/sensitiveData";
import { resolveAccess } from "../../../lib/permissions";
import { prisma } from "../../../lib/prisma";
import { namesOfUsers } from "../names";

// "Who can see and change this": for each kind of sensitive data, the people who can see it, change it and confirm it right now, worked out from live access (the same resolver that
// guards every request), so an owner can check at any time that the developer is on none of the lines.

export interface Holder {
  userId: string;
  name: string;
  employeeCode: string;
  roles: string[];
  /** Why they can: the permission(s) that open it, in words. */
  via: string[];
  isDeveloper: boolean;
}

export interface AccessClass {
  id: string;
  label: string;
  what: string;
  view: Holder[];
  edit: Holder[];
  confirm: Holder[];
}

export interface AccessReport {
  classes: AccessClass[];
  /** Every developer account and whether the system left it any access to the owners' secrets. It must always be none. */
  developers: Array<{ userId: string; name: string; employeeCode: string; holdsAnySecret: boolean; isSuperAdmin: boolean }>;
}

export async function buildAccessReport(): Promise<AccessReport> {
  // Candidates: anybody who could hold a sensitive key by a role, a grant, or being a Super Admin; then resolved exactly.
  const keys = [...SENSITIVE_PERMISSION_KEYS];
  const users = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      OR: [
        { roles: { some: { role: { code: { in: ["SUPER_ADMIN", DEVELOPER_ROLE_CODE] } } } } },
        { roles: { some: { role: { permissions: { some: { permission: { key: { in: keys } } } } } } } },
        { permissionOverrides: { some: { effect: "GRANT", permission: { key: { in: keys } } } } },
      ],
    },
    select: { id: true, employee: { select: { employeeCode: true } } },
    take: 500,
  });
  const names = await namesOfUsers(users.map((u) => u.id));
  const resolved = await Promise.all(users.map(async (u) => ({ u, access: await resolveAccess(u.id) })));
  const holder = (r: (typeof resolved)[number], via: string[]): Holder => ({
    userId: r.u.id,
    name: names.get(r.u.id) ?? r.u.employee.employeeCode,
    employeeCode: r.u.employee.employeeCode,
    roles: r.access.roleCodes,
    via,
    isDeveloper: r.access.roleCodes.includes(DEVELOPER_ROLE_CODE),
  });
  const holders = (permissionKeys: readonly PermissionKey[]): Holder[] => {
    const out: Holder[] = [];
    for (const r of resolved) {
      const via = permissionKeys.filter((k) => r.access.permissions.has(k)).map((k) => PERMISSION_CATALOG[k].label);
      if (via.length) out.push(holder(r, via));
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  };
  return {
    classes: SENSITIVE_CLASSES.map((c) => ({ id: c.id, label: c.label, what: c.what, view: holders(c.view), edit: holders(c.edit), confirm: holders(c.confirm) })),
    developers: resolved
      .filter((r) => r.access.roleCodes.includes(DEVELOPER_ROLE_CODE))
      .map((r) => ({ userId: r.u.id, name: names.get(r.u.id) ?? r.u.employee.employeeCode, employeeCode: r.u.employee.employeeCode, holdsAnySecret: SENSITIVE_PERMISSION_KEYS.some((k) => r.access.permissions.has(k)), isSuperAdmin: r.access.isSuperAdmin })),
  };
}
