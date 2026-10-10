import { formatAttlogLine } from "../attlog";
import type { DayPlan, Delivery, ExpectedDay, Intent, LeavePart, ManualSpec, PunchSpec, Roster, SimEmployee, SimLeaveType, SimPolicy, SimShift } from "./model";
import { intentMismatches, layoutOf, referenceDay, type Layout, type RefDay } from "./reference";
import { hashSeed, makeRng, type Rng } from "./rng";
import { isWeekOffByPattern } from "./roster";
import * as S from "./scenarios";
import { addDays, datesBetween, localText } from "./time";

// A month, planned (docs/plans/PHASE_2.md "P2-G build design"): for every
// employee-day, the punches or manual entry a named scenario builds, and the
// full expected day. Pure and seeded: the same roster gives the same plan,
// whatever order it is built in, because each employee-day draws from its own
// stream.

export interface MonthPlan {
  roster: Roster;
  days: DayPlan[];
  /** Where a scenario's declared intent and the reference model disagree: bugs in the simulator itself, which the replay refuses to run past. */
  problems: string[];
}

interface Index {
  shifts: Map<string, SimShift>;
  layouts: Map<string, Layout>;
  policies: Map<string, SimPolicy>;
  weekOffs: Map<string, Array<{ weekday: number; weeks?: number[] }>>;
  leaveTypes: Map<string, SimLeaveType>;
  holidays: Map<string, string>;
}

export function indexOf(roster: Roster): Index {
  const m = roster.masters;
  return {
    shifts: new Map(m.shifts.map((s) => [s.code, s])),
    layouts: new Map(m.shifts.map((s) => [s.code, layoutOf(s)])),
    policies: new Map(m.policies.map((p) => [p.code, p])),
    weekOffs: new Map(m.weekOffs.map((w) => [w.code, w.rules])),
    leaveTypes: new Map(m.leaveTypes.map((l) => [l.code, l])),
    holidays: new Map(m.holidays.map((h) => [h.date, h.name])),
  };
}

const named = (s: S.Scenario, g: S.Generated | null) => (g ? { name: s.name, g } : null);

function workingDay(c: S.GenCtx, force?: string): { name: string; g: S.Generated } {
  const chosen = force ? (S.WORKING_DAY_SCENARIOS.find(([s]) => s.name === force)?.[0] ?? c.rng.weighted(S.WORKING_DAY_SCENARIOS)) : c.rng.weighted(S.WORKING_DAY_SCENARIOS);
  return named(chosen, chosen.generate(c)) ?? named(S.FALLBACK, S.FALLBACK.generate(c)) ?? { name: "never-punches", g: S.WORKING_DAY_SCENARIOS.find(([s]) => s.name === "never-punches")![0].generate(c)! };
}

