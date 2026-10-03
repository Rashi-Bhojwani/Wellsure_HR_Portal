import type { EmploymentType, Prisma } from "@prisma/client";
import type { DataScope } from "@shared/constants/roles";
import { prisma } from "../../lib/prisma";
import { getTeamEmployeeIds } from "../../lib/dataScope";

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

export interface Placement {
  departmentId: string;
  department: string;
  designation: string;
  locationId: string;
  location: string;
  city: string | null;
  reportingManagerId: string | null;
  reportingManager: string | null;
}

// The job-history row in force on `day` for each employee: effective_from
// <= day < effective_to (effective_to is the next row's start). Falls back
// to the earliest row for a day before someone's first placement.
export async function placementsOn(employeeIds: string[], day: Date): Promise<Map<string, Placement>> {
  const rows = await prisma.employeeJobHistory.findMany({
    where: { employeeId: { in: employeeIds } },
    orderBy: { effectiveFrom: "asc" },
    select: {
      employeeId: true,
      effectiveFrom: true,
      effectiveTo: true,
      departmentId: true,
      locationId: true,
      reportingManagerId: true,
      department: { select: { name: true } },
      designation: { select: { name: true } },
      location: { select: { name: true, cityMaster: { select: { name: true } } } },
      reportingManager: { select: { employeeCode: true, nameHistory: { where: { effectiveTo: null }, select: { fullName: true } } } },
    },
  });
  const toPlacement = (r: (typeof rows)[number]): Placement => ({
    departmentId: r.departmentId,
    department: r.department.name,
    designation: r.designation.name,
    locationId: r.locationId,
    location: r.location.name,
    city: r.location.cityMaster?.name ?? null,
    reportingManagerId: r.reportingManagerId,
    reportingManager: r.reportingManager ? (r.reportingManager.nameHistory[0]?.fullName ?? r.reportingManager.employeeCode) : null,
  });
  const t = day.getTime();
  const byEmployee = new Map<string, typeof rows>();
  for (const r of rows) byEmployee.set(r.employeeId, [...(byEmployee.get(r.employeeId) ?? []), r]);
  const result = new Map<string, Placement>();
  for (const [id, history] of byEmployee) {
    const inForce = history.find((r) => r.effectiveFrom.getTime() <= t && (!r.effectiveTo || r.effectiveTo.getTime() > t));
    result.set(id, toPlacement(inForce ?? history[0]!)); // rows are oldest first
  }
  return result;
}

export function matchesOrg(p: Placement | undefined, q: ReportQuery): boolean {
  if (q.departmentId && p?.departmentId !== q.departmentId) return false;
  if (q.locationId && p?.locationId !== q.locationId) return false;
  return true;
}

export const nameOf = (e: { employeeCode: string; nameHistory: { fullName: string }[] }) => e.nameHistory[0]?.fullName ?? e.employeeCode;
export const currentName = { nameHistory: { where: { effectiveTo: null }, select: { fullName: true } } } as const;
export const ymd = (d: Date) => d.toISOString().slice(0, 10);
