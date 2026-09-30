import { prisma } from "./prisma";

// Audience rule shared by scoped content (company documents; the same rule
// Announcement has used since Phase 5 commit A): each scope column is either
// null (matches everyone) or must equal the employee's *current* branch /
// department. Both set = the intersection.

export interface Placement {
  locationId: string;
  departmentId: string;
}

export async function getCurrentPlacement(employeeId: string): Promise<Placement | null> {
  const job = await prisma.employeeJobHistory.findFirst({
    where: { employeeId, effectiveTo: null },
    select: { locationId: true, departmentId: true },
  });
  return job;
}

// A Prisma `where` fragment for a model with scopeLocationId/scopeDepartmentId.
// No placement (no open job row) → only fully unscoped content.
export function audienceWhere(placement: Placement | null) {
  return {
    AND: [
      { OR: [{ scopeLocationId: null }, ...(placement ? [{ scopeLocationId: placement.locationId }] : [])] },
      { OR: [{ scopeDepartmentId: null }, ...(placement ? [{ scopeDepartmentId: placement.departmentId }] : [])] },
    ],
  };
}

export function isInAudience(
  scope: { scopeLocationId: string | null; scopeDepartmentId: string | null },
  placement: Placement | null,
): boolean {
  if (scope.scopeLocationId && scope.scopeLocationId !== placement?.locationId) return false;
  if (scope.scopeDepartmentId && scope.scopeDepartmentId !== placement?.departmentId) return false;
  return true;
}
