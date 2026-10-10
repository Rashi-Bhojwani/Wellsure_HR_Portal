import type { Archetype, Masters, Roster, SimEmployee, SimHoliday, SimLeave, SimShift } from "./model";
import { hashSeed, makeRng, type Rng } from "./rng";
import { addDays, datesBetween, occurrenceOf, weekdayOf } from "./time";

// The simulated organisation (docs/plans/PHASE_2.md "P2-G build design",
// "The roster"). It brings its own masters with explicit round numbers, so the
// replay never depends on the seeded defaults, whose grace and thresholds are
// HR's to confirm: these are test data, not a claim about anyone's policy.

export const SIM_DAY: SimShift = {
  code: "SIM-DAY",
  name: "Simulator day shift",
  start: "10:00",
  end: "19:00",
  graceInMinutes: 10,
  graceOutMinutes: 10,
  windowBeforeMinutes: 240,
  windowAfterMinutes: 360,
  sessions: [
    { kind: "WORK", label: "First session", start: "10:00", end: "14:00" },
    { kind: "BREAK", label: "Lunch", start: "14:00", end: "14:45" },
    { kind: "WORK", label: "Second session", start: "14:45", end: "19:00" },
  ],
};

export const SIM_NIGHT: SimShift = {
  code: "SIM-NIGHT",
  name: "Simulator night shift",
  start: "22:00",
  end: "06:00",
  graceInMinutes: 10,
  graceOutMinutes: 10,
  windowBeforeMinutes: 240,
  windowAfterMinutes: 360,
  sessions: [
    { kind: "WORK", label: "First session", start: "22:00", end: "02:00" },
    { kind: "BREAK", label: "Meal break", start: "02:00", end: "02:30" },
    { kind: "WORK", label: "Second session", start: "02:30", end: "06:00" },
  ],
};

/**
 * `existing`: company holidays already in the database for this month. They apply to everyone, so
 * the simulated organisation adopts them as they are and adds its own only on free days.
 */
