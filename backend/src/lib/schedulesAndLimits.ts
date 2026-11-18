import { getSetting } from "./settings";

// Audit fix 2026-11-18 (docs/plans/AUDIT_FIXES.md items 5 and 6; audit #14, #15, A-17, A-18, A-19, A-21): times and limits that were fixed in code, or stored
// with no screen. None changes pay or leave, so each keeps its value until a director changes it, and the screen says "Default in use: <value>" while nobody has.
// Read here by the code that uses them; written only by modules/settings (System Settings, Schedules and limits).

export type ScheduleLimitKind = "hour" | "time" | "int";
export interface ScheduleLimitDef {
  key: string;
  label: string;
  help: string;
  kind: ScheduleLimitKind;
  defaultValue: number | string;
  min?: number;
  max?: number;
}

export const SCHEDULE_LIMIT_SETTINGS: readonly ScheduleLimitDef[] = [
  { key: "attendance.nightlyHour", label: "Attendance finalises yesterday at (hour, India time)", help: "Choose an hour after every shift of the day before has closed (night shifts included).", kind: "hour", defaultValue: 2, min: 0, max: 23 },
  { key: "attendance.manualReminderHour", label: "\"Still not marked\" reminder at (hour)", help: "Sent to whoever marks attendance for a manual branch.", kind: "hour", defaultValue: 18, min: 0, max: 23 },
  { key: "reports.subscriptionsTime", label: "Scheduled reports are sent at", help: "Weekly reports go on Mondays, monthly ones on the 1st, at this time.", kind: "time", defaultValue: "07:41" },
  { key: "people.dailyJobTime", label: "Daily people job (probation reminders) at", help: "When probation and other people reminders are sent each day.", kind: "time", defaultValue: "08:13" },
  { key: "payroll.directorNoticeEscalationDays", label: "A director notice escalates after (days)", help: "A notice nobody has acknowledged by then gets the red banner.", kind: "int", defaultValue: 3, min: 1, max: 30 },
  { key: "history.maxScheduleAheadDays", label: "A change can be scheduled up to (days ahead)", help: "How far ahead a job, name or attendance change can be dated.", kind: "int", defaultValue: 366, min: 1, max: 1830 },
  { key: "helpdesk.maxAttachmentsPerMessage", label: "Helpdesk: files per message", help: "How many files can be attached to one helpdesk message (at most 10).", kind: "int", defaultValue: 3, min: 1, max: 10 },
  { key: "payroll.salaryAssignmentImportMaxRows", label: "Salary assignment import: rows per file", help: "A larger file is refused; split it.", kind: "int", defaultValue: 500, min: 1, max: 5000 },
  { key: "payroll.monthlyInputsImportMaxRows", label: "Monthly inputs import: rows per file", help: "A larger file is refused; split it.", kind: "int", defaultValue: 1000, min: 1, max: 10000 },
];
export const HELPDESK_ATTACHMENTS_CEILING = 10;
const DEF = new Map(SCHEDULE_LIMIT_SETTINGS.map((d) => [d.key, d]));

/** Is a value valid for its setting? An hour 0-23, a time HH:MM, a whole number within its range. Pure. */
export function scheduleLimitValid(def: ScheduleLimitDef, value: unknown): boolean {
  if (def.kind === "time") return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  return typeof value === "number" && Number.isInteger(value) && value >= (def.min ?? 0) && value <= (def.max ?? Number.MAX_SAFE_INTEGER);
}

/** The value in force (a stored value that is no longer valid reads as the default, never a crash). */
export async function scheduleLimitValue<T extends number | string>(key: string): Promise<T> {
  const def = DEF.get(key);
  if (!def) throw new Error(`Unknown schedule/limit setting ${key}`);
  const stored = await getSetting<unknown>(key, def.defaultValue);
  const v = def.kind !== "time" && typeof stored === "string" ? Number(stored) : stored;
  return (scheduleLimitValid(def, v) ? v : def.defaultValue) as T;
}

/** A cron pattern for a daily job from an hour or an HH:MM time. Pure. */
export function dailyPattern(value: number | string): string {
  if (typeof value === "number") return `0 ${value} * * *`;
  const [h, m] = value.split(":").map(Number) as [number, number];
  return `${m} ${h} * * *`;
}
