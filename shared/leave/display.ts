// A-10 G7 (docs/plans/GREYTHR_PARITY_WORKFORCE.md item 16): the ONE function through which a leave request's type and reason are shown to someone who is
// not the person on leave. Today it shows both as entered. It exists so that a privacy rule for some leave types (planned on the peeps/foundation branch)
// plugs in here once, and every screen that lists other people's leave (the Workflow Review and Monitor lists first) follows it.

export type LeaveViewerLevel = "SELF" | "HR" | "BELOW_HR";

export interface LeaveDisplayInput {
  leaveTypeCode: string;
  leaveTypeName: string;
  reason: string | null;
}

export interface LeaveDisplay {
  typeLabel: string;
  reason: string | null;
}

export function displayLeaveForViewer(row: LeaveDisplayInput, _level: LeaveViewerLevel): LeaveDisplay {
  return { typeLabel: row.leaveTypeName, reason: row.reason };
}
