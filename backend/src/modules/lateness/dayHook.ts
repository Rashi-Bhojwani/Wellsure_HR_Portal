import { businessToday } from "../../lib/businessDate";
import { prisma } from "../../lib/prisma";
import type { DayInput, DayResult } from "../attendance/engine/types";
import { requestRecomputeRange } from "../attendance/recompute";
import { applyHalfDay, applyMissingPunch, arrivalMinute, cutToAdd, evaluateMonth, factsFromResult, leaveLopOf } from "./evaluate";
import { settingsForMonths } from "./settings";

// The one hook the attendance compute calls (docs/plans/LATE_CHECKLIST.md §4). It wraps the untouched rules engine for one employee-day:
//   half-day thresholds (if the directors chose them) → the engine → missing-punch outcome (if chosen) → a lateness salary cut added to loss of pay (if the rule is on).
// When no month in the range has any of the three in force, the loader returns null and compute calls the engine exactly as before: byte-for-byte the same.

export type Evaluate = (input: DayInput) => DayResult | null;
export type DayHook = (employeeId: string, input: DayInput, evaluate: Evaluate) => DayResult | null;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(new Date(`${s}T00:00:00Z`).getTime() + n * 86_400_000));
const monthEndOf = (month: string) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return iso(new Date(Date.UTC(y, m, 0)));
};
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); ) {
    out.push(m);
    const [y, mo] = m.split("-").map(Number) as [number, number];
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  }
  return out;
}

export async function loadAttendanceDayHook(employeeIds: string[], from: string, last: string, opts: { dryRun: boolean }): Promise<DayHook | null> {
  if (employeeIds.length === 0 || from > last) return null;
  const months = monthsBetween(from, last);
  const settings = await settingsForMonths(months);
  if (![...settings.values()].some((s) => s.rule || s.missingPunch || s.halfDay)) return null;

  // With the rule on: every arrival already on record in those months (earlier days count toward a later day's allowance), and approved waivers.
  const ruleMonths = months.filter((m) => settings.get(m)!.rule);
  const minutes = new Map<string, Map<string, number | null>>(); // employee → date → arrival minute (null = not an arrival)
  const stored = new Map<string, number | null>(); // employee|date → the minute on record before this run
  const waived = new Map<string, Set<string>>();
  if (ruleMonths.length) {
    const rangeFrom = new Date(`${ruleMonths[0]}-01T00:00:00Z`);
    const rangeTo = new Date(`${monthEndOf(ruleMonths.at(-1)!)}T00:00:00Z`);
    const [rows, waivers] = await Promise.all([
      prisma.dailyAttendance.findMany({
        where: { employeeId: { in: employeeIds }, date: { gte: rangeFrom, lte: rangeTo } },
        select: { employeeId: true, date: true, firstIn: true, lastOut: true, provisional: true, status: true, firstHalfStatus: true, source: true, shiftStart: true },
      }),
      prisma.lateWaiver.findMany({ where: { employeeId: { in: employeeIds }, status: "APPROVED", date: { gte: rangeFrom, lte: rangeTo } }, select: { employeeId: true, date: true } }),
    ]);
    for (const r of rows) {
      const date = iso(r.date);
      const rule = settings.get(date.slice(0, 7))?.rule;
      if (!rule) continue;
      const m = arrivalMinute(rule, { firstIn: r.firstIn?.getTime() ?? null, inKnown: r.lastOut !== null || r.provisional, status: r.status, firstHalfStatus: r.firstHalfStatus, source: r.source, shiftStart: r.shiftStart });
      if (!minutes.has(r.employeeId)) minutes.set(r.employeeId, new Map());
      minutes.get(r.employeeId)!.set(date, m);
      stored.set(`${r.employeeId}|${date}`, m);
    }
    for (const w of waivers) {
      if (!waived.has(w.employeeId)) waived.set(w.employeeId, new Set());
      waived.get(w.employeeId)!.add(iso(w.date));
    }
  }
  const followUpAsked = new Set<string>();
  const today = iso(businessToday());

  return (employeeId, input, evaluate) => {
    const s = settings.get(input.date.slice(0, 7))!;
    let r = evaluate(s.halfDay ? applyHalfDay(input, s.halfDay) : input);
    if (r && s.missingPunch) r = applyMissingPunch(r, s.missingPunch.outcome, input);
    if (!s.rule) return r;

    const mine = minutes.get(employeeId) ?? new Map<string, number | null>();
    minutes.set(employeeId, mine);
    const minute = r ? arrivalMinute(s.rule, factsFromResult(r, input)) : null;
    mine.set(input.date, minute);

    // An earlier day's arrival changed: the later days of its month may number differently, so they are worked out again (never a finalised one).
    const key = `${employeeId}|${input.date}`;
    if (!opts.dryRun && (stored.get(key) ?? null) !== minute && !followUpAsked.has(`${employeeId}|${input.date.slice(0, 7)}`)) {
      const start = addDays(input.date > last ? input.date : last, 1);
      const end = [monthEndOf(input.date.slice(0, 7)), today].sort()[0]!;
      if (start <= end) {
        followUpAsked.add(`${employeeId}|${input.date.slice(0, 7)}`);
        void requestRecomputeRange([employeeId], new Date(`${start}T00:00:00Z`), new Date(`${end}T00:00:00Z`));
      }
    }

    if (!r || minute === null) return r;
    const month = input.date.slice(0, 7);
    const arrivals = [...mine].filter(([d, m]) => m !== null && d.startsWith(month) && d <= input.date).map(([date, m]) => ({ date, minute: m! }));
    const today2 = evaluateMonth(s.rule, arrivals, waived.get(employeeId) ?? new Set()).find((a) => a.date === input.date);
    if (today2?.consequence.kind !== "CUT") return r;
    const add = cutToAdd(today2.consequence.days, r.lopDays - leaveLopOf(input));
    return add > 0 ? { ...r, lopDays: r.lopDays + add } : r;
  };
}
