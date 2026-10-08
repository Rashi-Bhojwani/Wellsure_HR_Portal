import type { DataScope } from "@shared/constants/roles";
import { buildEmployeeScopeWhere } from "../../../lib/dataScope";
import { prisma } from "../../../lib/prisma";

// Who may see and mark whose manual attendance (docs/plans/PHASE_2.md §2.4,
// §5.1, "P2-D build design"):
//  - marking: `attendance.manual.enter`, for an employee whose placement on
//    the day is in one of the holder's `attendance_manual_branches`; a
//    holder with ALL data scope (HR) may mark every branch;
//  - seeing: `attendance.view` in data scope, plus whatever the holder may
//    mark.
// Anything outside is a 404 to the caller, never confirming it exists.

export interface Viewer {
  userId: string;
  employeeId: string;
  permissions: Set<string>;
  dataScope: DataScope;
}

export type Branches = "ALL" | Set<string>;

/** The branches this viewer may mark manual attendance in (empty: none). */
export async function markableBranches(viewer: Viewer): Promise<Branches> {
  if (!viewer.permissions.has("attendance.manual.enter")) return new Set();
  if (viewer.dataScope === "ALL") return "ALL";
  const rows = await prisma.attendanceManualBranch.findMany({ where: { userId: viewer.userId }, select: { locationId: true } });
  return new Set(rows.map((r) => r.locationId));
}

export const inBranches = (branches: Branches, locationId: string | null | undefined) => !!locationId && (branches === "ALL" || branches.has(locationId));
export const hasAnyBranch = (branches: Branches) => branches === "ALL" || branches.size > 0;

/** Employee ids `attendance.view` lets this viewer see (null: everyone), or an empty set without the key. */
export async function viewableEmployeeIds(viewer: Viewer): Promise<Set<string> | null> {
  if (!viewer.permissions.has("attendance.view")) return new Set();
  if (viewer.dataScope === "ALL") return null;
  const where = await buildEmployeeScopeWhere(viewer.employeeId, viewer.dataScope);
  const rows = await prisma.employee.findMany({ where, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}
