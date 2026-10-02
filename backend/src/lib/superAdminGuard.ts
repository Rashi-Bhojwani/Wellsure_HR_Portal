import { prisma } from "./prisma";
import { HttpError } from "../middleware/errorHandler";
import { SUPER_ADMIN_ROLE_CODE } from "./permissions";

// The last active SUPER_ADMIN can never be lost (Phase 5 commit E1, rule 7).
// Production will have two real SUPER_ADMINs; either may be removed as long
// as one remains. This is the service-level check with a clear message;
// Postgres triggers (migration e1_roles_permissions_lockout) enforce the
// same rule for every path, and errorHandler maps their error to a 409.

export const LAST_SUPER_ADMIN_MESSAGE =
  "This is the last active Super Admin. Appoint another Super Admin first — the company must never be locked out of its own system.";

export async function isActiveSuperAdmin(userId: string): Promise<boolean> {
  const n = await prisma.userRole.count({ where: { userId, role: { code: SUPER_ADMIN_ROLE_CODE }, user: { status: "ACTIVE" } } });
  return n > 0;
}

// Active SUPER_ADMINs other than `userId` who will still be there: with
// `excludeLeaving`, someone whose separation is already in progress doesn't
// count (so two SUPER_ADMINs can't each separate the other).
export async function otherActiveSuperAdmins(userId: string, opts: { excludeLeaving?: boolean } = {}): Promise<number> {
  return prisma.userRole.count({
    where: {
      userId: { not: userId },
      role: { code: SUPER_ADMIN_ROLE_CODE },
      user: {
        status: "ACTIVE",
        ...(opts.excludeLeaving && { employee: { separations: { none: { status: "INITIATED" } } } }),
      },
    },
  });
}

// Throws 409 if taking access away from `userId` would leave no active
// SUPER_ADMIN. No-op for anyone who isn't an active SUPER_ADMIN.
export async function assertSuperAdminRemains(userId: string, opts: { excludeLeaving?: boolean } = {}): Promise<void> {
  if (!(await isActiveSuperAdmin(userId))) return;
  if ((await otherActiveSuperAdmins(userId, opts)) === 0) throw new HttpError(409, LAST_SUPER_ADMIN_MESSAGE, "LAST_SUPER_ADMIN");
}

export function isLastSuperAdminDbError(err: unknown): boolean {
  return err instanceof Error && err.message.includes("LAST_SUPER_ADMIN:");
}
