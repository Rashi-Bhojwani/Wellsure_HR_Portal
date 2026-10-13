import type { DailyAttendance } from "@prisma/client";
import { instantToLocalTime } from "@shared/attendance/attlog";
import { dayStartMs, hhmmToSeconds, shiftTimeline } from "../engine/time";
import type { ShiftDef } from "../engine/types";

// What a regularization asks for, and whether a day can take it (docs/plans/PHASE_3.md, commit 1). Pure:
// the single request, the approval re-check and the bulk preview all use these, so they cannot disagree.

export type TargetStatus = "P" | "A" | "HD_FIRST" | "HD_SECOND";
export interface Correction {
  inTime?: string | null;
  outTime?: string | null;
  status?: TargetStatus | null;
}

export const REASON_LABEL: Record<string, string> = {
  FORGOT_TO_PUNCH: "Forgot to punch",
  DEVICE_DOWN: "Device was down",
  ON_DUTY_ELSEWHERE: "On duty elsewhere",
  OTHER: "Other",
};

const STATUS_LABEL: Record<TargetStatus, string> = { P: "Present", A: "Absent", HD_FIRST: "Half day (first half present)", HD_SECOND: "Half day (second half present)" };

/** "Present", "In 10:00 · Out 19:00", "Out 19:00": the correction in words. */
export function describeCorrection(c: Correction): string {
  if (c.status) return STATUS_LABEL[c.status];
  return [c.inTime ? `In ${c.inTime}` : null, c.outTime ? `Out ${c.outTime}` : null].filter(Boolean).join(" · ");
}

/** The override row a correction becomes: one time adds, two replace, a status sets. */
export function overrideShape(c: Correction): { kind: "ADD_TIME" | "TIMES" | "STATUS"; inTime: string | null; outTime: string | null; status: string | null } {
  if (c.status) return { kind: "STATUS", inTime: null, outTime: null, status: c.status };
  if (c.inTime && c.outTime) return { kind: "TIMES", inTime: c.inTime, outTime: c.outTime, status: null };
  return { kind: "ADD_TIME", inTime: c.inTime ?? null, outTime: c.outTime ?? null, status: null };
}

export type Problem = { code: string; message: string };

/** The code → short label shown for a group of days that cannot be corrected. */
export const PROBLEM_LABEL: Record<string, string> = {
  NO_RECORD: "No attendance record yet (not processed): run Process Attendance for the dates first",
  NOT_OVER: "The day isn't over yet",
  TOO_OLD: "Older than corrections reach",
  LOCKED: "Finalised",
  MANUAL_CAPTURE: "Marked by hand (corrected in the muster)",
  OFF_DAY: "A holiday or week-off",
  ON_LEAVE: "On approved leave",
  ALREADY_CORRECTED: "Already corrected",
  PENDING_EXISTS: "A request is already waiting",
  NO_SHIFT: "No shift assigned",
  NEEDS_BOTH_TIMES: "No punches that day: both times are needed",
  OUT_OF_WINDOW: "A time is outside the shift's punch window",
  BAD_TIMES: "The times don't fit the day",
  OWN_DAY: "Your own day (someone else corrects it)",
};

export interface DayContext {
  today: string; // business date
  earliest: string; // the oldest date a correction may reach (start of the cycle `backdateCycles` back)
  pending: boolean;
  corrected: boolean; // an approved correction or a manual override is already on the day
}

/** Why this day cannot be corrected at all (whatever the correction), or null if it can. */
export function dayProblem(row: DailyAttendance | null | undefined, date: string, ctx: DayContext): Problem | null {
  const notOver = { code: "NOT_OVER", message: "The day isn't over yet: a correction can be made once the shift's punch window has closed." };
  if (date >= ctx.today) return notOver;
  if (date < ctx.earliest) return { code: "TOO_OLD", message: "Corrections reach back to the start of the previous attendance cycle only." };
  if (!row) return { code: "NO_RECORD", message: "There's no attendance record for this day." };
  if (row.provisional) return notOver;
  if (row.isLocked) return { code: "LOCKED", message: "This day's attendance is finalised." };
  if (row.capture !== "DEVICE") return { code: "MANUAL_CAPTURE", message: "Attendance for this person is marked by hand; the person who marks their branch corrects it in the muster." };
  if (row.source === "HOLIDAY" || row.source === "WEEK_OFF") return { code: "OFF_DAY", message: "This was a holiday or week-off." };
  if (row.source === "LEAVE") return { code: "ON_LEAVE", message: "This day is on approved leave." };
  if (ctx.corrected || row.overrideKind) return { code: "ALREADY_CORRECTED", message: "This day has already been corrected." };
  if (ctx.pending) return { code: "PENDING_EXISTS", message: "There's already a request waiting for this day." };
  if (row.status === "NS") return { code: "NO_SHIFT", message: "No shift was assigned for this day, so there is nothing to correct it against." };
  return null;
}

const TZ = "Asia/Kolkata";
const hhmm = (d: Date) => instantToLocalTime(d, TZ).slice(11, 16);

/** Why this correction does not fit this day (given what the day has), or null. `shift` is the one in force that day. */
export function correctionProblem(c: Correction, row: Pick<DailyAttendance, "punchCount" | "firstIn" | "lastOut">, date: string, shift: ShiftDef | null, nearDuplicateSeconds: number): Problem | null {
  if (c.status) return null;
  const tl = shift ? shiftTimeline(shift) : null;
  const seconds = (t: string) => {
    let s = hhmmToSeconds(t);
    if (tl && tl.end > 86_400 && s < tl.windowStart) s += 86_400; // a night shift's early-morning time is the next day
    return s;
  };
  for (const t of [c.inTime, c.outTime]) {
    if (t && tl && (seconds(t) < tl.windowStart || seconds(t) > tl.windowEnd)) {
      return { code: "OUT_OF_WINDOW", message: `${t} is outside the shift's punch window (${hhmm(new Date(dayStartMs(date) + tl.windowStart * 1000))}–${hhmm(new Date(dayStartMs(date) + tl.windowEnd * 1000))}).` };
    }
  }
  if (c.inTime && c.outTime) {
    return c.inTime === c.outTime ? { code: "BAD_TIMES", message: "The in and out times are the same." } : null;
  }
  if (row.punchCount === 0 || !row.firstIn) return { code: "NEEDS_BOTH_TIMES", message: "There are no punches that day, so give both the time in and the time out." };
  const base = dayStartMs(date);
  const at = base + seconds((c.inTime ?? c.outTime)!) * 1000;
  const near = nearDuplicateSeconds * 1000;
  if (c.inTime) {
    if (at >= row.firstIn.getTime() - near) return { code: "BAD_TIMES", message: `The time in must be before the first punch at ${hhmm(row.firstIn)}.` };
  } else {
    const last = (row.lastOut ?? row.firstIn).getTime();
    if (at <= last + near) return { code: "BAD_TIMES", message: `The time out must be after the last punch at ${hhmm(row.lastOut ?? row.firstIn)}.` };
  }
  return null;
}
