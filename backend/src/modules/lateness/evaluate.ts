import type { DayInput, DayResult } from "../attendance/engine/types";

// The lateness rule, pure (docs/plans/LATE_CHECKLIST.md §2). No database, no clock: the attendance hook and every screen use these same functions, so what a
// screen says is exactly what loss of pay and the payslip got.

export type Edge = "INCLUSIVE" | "EXCLUSIVE";
export interface Cutoff {
  time: string; // HH:MM, Asia/Kolkata
  edge: Edge; // INCLUSIVE: the cutoff minute itself is late
}
export type Outcome = { kind: "NOT_SET" } | { kind: "NONE" } | { kind: "MARK" } | { kind: "CUT"; days: string } | { kind: "PENALTY"; amount: string };
export type Applies = { mode: "EVERY_TIME" } | { mode: "AFTER_FREE"; free: number };
export interface Band {
  outcome: Outcome;
  applies: Applies;
}
export interface LateRule {
  effectiveFrom: string;
  active: boolean;
  cutoffs: [Cutoff, Cutoff, Cutoff];
  bands: [Band, Band, Band];
  penaltyHead: string | null;
}
export interface MissingPunchSetting {
  effectiveFrom: string;
  outcome: "ABSENT_FULL_DAY" | "HALF_DAY" | "PRESENT_FLAGGED";
}
export interface HalfDaySetting {
  effectiveFrom: string;
  fullDayMinMinutes: number;
  halfDayMinMinutes: number;
  halfDayMinNotMetLopDays: "0.5" | "1";
}

/** The owners' proposed starting values: shown on the screen, never in force until two directors confirm them (and switch the rule on). */
export const DEFAULT_RULE: LateRule = {
  effectiveFrom: "2026-12-01",
  active: false,
  cutoffs: [
    { time: "10:10", edge: "INCLUSIVE" },
    { time: "10:20", edge: "INCLUSIVE" },
    { time: "10:30", edge: "INCLUSIVE" },
  ],
  bands: [
    { outcome: { kind: "NOT_SET" }, applies: { mode: "EVERY_TIME" } },
    { outcome: { kind: "CUT", days: "0.5" }, applies: { mode: "AFTER_FREE", free: 3 } },
    { outcome: { kind: "CUT", days: "0.5" }, applies: { mode: "EVERY_TIME" } },
  ],
  penaltyHead: null,
};

const IST_OFFSET_MS = 19_800_000; // Asia/Kolkata is UTC+05:30 all year (no daylight saving)
const DAY_MS = 86_400_000;

