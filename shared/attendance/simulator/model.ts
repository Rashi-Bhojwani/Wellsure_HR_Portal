// The simulator's vocabulary (docs/plans/PHASE_2.md "P2-G build design").
// Deliberately its own types, shaped for describing a month, not for running the
// engine: nothing here imports the engine or the backend.

export type Capture = "DEVICE" | "MANUAL";

export interface SimSession {
  kind: "WORK" | "BREAK";
  label: string;
  start: string; // "HH:MM"
  end: string;
}

export interface SimShift {
  code: string;
  name: string;
  start: string;
  end: string; // at or before start: crosses midnight, and belongs to its start date
  graceInMinutes: number;
  graceOutMinutes: number;
  windowBeforeMinutes: number;
  windowAfterMinutes: number;
  sessions: SimSession[];
}

export interface SimPolicy {
  code: string;
  name: string;
  fullDayMinMinutes: number;
  halfDayMinMinutes: number;
  halfDayMinNotMetLopDays: number;
  nearDuplicateSeconds: number;
}

export interface SimWeekOff {
  code: string;
  name: string;
  rules: Array<{ weekday: number; weeks?: number[] }>;
}

export interface SimLeaveType {
  code: string;
  name: string;
  paid: boolean;
}

export type LeavePart = "FULL" | "FIRST_HALF" | "SECOND_HALF";

export interface SimLeave {
  date: string;
  part: LeavePart;
  type: string; // SimLeaveType.code
}

export type Archetype = "day-std" | "day-strict" | "day-sat" | "night" | "manual" | "joiner" | "leaver" | "mapped-late" | "night-leaver";

export interface SimEmployee {
  code: string; // employee code = the device user ID unless a mapping says otherwise
  deviceUserId: string;
  archetype: Archetype;
  shift: string;
  policy: string;
  weekOff: string;
  joined: string; // "YYYY-MM-DD"
  lastWorking: string | null;
  capture: Capture; // for the month as a whole; `mappingFrom` makes it start mid-month
  /** A device mapping in force from this date (null: all month for DEVICE, never for MANUAL). */
  mappingFrom: string | null;
  leaves: SimLeave[];
}

export interface SimHoliday {
  date: string;
  name: string;
}

export interface Masters {
  shifts: SimShift[];
  policies: SimPolicy[];
  weekOffs: SimWeekOff[];
  leaveTypes: SimLeaveType[];
  holidays: SimHoliday[];
}

export interface Roster {
  seed: number;
  month: string; // "YYYY-MM"
  from: string;
  to: string;
  masters: Masters;
  employees: SimEmployee[];
  /** Device user IDs no employee has: their punches must land in the unmapped queue and change no one's day. */
  unmappedDeviceUserIds: string[];
}

/** When the punches of a day reach the server. "live": as they happen. "late": days later but inside the plausibility window. "stale": beyond it, so flagged. */
export type Delivery = "live" | "late" | "stale";

export interface PunchSpec {
  /** Seconds on the START date's timeline (can exceed 86,400 for after midnight). */
  at: number;
  delivery: Delivery;
}

export type ManualSpec = { kind: "TIMED"; inTime: string; outTime: string | null } | { kind: "STATUS_ONLY"; status: "P" | "A" | "HD_FIRST" | "HD_SECOND" | "WORKED" };

/** What a scenario *declares* should happen: the human-readable leg, a closed form of its parameters. Partial: only what defines the scenario. */
export interface Intent {
  noRecord?: boolean;
  status?: string;
  halves?: [string, string];
  lop?: number;
  flags?: string[]; // as a set
  late?: number | null;
  early?: number | null;
  actual?: number | null;
  punchCount?: number;
  collapsed?: number;
  workedOnOffDay?: boolean;
}

/** The full expected day: every field the replay compares. Minutes are whole minutes; times are device-local text. */
export interface ExpectedDay {
  status: string;
  firstHalf: string | null;
  secondHalf: string | null;
  source: "DEVICE" | "MANUAL" | "LEAVE" | "HOLIDAY" | "WEEK_OFF";
  capture: Capture;
  lopDays: number;
  flags: string[]; // sorted
  workedOnOffDay: boolean;
  provisional: false;
  shiftCode: string;
  holidayName: string | null;
  leaveTypeCode: string | null;
  punchCount: number;
  collapsedPunches: number;
  firstIn: string | null;
  lastOut: string | null;
  totalMinutes: number | null;
  breakMinutes: number | null;
  actualMinutes: number | null;
  inShiftMinutes: number | null;
  lateInMinutes: number | null;
  earlyOutMinutes: number | null;
  shortfallMinutes: number | null;
  excessMinutes: number | null;
  /** Punches the engine found in no day's window (counted, never silently lost). */
  outsideWindowPunches: number;
}

/** One employee-day of the plan. */
export interface DayPlan {
  employee: string; // SimEmployee.code
  date: string;
  scenario: string;
  params: Record<string, number | string>;
  why: string;
  punches: PunchSpec[];
  /** Punches in no day's window (a scenario's stray): delivered, not part of the day. */
  outside: PunchSpec[];
  /** Punches of the employee's own device ID that no mapping covers on this date (before a mapping starts): delivered, and they must land in the unmapped queue. */
  unmapped: PunchSpec[];
  manual: ManualSpec | null;
  /** null: no record should exist for this employee-day. */
  expected: ExpectedDay | null;
}
