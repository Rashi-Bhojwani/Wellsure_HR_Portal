import { HR_ROLE_CODES } from "@shared/constants/sensitiveData";
import { SUPER_ADMIN_ROLE_CODE, resolveAccess } from "./permissions";
import { prisma } from "./prisma";

/**
 * Which duties HR cannot currently do at all: true when HR people exist and not one of them holds the key. The directors' queue uses it to say, in words, that work is waiting
 * for them because HR has been switched off for it (docs/plans/HR_CAPABILITIES.md §2). Nothing is moved or approved: the request stays PENDING either way.
 */
export async function hrCannotDecide(): Promise<{ leave: boolean; regularizations: boolean }> {
  const holders = await prisma.user.findMany({
    where: { status: "ACTIVE", roles: { some: { role: { code: { in: [...HR_ROLE_CODES] } } } }, NOT: { roles: { some: { role: { code: SUPER_ADMIN_ROLE_CODE } } } } },
    select: { id: true },
  });
  if (holders.length === 0) return { leave: false, regularizations: false };
  const access = await Promise.all(holders.map((h) => resolveAccess(h.id)));
  return { leave: !access.some((a) => a.permissions.has("leave.approve")), regularizations: !access.some((a) => a.permissions.has("attendance.regularization.approve")) };
}
