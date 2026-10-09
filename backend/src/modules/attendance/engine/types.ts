// The rules engine's inputs and output (docs/plans/PHASE_2.md §4). Plain data
// only: the engine is a pure function, so every rule is table-testable.

/** Bump whenever a rule's behaviour changes; stored on every day so a recompute can show what changed. */
export const ENGINE_VERSION = 1;

export type AttendanceSource = "DEVICE" | "MANUAL" | "LEAVE" | "HOLIDAY" | "WEEK_OFF";
export type Capture = "DEVICE" | "MANUAL";

export interface ShiftSessionDef {
  kind: "WORK" | "BREAK";
  label: string;
  startTime: string; // "HH:MM" business time
  endTime: string;
}

export interface ShiftDef {
  id: string;
  code: string;
  name: string;
  startTime: string;
  endTime: string; // <= startTime: crosses midnight, belongs to its start date
  graceInMinutes: number;
  graceOutMinutes: number;
  windowBeforeMinutes: number;
  windowAfterMinutes: number;
  sessions: ShiftSessionDef[];
}

export interface PolicyDef {
  id: string;
  fullDayMinMinutes: number;
  halfDayMinMinutes: number;
  halfDayMinNotMetLopDays: number;
  nearDuplicateSeconds: number;
  inferBreakPairing: boolean;
}

/** Approved leave on one half of the day. */
export interface HalfLeave {
  code: string; // PL, LOP, COF, WFH, RH, … — whatever HR has configured
  unpaid: boolean; // an unpaid leave type counts as loss of pay
}

/** Manual entry (P2-D) for a manual-capture day. TIMED goes through the punch rules exactly like device punches. */
export type ManualEntry =
  | { kind: "TIMED"; id: string; inTime: string; outTime: string | null } // "HH:MM" business time; an out at or before the in is next day
  | { kind: "STATUS_ONLY"; id: string; status: "P" | "A" | "HD_FIRST" | "HD_SECOND" | "WORKED" };

export interface PunchRef {
  id: string;
  at: number; // epoch ms
}

export interface DayInput {
  date: string; // business date D, YYYY-MM-DD (Asia/Kolkata)
  employed: boolean; // joined on or before D and not past the last working day
  holiday: string | null; // the company holiday's name
  shift: ShiftDef | null; // the assignment's shift in force on D
  weekOff: boolean; // by the assigned week-off pattern
  leave: { first: HalfLeave | null; second: HalfLeave | null }; // full-day leave fills both
  capture: Capture; // DEVICE = a device mapping was in force on D
  manual: ManualEntry | null;
  // An approved forgot-to-punch request (P2-E): one more time on a device day,
  // "HH:MM" business time like a manual entry's. Never a raw punch.
  correction: { id: string; time: string } | null;
  punches: PunchRef[]; // usable punches attributed to D (flagged ones only if HR accepted them)
  flaggedExcluded: number; // punches attributed to D still awaiting HR's decision on their time
  policy: PolicyDef | null;
  now: number; // epoch ms — the day is provisional until its shift window closes
}

export type ExceptionFlag = "MISSING_PUNCH" | "SHORTFALL" | "LATE_IN" | "EARLY_OUT" | "HALF_DAY_MIN_NOT_MET" | "NO_SHIFT" | "CLOCK_FLAGGED";

export interface DayResult {
  status: string; // P, A, HD, H, O, NM, NS, a leave code, or a split like A:P / PL:P
  firstHalfStatus: string | null;
  secondHalfStatus: string | null;
  source: AttendanceSource;
  capture: Capture;
  lopDays: number;
  flags: ExceptionFlag[];
  workedOnOffDay: boolean;
  provisional: boolean;
  leaveTypeCode: string | null;
  holidayName: string | null;
  shiftCode: string | null;
  firstIn: number | null; // epoch ms
  lastOut: number | null;
  totalMinutes: number | null;
  breakMinutes: number | null;
  actualMinutes: number | null;
  inShiftMinutes: number | null;
  lateInMinutes: number | null;
  earlyOutMinutes: number | null;
  shortfallMinutes: number | null;
  excessMinutes: number | null;
  punchCount: number; // after collapsing near-duplicates
  usedPunchIds: string[];
  collapsedPunches: number;
  manualEntryId: string | null;
  correctionId: string | null; // the regularization request whose time was added
}
