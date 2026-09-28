import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import type { LeaveViewer } from "./types";

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
}

// "Who's on leave" — a low-sensitivity courtesy view (approved leave only,
// no reasons/decisions), distinct from GET /api/leave/requests (the
// permission-gated admin request-management list). Default, for anyone
// without leave.view: the caller's own current department, ignoring any
// locationId/departmentId query params — a plain employee always sees
// "my team", never an arbitrary department. leave.view holders can widen
// to any location/department, or the whole org if neither is given.
export async function getLeaveCalendar(query: LeaveCalendarQuery, viewer: LeaveViewer): Promise<LeaveCalendarEntry[]> {
  const hasBroadView = viewer.permissions.has("leave.view");
  const fromDate = new Date(query.fromDate);
  const toDate = new Date(query.toDate);

  let locationId = query.locationId;
  let departmentId = query.departmentId;
  if (!hasBroadView) {
    const ownJobHistory = await prisma.employeeJobHistory.findFirst({
      where: { employeeId: viewer.employeeId, effectiveTo: null },
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
    where.employee = {
      jobHistory: {
        some: {
          effectiveTo: null,
          ...(departmentId ? { departmentId } : {}),
          ...(locationId ? { locationId } : {}),
        },
      },
    };
  }

  const rows = await prisma.leaveRequest.findMany({
    where,
    include: { leaveType: true, employee: { include: { nameHistory: { where: { effectiveTo: null } } } } },
    orderBy: { fromDate: "asc" },
  });

  return rows.map((r) => ({
    employeeId: r.employeeId,
    employeeCode: r.employee.employeeCode,
    employeeName: r.employee.nameHistory[0]?.fullName ?? r.employee.employeeCode,
    leaveTypeCode: r.leaveType.code,
    fromDate: r.fromDate.toISOString().slice(0, 10),
    toDate: r.toDate.toISOString().slice(0, 10),
    fromDayPart: r.fromDayPart,
    toDayPart: r.toDayPart,
  }));
}