export const minuteOf = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
/** The Asia/Kolkata minute of the day of an instant, seconds dropped (10:09:59 is 10:09). */
export const istMinute = (epochMs: number): number => Math.floor((((epochMs + IST_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS / 60_000);
export const hhmmOf = (minute: number): string => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

/** Past a cutoff: on or after it (inclusive edge), or strictly after it (exclusive edge). */
export function pastCutoff(minute: number, c: Cutoff): boolean {
  const m = minuteOf(c.time);
  return c.edge === "INCLUSIVE" ? minute >= m : minute > m;
}

/** 0 = on time; 1, 2, 3 = the highest cutoff passed. */
export function bandOf(minute: number, cutoffs: readonly Cutoff[]): 0 | 1 | 2 | 3 {
  let band = 0;
  cutoffs.forEach((c, i) => {
    if (pastCutoff(minute, c)) band = i + 1;
  });
  return band as 0 | 1 | 2 | 3;
}

/** What the rule needs to know about a day, from the engine's result (live) or the stored row (screens): the same fields either way. */
export interface ArrivalFacts {
  firstIn: number | null; // epoch ms
  inKnown: boolean; // a second punch, or the day still open (the engine's own test: a lone punch on a closed day may be the out)
  status: string;
  firstHalfStatus: string | null;
  source: string;
  shiftStart: string | null; // HH:MM
}

const WORKING_HALF = new Set(["P", "A", "NM"]);

/** The arrival minute if this day counts as an arrival under the rule, else null. */
export function arrivalMinute(rule: Pick<LateRule, "cutoffs">, f: ArrivalFacts): number | null {
  if (f.firstIn === null || !f.inKnown) return null;
  if (f.source === "HOLIDAY" || f.source === "WEEK_OFF" || f.source === "LEAVE") return null;
  // The first half must be a working half (a first-half leave means the person was not due in the morning).
  if (f.firstHalfStatus !== null && !WORKING_HALF.has(f.firstHalfStatus)) return null;
  // Only shifts that start before the first cutoff (a night or afternoon shift is never "late" by a morning clock time).
  if (!f.shiftStart || minuteOf(f.shiftStart) >= minuteOf(rule.cutoffs[0].time)) return null;
  return istMinute(f.firstIn);
}

export const factsFromResult = (r: DayResult, input: Pick<DayInput, "shift">): ArrivalFacts => ({
  firstIn: r.firstIn,
  inKnown: r.lastOut !== null || r.provisional,
  status: r.status,
  firstHalfStatus: r.firstHalfStatus,
  source: r.source,
  shiftStart: input.shift?.startTime ?? null,
});

export type Consequence =
  | { kind: "WAIVED" }
  | { kind: "FREE"; allowanceNo: number; of: number } // an allowance used: a late mark, nothing else
  | { kind: "NOT_SET" } // behaves as no consequence
  | { kind: "NONE" }
  | { kind: "MARK" }
  | { kind: "CUT"; days: number }
  | { kind: "PENALTY"; amount: string };

export interface ArrivalResult {
  date: string;
  minute: number;
  band: 1 | 2 | 3;
  consequence: Consequence;
}

/**
 * One employee's late arrivals in one calendar month, in date order. Per band, the arrivals not waived are numbered; AFTER_FREE N: 1..N use an allowance, N+1 on
 * take the band's outcome. EVERY_TIME: the outcome every time, no allowance used. A waived arrival is not counted at all (its allowance comes back).
 */
export function evaluateMonth(rule: LateRule, arrivals: ReadonlyArray<{ date: string; minute: number }>, waived: ReadonlySet<string>): ArrivalResult[] {
  const seen = [0, 0, 0];
  const out: ArrivalResult[] = [];
  for (const a of [...arrivals].sort((x, y) => x.date.localeCompare(y.date))) {
    const band = bandOf(a.minute, rule.cutoffs);
    if (band === 0) continue;
    if (waived.has(a.date)) {
      out.push({ date: a.date, minute: a.minute, band, consequence: { kind: "WAIVED" } });
      continue;
    }
    const b = rule.bands[band - 1]!;
    seen[band - 1]! += 1;
    const n = seen[band - 1]!;
    let consequence: Consequence;
    if (b.applies.mode === "AFTER_FREE" && n <= b.applies.free) consequence = { kind: "FREE", allowanceNo: n, of: b.applies.free };
    else if (b.outcome.kind === "CUT") consequence = { kind: "CUT", days: Number(b.outcome.days) };
    else if (b.outcome.kind === "PENALTY") consequence = { kind: "PENALTY", amount: b.outcome.amount };
    else consequence = { kind: b.outcome.kind };
    out.push({ date: a.date, minute: a.minute, band, consequence });
  }
  return out;
}

/** Allowances left this month per band (null for a band that uses none). */
export function allowancesLeft(rule: LateRule, results: readonly ArrivalResult[]): Array<{ band: 1 | 2 | 3; free: number; used: number; left: number } | null> {
  return rule.bands.map((b, i) => {
    if (b.applies.mode !== "AFTER_FREE") return null;
    const used = results.filter((r) => r.band === i + 1 && r.consequence.kind !== "WAIVED").length;
    const usedFree = Math.min(used, b.applies.free);
    return { band: (i + 1) as 1 | 2 | 3, free: b.applies.free, used: usedFree, left: b.applies.free - usedFree };
  });
}

/**
 * Higher-of (salary cut): the day already loses `hoursLop` days for short hours (or a missing punch); a lateness cut of `cut` days makes the day lose the higher of
 * the two, never both. Returns the days to add to the day's loss of pay.
 */
export function cutToAdd(cut: number, hoursLop: number): number {
  return Math.max(0, cut - hoursLop);
}

/** Unpaid leave on the day's halves (0.5 each): not an hours consequence, so never compared. */
export function leaveLopOf(input: Pick<DayInput, "leave">): number {
  return (input.leave.first?.unpaid ? 0.5 : 0) + (input.leave.second?.unpaid ? 0.5 : 0);
}

/** The missing-punch choice applied to a closed day with a single punch. ABSENT_FULL_DAY (the default) leaves the engine's result as it is. */
export function applyMissingPunch(r: DayResult, outcome: MissingPunchSetting["outcome"], input: Pick<DayInput, "leave">): DayResult {
  if (outcome === "ABSENT_FULL_DAY" || !r.flags.includes("MISSING_PUNCH")) return r;
  const working: [boolean, boolean] = [!input.leave.first, !input.leave.second];
  const leaveLop = leaveLopOf(input);
  if (outcome === "HALF_DAY") {
    if (!(working[0] && working[1])) return r; // half a working half is not a thing: a day with one working half stays absent for it
    return { ...r, status: "HD", firstHalfStatus: null, secondHalfStatus: null, lopDays: 0.5 + leaveLop };
  }
  const h1 = working[0] ? "P" : r.firstHalfStatus;
  const h2 = working[1] ? "P" : r.secondHalfStatus;
  return { ...r, status: h1 === h2 ? (h1 ?? "") : `${h1}:${h2}`, firstHalfStatus: h1, secondHalfStatus: h2, lopDays: leaveLop };
}

/** The half-day thresholds choice: replaces the policy's figures for the engine (no policy, nothing to replace). */
export function applyHalfDay(input: DayInput, s: HalfDaySetting): DayInput {
  if (!input.policy) return input;
  return { ...input, policy: { ...input.policy, fullDayMinMinutes: s.fullDayMinMinutes, halfDayMinMinutes: s.halfDayMinMinutes, halfDayMinNotMetLopDays: Number(s.halfDayMinNotMetLopDays) } };
}

/** Words for a band, for screens and payslip reasons: "10:10 to 10:20", "after 10:30". */
export function bandLabel(rule: Pick<LateRule, "cutoffs">, band: 1 | 2 | 3): string {
  return band === 3 ? `after ${rule.cutoffs[2].time}` : `${rule.cutoffs[band - 1]!.time} to ${rule.cutoffs[band]!.time}`;
}
