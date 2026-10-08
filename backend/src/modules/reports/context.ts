import type { EmploymentType, Prisma } from "@prisma/client";
import type { DataScope } from "@shared/constants/roles";
import { getTeamEmployeeIds } from "../../lib/dataScope";
import { inForceOn, type Placement } from "../../lib/effectiveDating";

// What every report shares (Phase 5 commit F): who's in the viewer's scope,
// where each person was placed on a given date, and the org filters.

export interface ReportViewer {
  userId: string;
  employeeId: string;
  dataScope: DataScope;
  permissions: Set<string>;
}

export interface ReportQuery {
  asOf?: string;
  from?: string;
  to?: string;
  departmentId?: string;
  locationId?: string;
  employmentType?: EmploymentType;
  leaveTypeId?: string;
  kind?: "all" | "birthday" | "anniversary";
}

// ids: the viewer's population (null = everyone, ALL scope). managers:
// whose former reports count as the viewer's leavers — a leaver is in no
// one's current team, so for a team view they count if their last
// placement reported to the manager or someone in the team (the E1.1
// dashboard rule).
export interface Population {
  ids: Set<string> | null;
  managers: Set<string> | null;
}

export async function populationFor(viewer: ReportViewer): Promise<Population> {
  if (viewer.dataScope === "ALL") return { ids: null, managers: null };
  if (viewer.dataScope === "SELF") return { ids: new Set([viewer.employeeId]), managers: new Set() };
  const team = await getTeamEmployeeIds(viewer.employeeId);
  const ids = new Set([viewer.employeeId, ...team]);
  return { ids, managers: ids };
}

export function employeeWhere(pop: Population, q: ReportQuery): Prisma.EmployeeWhereInput {
  return {
    ...(pop.ids ? { id: { in: [...pop.ids] } } : {}),
    ...(q.employmentType ? { employmentType: q.employmentType } : {}),
  };
}

export function matchesOrg(p: Placement | undefined, q: ReportQuery): boolean {
  if (q.departmentId && p?.departmentId !== q.departmentId) return false;
  if (q.locationId && p?.locationId !== q.locationId) return false;
  return true;
}

export const nameOf = (e: { employeeCode: string; nameHistory: { fullName: string }[] }) => e.nameHistory[0]?.fullName ?? e.employeeCode;
// A function, not a constant: "today" moves at midnight.
export const currentName = () => ({ nameHistory: { where: inForceOn(), select: { fullName: true } } }) as const;
export { placementsOn, type Placement } from "../../lib/effectiveDating";
export const ymd = (d: Date) => d.toISOString().slice(0, 10);