function planDay(ix: Index, roster: Roster, emp: SimEmployee, date: string, force?: string): { plan: DayPlan; problems: string[] } {
  const shift = ix.shifts.get(emp.shift)!;
  const policy = ix.policies.get(emp.policy)!;
  const layout = ix.layouts.get(emp.shift)!;
  const rng = makeRng(hashSeed(roster.seed, emp.code, date));
  const c: S.GenCtx = { rng, shift, policy, layout };

  const employed = emp.joined <= date && (!emp.lastWorking || date <= emp.lastWorking);
  const holiday = ix.holidays.get(date) ?? null;
  const weekOff = isWeekOffByPattern(ix.weekOffs.get(emp.weekOff)!, date);
  const capture = emp.mappingFrom !== null && date >= emp.mappingFrom ? ("DEVICE" as const) : ("MANUAL" as const);
  const leaves = emp.leaves.filter((l) => l.date === date);
  const half = (part: LeavePart) => leaves.find((l) => l.part === part || l.part === "FULL");
  const first = half("FIRST_HALF");
  const second = half("SECOND_HALF");
  const unpaid = (code: string) => !ix.leaveTypes.get(code)!.paid;

  let picked: { name: string; g: S.Generated };
  if (!employed) {
    // Sometimes the card still punches (before joining, after leaving): no record either way.
    const edge = date === addDays(emp.joined, -1) || (emp.lastWorking !== null && date === addDays(emp.lastWorking, 1));
    picked = { name: "not-employed", g: S.notEmployed(c, capture === "DEVICE" && (edge || rng.chance(0.3))) };
  } else if (holiday !== null || weekOff) {
    if (capture === "DEVICE") {
      const works = rng.chance(0.12);
      const g = works ? S.offDayWork_generate(c) : null;
      picked = g ? { name: holiday !== null ? "holiday-work" : "weekoff-work", g } : { name: "off-day-quiet", g: S.offDayQuiet_generate() };
    } else {
      const worked = rng.chance(0.08);
      picked = worked
        ? { name: holiday !== null ? "holiday-work" : "weekoff-work", g: { params: { status: "WORKED" }, punches: [], manual: { kind: "STATUS_ONLY", status: "WORKED" }, intent: { flags: [], lop: 0, workedOnOffDay: true, punchCount: 0 }, why: "a manual entry says they worked the day off" } }
        : { name: "off-day-quiet", g: S.offDayQuiet_generate() };
    }
  } else if (first && second) {
    picked = { name: "leave-full", g: S.leaveFull(first.type, unpaid(first.type)) };
  } else if (first || second) {
    const l = (first ?? second)!;
    const leaveHalf = first ? ("first" as const) : ("second" as const);
    const worked = rng.chance(0.6) ? S.leaveHalfWorked(c, leaveHalf, l.type, unpaid(l.type)) : null;
    picked = worked ? { name: "leave-half-worked", g: worked } : { name: "leave-half-no-show", g: S.leaveHalfNoShow(leaveHalf, l.type, unpaid(l.type)) };
  } else if (capture === "DEVICE" && force) {
    picked = workingDay(c, force);
  } else if (capture === "DEVICE" && (date === emp.lastWorking || date === emp.joined)) {
    // The first and last day of someone's employment are always an ordinary working day: the edges are where windows and assignments meet.
    const g = S.WORKING_DAY_SCENARIOS[0]![0].generate(c);
    picked = g ? { name: "normal-day", g } : { name: "never-punches", g: S.WORKING_DAY_SCENARIOS.find(([x]) => x.name === "never-punches")![0].generate(c)! };
  } else if (capture === "DEVICE") {
    picked = workingDay(c);
  } else {
    const opts: Array<[string, number]> = [["manual-nothing", 55], ["manual-status", 25], ["manual-timed", 15], ["manual-in-only", 5]];
    const name = rng.weighted(opts);
    const g = name === "manual-status" ? S.manualStatus(c) : name === "manual-timed" ? S.manualTimed(c) : name === "manual-in-only" ? S.manualInOnly(c) : S.manualNothing();
    picked = { name: g ? name : "manual-nothing", g: g ?? S.manualNothing() };
  }

  const g = picked.g;
  const punches = g.punches;
  const stale = punches.filter((p) => p.delivery === "stale").length;
  const ref: RefDay = {
    date,
    employed,
    holiday,
    weekOff,
    leave: { first: first ? ix.leaveTypes.get(first.type)! : null, second: second ? ix.leaveTypes.get(second.type)! : null },
    capture,
    manual: g.manual ?? null,
    punches: capture === "DEVICE" ? punches.filter((p) => p.delivery !== "stale").map((p) => p.at) : [],
    flaggedExcluded: capture === "DEVICE" ? stale : 0,
    outsideWindowPunches: g.outside?.length ?? 0,
    shift,
    policy,
  };
  const expected: ExpectedDay | null = referenceDay(ref);

  // Before a mapping starts the device still punched, under an ID nobody holds yet: those punches must land in the unmapped queue.
  let unmapped: PunchSpec[] = [];
  if (employed && capture === "MANUAL" && emp.mappingFrom !== null && rng.chance(0.4)) {
    const n = S.WORKING_DAY_SCENARIOS[0]![0].generate(c);
    if (n) unmapped = n.punches;
  }

  const problems = intentMismatches(g.intent, expected).map((m) => `${emp.code} ${date} ${picked.name} ${JSON.stringify(g.params)}: ${m}`);
  return {
    plan: { employee: emp.code, date, scenario: picked.name, params: g.params, why: g.why, punches, outside: g.outside ?? [], unmapped, manual: g.manual ?? null, expected },
    problems,
  };
}

