import { PERMISSION_CATALOG, PERMISSION_KEYS } from "@shared/constants/permissions";
import { logger } from "./logger";
import { prisma } from "./prisma";
import { SYSTEM_ROLES } from "./systemRoles";

// Makes sure the access catalog exists in THIS database (Phase 5 commit E1):
// a Permission row for every key in PERMISSION_KEYS, and each system role
// that's missing, created with its default definition. Idempotent and
// additive only — it never changes an existing role (its permissions and
// scope belong to the Super Admins) and never removes anything.
//
// Why: staging/production are never seeded (the seed refuses to run outside
// development), so without this a fresh production database would have no
// roles at all — not even SUPER_ADMIN for the bootstrap CLI to assign. Runs
// in the `migrate` mode on every deploy, in `npm run db:migrate`, and at the
// start of the bootstrap CLI.
export async function ensureAccessCatalog(): Promise<{ permissionsCreated: number; rolesCreated: string[] }> {
  let permissionsCreated = 0;
  for (const key of PERMISSION_KEYS) {
    const existing = await prisma.permission.findUnique({ where: { key } });
    if (!existing) {
      await prisma.permission.create({ data: { key, description: PERMISSION_CATALOG[key].label } });
      permissionsCreated += 1;
    }
  }
  const rolesCreated: string[] = [];
  for (const def of SYSTEM_ROLES) {
    if (await prisma.role.findUnique({ where: { code: def.code } })) continue;
    const perms = await prisma.permission.findMany({ where: { key: { in: [...def.permissions] } } });
    await prisma.role.create({
      data: { code: def.code, name: def.name, dataScope: def.dataScope, isSystem: true, permissions: { create: perms.map((p) => ({ permissionId: p.id })) } },
    });
    rolesCreated.push(def.code);
  }
  if (permissionsCreated || rolesCreated.length) logger.info({ permissionsCreated, rolesCreated }, "access catalog: created missing entries");
  return { permissionsCreated, rolesCreated };
}
