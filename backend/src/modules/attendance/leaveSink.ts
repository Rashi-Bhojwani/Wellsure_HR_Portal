import { prisma } from "../../lib/prisma";
import type { AttendanceLeaveSink, ApprovedLeaveDay } from "../leave/attendanceIntegration";
import { requestRecompute } from "./recompute";

// The real AttendanceLeaveSink (Phase 4's seam, docs/plans/PHASE_2.md §4.1):
// approving or reversing leave recomputes those days — the engine applies
// holiday and week-off before leave (spec §4.4), so leave days are passed
// through as they are. A day is locked once Phase 3 finalisation locks it.
export class EngineAttendanceLeaveSink implements AttendanceLeaveSink {
  async onLeaveApproved(days: ApprovedLeaveDay[]): Promise<void> {
    await requestRecompute(days.map((d) => ({ employeeId: d.employeeId, date: d.date })));
  }

  async onLeaveReversed(days: ApprovedLeaveDay[]): Promise<void> {
    await requestRecompute(days.map((d) => ({ employeeId: d.employeeId, date: d.date })));
  }

  async isPeriodLocked(employeeId: string, date: Date): Promise<boolean> {
    return (await prisma.dailyAttendance.count({ where: { employeeId, date, isLocked: true } })) > 0;
  }
}
