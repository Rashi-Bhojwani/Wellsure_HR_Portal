import { prisma } from "./prisma";

// A user's effective permissions are the union of every role they hold
// (spec §2: "A user can hold multiple roles").
export async function resolveUserPermissions(userId: string): Promise<Set<string>> {
  const userRoles = await prisma.userRole.findMany({
    where: { userId },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });
  const keys = new Set<string>();
  for (const userRole of userRoles) {
    for (const rolePermission of userRole.role.permissions) {
      keys.add(rolePermission.permission.key);
    }
  }
  return keys;
}

export async function resolveUserRoleCodes(userId: string): Promise<string[]> {
  const userRoles = await prisma.userRole.findMany({ where: { userId }, include: { role: true } });
  return userRoles.map((userRole) => userRole.role.code);
}
