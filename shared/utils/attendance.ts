// Attendance configuration helpers shared by the backend (validation, the
// rules engine) and the frontend (Attendance Settings previews). Pure — no
// Date-in-local-time arithmetic: dates are UTC-midnight business dates and
// times are "HH:MM" local business time (Asia/Kolkata).

export const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "HH:MM" → minutes after midnight. */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
}

export function fromMinutes(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** A shift whose end is at or before its start runs past midnight (it belongs to its start date). */
export function crossesMidnight(startTime: string, endTime: string): boolean {
  return toMinutes(endTime) <= toMinutes(startTime);
}

export type SessionKind = "WORK" | "BREAK";
export interface SessionInput {
  kind: SessionKind;
  label: string;
  startTime: string;
  endTime: string;
}

/** Minutes from the shift start to `hhmm`, on the shift's own timeline (past midnight counts on). */
function offset(shiftStart: string, hhmm: string): number {
  return (toMinutes(hhmm) - toMinutes(shiftStart) + 1440) % 1440;
}

/**
 * What's wrong with a shift's session structure, or [] if nothing. Sessions
 * run back to back from the shift's start to its end, start and end with
 * work, never put two breaks together, and each lasts at least a minute.
 */
export function sessionProblems(startTime: string, endTime: string, sessions: SessionInput[]): string[] {
  const problems: string[] = [];
  if (!TIME_REGEX.test(startTime) || !TIME_REGEX.test(endTime)) return ["Times must be HH:MM (24-hour)."];
  if (startTime === endTime) return ["A shift can't start and end at the same time."];
  const length = offset(startTime, endTime) || 1440;
  if (sessions.length === 0) return ["Add at least one work session."];
  sessions.forEach((s, i) => {
    if (!TIME_REGEX.test(s.startTime) || !TIME_REGEX.test(s.endTime)) problems.push(`Part ${i + 1}: times must be HH:MM (24-hour).`);
    if (!s.label.trim()) problems.push(`Part ${i + 1}: give it a name.`);
  });
  if (problems.length) return problems;
  if (sessions[0]!.kind !== "WORK" || sessions.at(-1)!.kind !== "WORK") problems.push("The shift must start and end with a work session.");
  if (sessions[0]!.startTime !== startTime) problems.push(`The first part must start when the shift starts (${startTime}).`);
  if (sessions.at(-1)!.endTime !== endTime) problems.push(`The last part must end when the shift ends (${endTime}).`);
  let cursor = 0;
  sessions.forEach((s, i) => {
    const from = i === 0 ? 0 : offset(startTime, s.startTime);
    const to = offset(startTime, s.endTime) || length;
    if (i > 0 && from !== cursor) problems.push(`Part ${i + 1} (${s.label}) must start when part ${i} ends (${sessions[i - 1]!.endTime}).`);
    if (to <= from || to > length) problems.push(`Part ${i + 1} (${s.label}) must end after it starts, within the shift.`);
    if (i > 0 && s.kind === "BREAK" && sessions[i - 1]!.kind === "BREAK") problems.push(`Parts ${i} and ${i + 1} are both breaks — merge them.`);
    cursor = to;
  });
  return problems;
}

/** Minutes of scheduled work and scheduled break in a shift. */
export function sessionTotals(startTime: string, sessions: SessionInput[]): { workMinutes: number; breakMinutes: number } {
  let workMinutes = 0;
  let breakMinutes = 0;
  for (const s of sessions) {
    const from = offset(startTime, s.startTime);
    const to = offset(startTime, s.endTime) || 1440;
    const len = Math.max(0, to - from);
    if (s.kind === "WORK") workMinutes += len;
    else breakMinutes += len;
  }
  return { workMinutes, breakMinutes };
}

// ── Week-off patterns ─────────────────────────────────────────────────────

/** weekday 0 = Sunday … 6 = Saturday; weeks = which occurrences in the month (1..5); none = every week. */
export interface WeekOffRule {
  weekday: number;
  weeks?: number[];
}

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export function weekOffRuleProblems(rules: WeekOffRule[]): string[] {
  const problems: string[] = [];
  const seen = new Set<number>();
  for (const r of rules) {
    if (!Number.isInteger(r.weekday) || r.weekday < 0 || r.weekday > 6) problems.push("Each rule needs a weekday (Sunday to Saturday).");
    else if (seen.has(r.weekday)) problems.push(`${WEEKDAY_NAMES[r.weekday]} appears twice — combine its weeks into one rule.`);
    else seen.add(r.weekday);
    if (r.weeks && (r.weeks.length === 0 || r.weeks.some((w) => !Number.isInteger(w) || w < 1 || w > 5))) {
      problems.push("Weeks of the month are 1 to 5 (leave empty for every week).");
    }
  }
  if (seen.size === 7 && rules.every((r) => !r.weeks)) problems.push("Every day can't be a week-off.");
  return problems;
}

/** Is `day` (a UTC-midnight business date) a week-off under `rules`? */
export function isWeekOff(rules: WeekOffRule[], day: Date): boolean {
  const weekday = day.getUTCDay();
  const occurrence = Math.floor((day.getUTCDate() - 1) / 7) + 1; // 1st..5th of this weekday in the month
  return rules.some((r) => r.weekday === weekday && (!r.weeks || r.weeks.includes(occurrence)));
}

/** A plain-English summary, e.g. "Sunday; 2nd and 4th Saturday". */
export function describeWeekOff(rules: WeekOffRule[]): string {
  if (rules.length === 0) return "No week-off";
  const nth = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
  return [...rules]
    .sort((a, b) => a.weekday - b.weekday)
    .map((r) => {
      const name = WEEKDAY_NAMES[r.weekday] ?? "?";
      if (!r.weeks) return name;
      const ws = [...r.weeks].sort().map(nth);
      return `${ws.length > 1 ? `${ws.slice(0, -1).join(", ")} and ${ws.at(-1)}` : ws[0]} ${name}`;
    })
    .join("; ");
}
