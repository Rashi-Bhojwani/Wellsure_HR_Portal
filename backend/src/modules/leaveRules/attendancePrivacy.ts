import { leaveTypeNamer } from './hooks';

type Viewer = Parameters<typeof leaveTypeNamer>[0];

/** Attendance carries leave codes in split statuses and explanatory text. The leave
 * module owns the privacy decision; this adapter only applies its name to those codes. */
export async function attendanceLeaveText(viewer: Viewer) {
  const name = await leaveTypeNamer(viewer);
  return (text: string) => text.replace(/\b[A-Z][A-Z_]*\b/g, (code) => name({ code, name: code }));
}

type Day = {
  date: string;
  status?: string; code?: string; firstHalfStatus?: string | null; secondHalfStatus?: string | null;
  leaveTypeCode?: string | null; leaveReleased?: Array<{ type: string }>;
};

function displayDay<T extends Day>(body: T, text: (value: string) => string): T {
  return {
    ...body,
    ...(body.status === undefined ? {} : { status: text(body.status) }),
    ...(body.code === undefined ? {} : { code: text(body.code) }),
    ...(body.firstHalfStatus == null ? {} : { firstHalfStatus: text(body.firstHalfStatus) }),
    ...(body.secondHalfStatus == null ? {} : { secondHalfStatus: text(body.secondHalfStatus) }),
    ...(body.leaveTypeCode == null ? {} : { leaveTypeCode: text(body.leaveTypeCode) }),
    ...(body.leaveReleased === undefined ? {} : { leaveReleased: body.leaveReleased.map((r) => ({ ...r, type: text(r.type) })) }),
  };
}

export async function attendanceDayDisplay<T extends Day>(body: T, viewer: Viewer, employeeId: string): Promise<T> {
  return employeeId === viewer.employeeId ? body : displayDay(body, await attendanceLeaveText(viewer));
}

export async function attendanceMonthDisplay<T extends { days: Day[] }>(body: T, viewer: Viewer, employeeId: string): Promise<T> {
  if (employeeId === viewer.employeeId) return body;
  const text = await attendanceLeaveText(viewer);
  return { ...body, days: body.days.map((d) => displayDay(d, text)) };
}

type Board = {
  away: Array<{ employeeId: string; why: string }>;
  arrived: Array<{ employeeId: string; halfDayLeave: string | null }>;
  manual: Array<{ employeeId: string; status: string }>;
};
export async function attendanceBoardDisplay<T extends Board>(body: T, viewer: Viewer): Promise<T> {
  const text = await attendanceLeaveText(viewer);
  const own = (employeeId: string, value: string) => employeeId === viewer.employeeId ? value : text(value);
  return {
    ...body,
    away: body.away.map((r) => ({ ...r, why: own(r.employeeId, r.why) })),
    arrived: body.arrived.map((r) => ({ ...r, halfDayLeave: r.halfDayLeave === null ? null : own(r.employeeId, r.halfDayLeave) })),
    manual: body.manual.map((r) => ({ ...r, status: own(r.employeeId, r.status) })),
  };
}

type Muster = { rows: Array<{ employeeId: string; cells: Array<{ code: string | null; status: string | null; reason: string | null }> }> };
export async function attendanceMusterDisplay<T extends Muster>(body: T, viewer: Viewer): Promise<T> {
  const text = await attendanceLeaveText(viewer);
  return {
    ...body,
    rows: body.rows.map((r) => r.employeeId === viewer.employeeId ? r : ({
      ...r,
      cells: r.cells.map((c) => ({ ...c,
        code: c.code === null ? null : text(c.code),
        status: c.status === null ? null : text(c.status),
        reason: c.reason === null ? null : text(c.reason),
      })),
    })),
  };
}