export function planMonth(roster: Roster): MonthPlan {
  const ix = indexOf(roster);
  const days: DayPlan[] = [];
  const problems: string[] = [];
  for (const emp of roster.employees) {
    for (const date of datesBetween(roster.from, roster.to)) {
      const r = planDay(ix, roster, emp, date);
      days.push(r.plan);
      problems.push(...r.problems);
    }
  }
  return { roster, days, problems };
}

/** Names of the working-day scenarios that can be asked for by name. */
export const NAMED_SCENARIOS: string[] = S.WORKING_DAY_SCENARIOS.map(([s]) => s.name);

/**
 * Some days of a roster, optionally every working day forced to one named scenario
 * (the CLI's `scenario` command). Holidays, week-offs, leave and non-employment
 * still decide first, exactly as in a month: a scenario is a way of working, not a
 * way of ignoring the calendar.
 */
export function planDays(roster: Roster, opts: { scenario?: string; employees?: string[]; dates?: string[] } = {}): MonthPlan {
  const ix = indexOf(roster);
  const days: DayPlan[] = [];
  const problems: string[] = [];
  const dates = opts.dates ?? datesBetween(roster.from, roster.to);
  for (const emp of roster.employees) {
    if (opts.employees && !opts.employees.includes(emp.code)) continue;
    for (const date of dates) {
      const r = planDay(ix, roster, emp, date, opts.scenario);
      days.push(r.plan);
      problems.push(...r.problems);
    }
  }
  return { roster, days, problems };
}

/** One employee-day for a named scenario on a given shift and policy: for the catalogue and the tests. */
export function generateFor(scenario: S.Scenario, shift: SimShift, policy: SimPolicy, seed: number): S.Generated | null {
  return scenario.generate({ rng: makeRng(seed), shift, policy, layout: layoutOf(shift) });
}

// ── The lines the device would send, and what the server should make of them ──

export interface PlannedLine {
  deviceUserId: string;
  localTime: string;
  delivery: Delivery;
  /** The ATTLOG line, exactly the device's format. */
  line: string;
  /** "mapped": belongs to this employee's day; "unmapped": no mapping covers it (it must land in the unmapped queue). */
  kind: "mapped" | "unmapped";
  employee: string | null;
}

export function linesOf(plan: MonthPlan): PlannedLine[] {
  const byEmployee = new Map(plan.roster.employees.map((e) => [e.code, e]));
  const out: PlannedLine[] = [];
  const seen = new Set<string>();
  const add = (deviceUserId: string, date: string, p: PunchSpec, kind: PlannedLine["kind"], employee: string | null) => {
    const localTime = localText(date, p.at);
    const key = `${deviceUserId}|${localTime}`;
    if (seen.has(key)) return; // the device never sends the same punch twice, and neither does a plan
    seen.add(key);
    out.push({ deviceUserId, localTime, delivery: p.delivery, line: formatAttlogLine({ deviceUserId, localTime }), kind, employee });
  };
  for (const d of plan.days) {
    const emp = byEmployee.get(d.employee)!;
    for (const p of d.punches) add(emp.deviceUserId, d.date, p, "mapped", emp.code);
    for (const p of d.outside) add(emp.deviceUserId, d.date, p, "mapped", emp.code);
    for (const p of d.unmapped) add(emp.deviceUserId, d.date, p, "unmapped", emp.code);
  }
  // Punches from device IDs nobody holds.
  const rng = makeRng(hashSeed(plan.roster.seed, "unmapped-ids"));
  const dates = datesBetween(plan.roster.from, plan.roster.to);
  for (const id of plan.roster.unmappedDeviceUserIds) {
    for (let i = rng.int(2, 5); i > 0; i--) {
      const date = rng.pick(dates);
      const at = 9 * 3600 + rng.int(0, 10 * 3600);
      add(id, date, { at, delivery: "live" }, "unmapped", null);
    }
  }
  return out;
}

export type { Intent, ManualSpec, Rng };
