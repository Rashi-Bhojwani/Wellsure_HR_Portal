import { addCalendarDays, businessToday } from "./businessDate";
import { prisma } from "./prisma";

// The attendance cycle (docs/plans/PHASE_2.md §2.1, user 2026-10-08): the
// period the muster shows, Phase 3 finalises and Phase 6 pays. A cycle
// starts on `startDay` (1 = the calendar month, user-confirmed; 26 = the
// 26th to the 25th). Rules are effective-dated so a change applies from a
// future boundary and past cycles keep the boundaries they had.

export interface CycleRule {
  effectiveFrom: Date; // UTC midnight
  startDay: number; // 1..28
}

export interface Cycle {
  start: Date; // first day, inclusive
  end: Date; // last day, inclusive
  startDay: number;
  /** e.g. "Oct 2026" for a calendar month, "26 Sep – 25 Oct 2026" otherwise. */
  label: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function utc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d));
}

function fmt(d: Date, withYear: boolean): string {
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${withYear ? ` ${d.getUTCFullYear()}` : ""}`;
}

function labelFor(start: Date, end: Date): string {
  const lastOfMonth = utc(start.getUTCFullYear(), start.getUTCMonth() + 1, 0);
  if (start.getUTCDate() === 1 && end.getTime() === lastOfMonth.getTime()) return `${MONTHS[start.getUTCMonth()]} ${start.getUTCFullYear()}`;
  return `${fmt(start, start.getUTCFullYear() !== end.getUTCFullYear())} – ${fmt(end, true)}`;
}

/** The rule in force on `day` (rules sorted oldest first), and the next rule's start. */
function ruleOn(rules: CycleRule[], day: Date): { rule: CycleRule; next: CycleRule | null } {
  let idx = -1;
  rules.forEach((r, i) => {
    if (r.effectiveFrom <= day) idx = i;
  });
  if (idx === -1) return { rule: { effectiveFrom: new Date(0), startDay: 1 }, next: rules[0] ?? null };
  return { rule: rules[idx]!, next: rules[idx + 1] ?? null };
}

/**
 * The cycle containing `day`, under `rules` (pure; sorted or not). A cycle
 * never straddles a rule change: the one before a change is clipped to end
 * the day before it (the transition cycle), and the first under a new rule
 * starts on its effective date.
 */
export function cycleForRules(rules: CycleRule[], day: Date): Cycle {
  const sorted = [...rules].sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());
  const { rule, next } = ruleOn(sorted, day);
  const y = day.getUTCFullYear();
  const m = day.getUTCMonth();
  let start = day.getUTCDate() >= rule.startDay ? utc(y, m, rule.startDay) : utc(y, m - 1, rule.startDay);
  let end = addCalendarDays(utc(start.getUTCFullYear(), start.getUTCMonth() + 1, rule.startDay), -1);
  if (start < rule.effectiveFrom) start = rule.effectiveFrom;
  if (next && end >= next.effectiveFrom) end = addCalendarDays(next.effectiveFrom, -1);
  return { start, end, startDay: rule.startDay, label: labelFor(start, end) };
}

export async function loadCycleRules(): Promise<CycleRule[]> {
  return prisma.attendanceCycleRule.findMany({ orderBy: { effectiveFrom: "asc" }, select: { effectiveFrom: true, startDay: true } });
}

/** The attendance cycle containing `day`. */
export async function cycleFor(day: Date): Promise<Cycle> {
  return cycleForRules(await loadCycleRules(), day);
}

/** `count` cycles ending with the one containing `day`, newest first (the muster's "Select Attendance Cycle"). */
export function recentCycles(rules: CycleRule[], day: Date, count: number): Cycle[] {
  const out: Cycle[] = [];
  let cursor = day;
  for (let i = 0; i < count; i++) {
    const c = cycleForRules(rules, cursor);
    out.push(c);
    cursor = addCalendarDays(c.start, -1);
  }
  return out;
}

/**
 * Why a new start day can't apply from `from`, or null when it can. A change
 * applies only from a future boundary: after the cycle containing today
 * ends (so today's cycle, and every past one, keeps its boundaries), on the
 * new start day itself.
 */
export function cycleChangeProblem(rules: CycleRule[], from: Date, startDay: number, today: Date = businessToday()): string | null {
  if (!Number.isInteger(startDay) || startDay < 1 || startDay > 28) return "The cycle start day must be between 1 and 28.";
  if (from.getUTCDate() !== startDay) return `A cycle starting on day ${startDay} must take effect on a ${startDay}${ordinal(startDay)} of the month.`;
  const current = cycleForRules(rules, today);
  if (from <= current.end) return `The current cycle (${current.label}) keeps its boundaries. Choose a date after ${fmt(current.end, true)}.`;
  return null;
}

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  return ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
}