export function simMasters(month: string, existing: SimHoliday[] = []): Masters {
  const taken = new Set(existing.map((h) => h.date));
  // A holiday on a weekday, one on the day Saturday employees are off anyway (the holiday wins), and a third.
  const own = [`${month}-15`, `${month}-19`, `${month}-22`].filter((d) => !taken.has(d)).map((date, i) => ({ date, name: `Simulator holiday ${i + 1}` }));
  return {
    shifts: [SIM_DAY, SIM_NIGHT],
    policies: [
      { code: "SIM-STD", name: "Simulator standard", fullDayMinMinutes: 420, halfDayMinMinutes: 240, halfDayMinNotMetLopDays: 1, nearDuplicateSeconds: 120 },
      { code: "SIM-STRICT", name: "Simulator strict", fullDayMinMinutes: 480, halfDayMinMinutes: 300, halfDayMinNotMetLopDays: 0.5, nearDuplicateSeconds: 120 },
    ],
    weekOffs: [
      { code: "SIM-SUN", name: "Sunday", rules: [{ weekday: 0 }] },
      { code: "SIM-SUN-SAT24", name: "Sunday, 2nd and 4th Saturday", rules: [{ weekday: 0 }, { weekday: 6, weeks: [2, 4] }] },
    ],
    leaveTypes: [
      { code: "SIMPL", name: "Simulator paid leave", paid: true },
      { code: "SIMLOP", name: "Simulator unpaid leave", paid: false },
    ],
    holidays: [...existing, ...own].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export function monthBounds(month: string): { from: string; to: string } {
  const from = `${month}-01`;
  const next = new Date(`${from}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { from, to: addDays(next.toISOString().slice(0, 10), -1) };
}

export function isWeekOffByPattern(rules: Array<{ weekday: number; weeks?: number[] }>, date: string): boolean {
  const wd = weekdayOf(date);
  const nth = occurrenceOf(date);
  return rules.some((r) => r.weekday === wd && (!r.weeks || r.weeks.includes(nth)));
}

/** Archetypes and the share of the roster each gets (the rare ones always get at least one person, so a small roster still covers them). */
const SHARES: Array<[Archetype, number]> = [
  ["day-std", 0.58],
  ["day-strict", 0.08],
  ["day-sat", 0.08],
  ["night", 0.06],
  ["manual", 0.08],
  ["joiner", 0.025],
  ["leaver", 0.025],
  ["mapped-late", 0.025],
  ["night-leaver", 0.01],
];

const ALWAYS_MAPPED = "2024-01-01";

export function buildRoster(opts: { seed: number; month: string; employees: number; existingHolidays?: SimHoliday[] }): Roster {
  const { seed, month } = opts;
  const { from, to } = monthBounds(month);
  const masters = simMasters(month, opts.existingHolidays ?? []);
  const rng = makeRng(hashSeed(seed, "roster"));
  const n = opts.employees;

  // How many of each archetype: proportional, at least one of each rare one, the remainder standard.
  const counts = new Map<Archetype, number>();
  let assigned = 0;
  for (const [a, share] of SHARES) {
    if (a === "day-std") continue;
    const c = Math.max(1, Math.round(n * share));
    counts.set(a, c);
    assigned += c;
  }
  counts.set("day-std", Math.max(1, n - assigned));
  const archetypes: Archetype[] = [];
  for (const [a, c] of counts) for (let i = 0; i < c; i++) archetypes.push(a);
  const order = rng.shuffle(archetypes).slice(0, n);

  const workingDates = datesBetween(from, to).filter((d) => weekdayOf(d) !== 0 && !masters.holidays.some((h) => h.date === d));
  const employees: SimEmployee[] = order.map((archetype, i) => {
    const num = i + 1;
    const code = `SIM${String(num).padStart(4, "0")}`;
    const deviceUserId = String(70_000 + num);
    const r = makeRng(hashSeed(seed, "employee", code));
    return employeeFor(archetype, code, deviceUserId, { from, to, r, workingDates });
  });

  return {
    seed,
    month,
    from,
    to,
    masters,
    employees,
    unmappedDeviceUserIds: Array.from({ length: Math.max(2, Math.round(n / 50)) }, (_, i) => String(90_000 + i + 1)),
  };
}

function employeeFor(archetype: Archetype, code: string, deviceUserId: string, c: { from: string; to: string; r: Rng; workingDates: string[] }): SimEmployee {
  const { r } = c;
  const base: SimEmployee = {
    code,
    deviceUserId,
    archetype,
    shift: "SIM-DAY",
    policy: "SIM-STD",
    weekOff: "SIM-SUN",
    joined: "2024-01-01",
    lastWorking: null,
    capture: "DEVICE",
    mappingFrom: ALWAYS_MAPPED,
    leaves: [],
  };
  // A leaver's last day is a day they would work (never a Sunday or a holiday): that is the day worth testing.
  const lastDay = () => r.pick(c.workingDates.filter((d) => d >= `${c.from.slice(0, 8)}10` && d <= `${c.from.slice(0, 8)}24`));
  const midMonth = (lo: number, hi: number) => `${c.from.slice(0, 8)}${String(r.int(lo, hi)).padStart(2, "0")}`;
  switch (archetype) {
    case "day-std":
      break;
    case "day-strict":
      base.policy = "SIM-STRICT";
      base.weekOff = "SIM-SUN-SAT24";
      break;
    case "day-sat":
      base.weekOff = "SIM-SUN-SAT24";
      break;
    case "night":
      base.shift = "SIM-NIGHT";
      break;
    case "manual":
      base.capture = "MANUAL";
      base.mappingFrom = null;
      break;
    case "joiner":
      base.joined = r.pick(c.workingDates.filter((d) => d >= `${c.from.slice(0, 8)}08` && d <= `${c.from.slice(0, 8)}20`)); // the card was issued earlier: punches before joining must change nothing
      break;
    case "leaver":
      base.lastWorking = lastDay();
      break;
    case "mapped-late":
      base.mappingFrom = midMonth(12, 20); // manual capture until then, device from then on
      break;
    case "night-leaver":
      base.shift = "SIM-NIGHT";
      base.lastWorking = lastDay();
      break;
  }
  // Approved leave for about one in five device-captured employees, on days they would otherwise work.
  if (base.capture === "DEVICE" && archetype !== "mapped-late" && r.chance(0.2)) {
    const pool = c.workingDates.filter((d) => d >= base.joined && (!base.lastWorking || d < base.lastWorking));
    const picks = new Set<string>();
    for (let i = r.int(1, 3); i > 0 && pool.length; i--) picks.add(r.pick(pool));
    base.leaves = [...picks].sort().map<SimLeave>((date) => ({
      date,
      part: r.weighted([["FULL", 50], ["FIRST_HALF", 25], ["SECOND_HALF", 25]] as const),
      type: r.chance(0.7) ? "SIMPL" : "SIMLOP",
    }));
  }
  return base;
}
