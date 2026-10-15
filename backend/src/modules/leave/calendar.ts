import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { getTeamEmployeeIds } from "../../lib/dataScope";
import type { LeaveViewer } from "./types";
import { releasedDatesOf } from "./releases";
import { inForceOn } from "../../lib/effectiveDating";

export interface LeaveCalendarQuery {
  fromDate: string;
  toDate: string;
  locationId?: string;
  departmentId?: string;
}

export interface LeaveCalendarEntry {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  leaveTypeCode: string;
  fromDate: string;
  toDate: string;
  fromDayPart: string;
  toDayPart: string;
  /** Days inside the range that HR released because the person worked them (Phase 3): not leave. */
  releasedDates: string[];
}

// "Who's on leave" — a low-sensitivity courtesy view (approved leave only,
// no reasons/decisions), distinct from GET /api/leave/requests (the
// permission-gated admin request-management list). Default, for anyone
// without leave.view: the caller's own current department, ignoring any
// locationId/departmentId query params — a plain employee always sees
// "my team", never an arbitrary department. leave.view holders can widen
// to any location/department, or the whole org if neither is given.
//
// E1.1 (was a live leak): widening is for ALL-scope leave.view holders only.
// A TEAM-scoped holder (a manager) gets their own department, as everyone
// does, plus their own team wherever its members sit — never an arbitrary
// department or the whole company.
export async function getLeaveCalendar(query: LeaveCalendarQuery, viewer: LeaveViewer): Promise<LeaveCalendarEntry[]> {
  const hasBroadView = viewer.permissions.has("leave.view") && viewer.dataScope === "ALL";
  const teamIds = viewer.permissions.has("leave.view") && viewer.dataScope === "TEAM" ? await getTeamEmployeeIds(viewer.employeeId) : [];
  const fromDate = new Date(query.fromDate);
  const toDate = new Date(query.toDate);

  let locationId = query.locationId;
  let departmentId = query.departmentId;
  if (!hasBroadView) {
    const ownJobHistory = await prisma.employeeJobHistory.findFirst({
      where: { employeeId: viewer.employeeId, ...inForceOn() },
      select: { departmentId: true },
    });
    departmentId = ownJobHistory?.departmentId;
    locationId = undefined;
  }

  const where: Prisma.LeaveRequestWhereInput = {
    status: "APPROVED",
    fromDate: { lte: toDate },
    toDate: { gte: fromDate },
  };
  if (departmentId || locationId) {
    const placement = {
      jobHistory: {
        some: {
          ...inForceOn(),
          ...(departmentId ? { departmentId } : {}),
          ...(locationId ? { locationId } : {}),
        },
      },
    };
    where.employee = teamIds.length > 0 ? { OR: [placement, { id: { in: teamIds } }] } : placement;
  }
  if (!hasBroadView && !departmentId) {
    // No department on record (e.g. no job placement yet): without this,
    // the filter above would be skipped and the whole company returned.
    where.employee = { id: { in: [viewer.employeeId, ...teamIds] } };
  }

  const rows = await prisma.leaveRequest.findMany({
    where,
    include: { leaveType: true, employee: { include: { nameHistory: { where: inForceOn() } } } },
    orderBy: { fromDate: "asc" },
  });

  const released = await releasedDatesOf(prisma, rows.map((r) => r.id));
  return rows.map((r) => ({
    employeeId: r.employeeId,
    employeeCode: r.employee.employeeCode,
    employeeName: r.employee.nameHistory[0]?.fullName ?? r.employee.employeeCode,
    leaveTypeCode: r.leaveType.code,
    fromDate: r.fromDate.toISOString().slice(0, 10),
    toDate: r.toDate.toISOString().slice(0, 10),
    fromDayPart: r.fromDayPart,
    toDayPart: r.toDayPart,
    releasedDates: released.get(r.id) ?? [],
  }));
}
