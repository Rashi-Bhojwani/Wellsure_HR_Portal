// The Phase 2 seam (docs/PROJECT_SPEC.md §4.4/§4.5): approved leave must
// mark those days in attendance once daily_attendance exists, and a
// finalised/locked payroll month must reject a leave apply/cancel that
// falls inside it. Neither table exists yet — this interface is the
// clean boundary Phase 2 plugs a real implementation into, registered via
// setAttendanceLeaveSink() at worker startup, with zero changes to this
// module and no migration either way. Phase 4 registers the no-op stub
// below and calls all three methods from the real call sites today (apply/
// cancel check isPeriodLocked before writing; approve/cancel call
// onLeaveApproved/onLeaveReversed after writing) — so Phase 2 only has to
// implement the interface, never touch leave module code.

export interface ApprovedLeaveDay {
  employeeId: string;
  date: Date;
  leaveTypeCode: string; // "PL" | "LOP" | "COF" | "WFH" | "RH" (or whatever HR later adds)
  dayPart: "FULL" | "FIRST_HALF" | "SECOND_HALF";
  leaveRequestId: string;
}

export interface AttendanceLeaveSink {
  onLeaveApproved(days: ApprovedLeaveDay[]): Promise<void>;
  onLeaveReversed(days: ApprovedLeaveDay[]): Promise<void>;
  // Whether `date` falls inside a locked/finalised attendance period for
  // this employee (spec §4.5) — Phase 4 has no lock concept of its own, so
  // the stub always returns false; Phase 2's real implementation is the
  // only thing that can ever say true.
  isPeriodLocked(employeeId: string, date: Date): Promise<boolean>;
}

class NoopAttendanceLeaveSink implements AttendanceLeaveSink {
  async onLeaveApproved(): Promise<void> {
    // no attendance table to mark yet — Phase 2 supplies the real sink
  }

  async onLeaveReversed(): Promise<void> {
    // no attendance table to unmark yet — Phase 2 supplies the real sink
  }

  async isPeriodLocked(): Promise<boolean> {
    return false; // nothing is ever locked until Phase 2/3 builds attendance_periods
  }
}

let attendanceLeaveSink: AttendanceLeaveSink = new NoopAttendanceLeaveSink();

export function getAttendanceLeaveSink(): AttendanceLeaveSink {
  return attendanceLeaveSink;
}

// Called once, at worker/api startup, by whichever later phase registers
// a real implementation. Exported mainly for tests to install a spy.
export function setAttendanceLeaveSink(sink: AttendanceLeaveSink): void {
  attendanceLeaveSink = sink;
}
