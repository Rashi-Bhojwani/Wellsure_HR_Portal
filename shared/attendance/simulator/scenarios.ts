import type { Delivery, Intent, ManualSpec, PunchSpec, SimPolicy, SimShift } from "./model";
import { actualSeconds, overlapOf, type Layout } from "./reference";
import type { Rng } from "./rng";
import { DAY, floorMin, hms, minutes } from "./time";

// THE NAMED SCENARIOS (docs/plans/PHASE_2.md "P2-G build design", leg 1).
//
// Each scenario builds one employee-day's punches (or manual entry) from seeded
// parameters AND declares, as a closed form of those parameters, what should
// happen to that day: its INTENT. Intents are what a person reads in the
// catalogue and says "yes, that's the rule". They are partial on purpose (only
// what defines the scenario); the reference model fills in every other field,
// and a test checks the two agree over thousands of draws.
//
// Scenarios are shift-agnostic: they work from the shift's start, end, break and
// grace and the policy's minimums, so the same code serves the day and the night
// shift. A scenario that can't be built for a given shift and policy (for
// instance a half day under a policy whose half-day minimum is longer than half
// the shift) returns null and the planner falls back to a normal day.

export interface GenCtx {
  rng: Rng;
  shift: SimShift;
  policy: SimPolicy;
  layout: Layout;
}

export interface Generated {
  params: Record<string, number | string>;
  punches: PunchSpec[];
  /** Punches that fall in no day's window: delivered, and counted, but part of no day. */
  outside?: PunchSpec[];
  manual?: ManualSpec | null;
  intent: Intent;
  why: string;
}

export interface Scenario {
  name: string;
  /** Plain words: what the scenario does. */
  description: string;
  /** Plain words: what should happen. */
  intentText: string;
  generate(c: GenCtx): Generated | null;
}

const live = (...at: number[]): PunchSpec[] => at.map((t) => ({ at: t, delivery: "live" as Delivery }));
const withDelivery = (p: PunchSpec[], delivery: Delivery): PunchSpec[] => p.map((x) => ({ ...x, delivery }));

const secs = (m: number, s: number) => minutes(m) + s;
const min = (s: number) => s / 60;
const fmt = (s: number) => hms(s).slice(0, 5);

// ── Arithmetic every scenario shares (plain, on whole seconds) ──────────────

interface Facts {
  S: number; // shift start
  E: number; // shift end
  gIn: number;
  gOut: number;
  full: number; // seconds of actual work for a full day
  half: number;
  lateLimit: number; // S + grace in
  earlyLimit: number; // E − grace out
  winFrom: number;
  winTo: number;
  breakFrom: number;
  breakTo: number;
}

function factsOf(c: GenCtx): Facts {
  const L = c.layout;
  return {
    S: L.start,
    E: L.end,
    gIn: minutes(c.shift.graceInMinutes),
    gOut: minutes(c.shift.graceOutMinutes),
    full: minutes(c.policy.fullDayMinMinutes),
    half: minutes(c.policy.halfDayMinMinutes),
    lateLimit: L.start + minutes(c.shift.graceInMinutes),
    earlyLimit: L.end - minutes(c.shift.graceOutMinutes),
    winFrom: L.windowStart,
    winTo: L.windowEnd,
    breakFrom: L.breaks[0]!.from,
    breakTo: L.breaks[0]!.to,
  };
}

/** The out time for which actual work from `from` is exactly `target` seconds (the scheduled break the span covers is not work), or null. */
function outForActual(L: Layout, from: number, target: number): number | null {
  let out = from + target;
  for (let i = 0; i < 6; i++) {
    const next = from + target + overlapOf(from, out, L.breaks);
    if (next === out) break;
    out = next;
  }
  return actualSeconds(L, from, out) === target ? out : null;
}

const inWindow = (f: Facts, ...ats: number[]) => ats.every((t) => t >= f.winFrom && t < f.winTo);

/** A time of day that is a full day's worth of work only if it can be: pushes `out` later until the work is at least `target`. */
function pushOutUntil(L: Layout, from: number, out: number, target: number, ceiling: number): number | null {
  let o = out;
  while (actualSeconds(L, from, o) < target) {
    o += 60;
    if (o >= ceiling) return null;
  }
  return o;
}

function flagsFor(f: Facts, inAt: number, outAt: number | null, extra: string[] = []): string[] {
  const flags = [...extra];
  if (inAt > f.lateLimit && outAt !== null) flags.push("LATE_IN");
  if (outAt !== null && outAt < f.earlyLimit) flags.push("EARLY_OUT");
  return flags;
}

// ── The scenarios ───────────────────────────────────────────────────────────

/** A day's in and out that are comfortably a full day, on time and not early: the base of several scenarios. */
function onTimeFullDay(c: GenCtx): { inAt: number; outAt: number } | null {
  const f = factsOf(c);
  const inAt = f.lateLimit - c.rng.int(0, minutes(45) + f.gIn) - (c.rng.chance(0.5) ? 0 : c.rng.int(0, 59));
  const out0 = f.earlyLimit + c.rng.int(0, minutes(60));
  const outAt = pushOutUntil(c.layout, inAt, out0, f.full, f.winTo);
  if (outAt === null || !inWindow(f, inAt, outAt)) return null;
  return { inAt, outAt };
}

const normalDay: Scenario = {
  name: "normal-day",
  description: "In up to the grace limit, out at or after the end less grace, a full day's work.",
  intentText: "Present (`P`), not late, not early, no loss of pay, no flags; hours are the span less the scheduled break.",
  generate(c) {
    const t = onTimeFullDay(c);
    if (!t) return null;
    return {
      params: { in: hms(t.inAt), out: hms(t.outAt) },
      punches: live(t.inAt, t.outAt),
      intent: { status: "P", halves: ["P", "P"], lop: 0, flags: [], late: 0, early: 0, actual: floorMin(actualSeconds(c.layout, t.inAt, t.outAt)), punchCount: 2, collapsed: 0 },
      why: `in ${hms(t.inAt)} (by the ${c.shift.graceInMinutes} min grace) and out ${hms(t.outAt)}: a full day`,
    };
  },
};

const lateArrival: Scenario = {
  name: "late-arrival",
  description: "In `k` minutes (and `s` seconds) after the grace limit, still a full day's work.",
  intentText: "Present, late by ⌈k + s/60⌉ minutes, flag `LATE_IN`, no loss of pay.",
  generate(c) {
    const f = factsOf(c);
    const k = c.rng.int(1, 60);
    const s = c.rng.chance(0.5) ? 0 : c.rng.int(1, 59);
    const inAt = f.lateLimit + secs(k, s);
    const outAt = pushOutUntil(c.layout, inAt, f.earlyLimit + c.rng.int(0, minutes(45)), f.full, f.winTo);
    if (outAt === null || !inWindow(f, inAt, outAt)) return null;
    return {
      params: { k, s, in: hms(inAt), out: hms(outAt) },
      punches: live(inAt, outAt),
      intent: { status: "P", lop: 0, flags: ["LATE_IN"], late: k + (s > 0 ? 1 : 0), early: 0, punchCount: 2 },
      why: `in ${k} min ${s} s after the grace limit, full day: late by ${k + (s > 0 ? 1 : 0)} min`,
    };
  },
};

const earlyExit: Scenario = {
  name: "early-exit",
  description: "Out `k` minutes (and `s` seconds) before the end less grace, still a full day's work.",
  intentText: "Present, early by ⌈k + s/60⌉ minutes, flag `EARLY_OUT`, not late, no loss of pay.",
  generate(c) {
    const f = factsOf(c);
    const inAt = f.S - c.rng.int(0, minutes(45));
    const kMax = Math.floor((f.earlyLimit - (inAt + f.full + (f.breakTo - f.breakFrom))) / 60) - 1;
    if (kMax < 1) return null;
    const k = c.rng.int(1, Math.min(60, kMax));
    const s = c.rng.chance(0.5) ? 0 : c.rng.int(1, 59);
    const outAt = f.earlyLimit - secs(k, s);
    if (actualSeconds(c.layout, inAt, outAt) < f.full || !inWindow(f, inAt, outAt)) return null;
    return {
      params: { k, s, in: hms(inAt), out: hms(outAt) },
      punches: live(inAt, outAt),
      intent: { status: "P", lop: 0, flags: ["EARLY_OUT"], late: 0, early: k + (s > 0 ? 1 : 0), punchCount: 2 },
      why: `out ${k} min ${s} s before the end less grace, still a full day: early by ${k + (s > 0 ? 1 : 0)} min`,
    };
  },
};

const lateAndEarly: Scenario = {
  name: "late-and-early",
  description: "Both: in after the grace limit and out before the end less grace, still a full day.",
  intentText: "Present, late and early by their own minutes, flags `LATE_IN` and `EARLY_OUT`, no loss of pay.",
  generate(c) {
    const f = factsOf(c);
    const k1 = c.rng.int(1, 25);
    const k2 = c.rng.int(1, 25);
    const inAt = f.lateLimit + minutes(k1);
    const outAt = f.earlyLimit - minutes(k2);
    if (actualSeconds(c.layout, inAt, outAt) < f.full || !inWindow(f, inAt, outAt)) return null;
    return {
      params: { lateMin: k1, earlyMin: k2, in: hms(inAt), out: hms(outAt) },
      punches: live(inAt, outAt),
      intent: { status: "P", lop: 0, flags: ["LATE_IN", "EARLY_OUT"], late: k1, early: k2, punchCount: 2 },
      why: `late by ${k1} and early by ${k2}, still a full day`,
    };
  },
};

/** Half-day builders: the work is between the half and the full minimum, and which half was covered more decides which is present. */
function halfDayGen(which: "first" | "second"): Scenario["generate"] {
  return (c) => {
    const f = factsOf(c);
    if (f.half >= f.full) return null;
    const A = c.rng.int(f.half, f.full - 60); // seconds of actual work
    let inAt: number;
    let outAt: number | null;
    if (which === "first") {
      inAt = f.S - c.rng.int(0, minutes(20));
      outAt = outForActual(c.layout, inAt, A);
    } else {
      outAt = f.earlyLimit + c.rng.int(0, minutes(20));
      // walk the in time back from the out until the work is A
      let guess = outAt - A - (f.breakTo - f.breakFrom);
      let found: number | null = null;
      for (let i = 0; i < 200 && found === null; i++) {
        const a = actualSeconds(c.layout, guess, outAt);
        if (a === A) found = guess;
        else guess += a > A ? 1 : -1;
      }
      if (found === null) return null;
      inAt = found;
    }
    if (outAt === null || !inWindow(f, inAt, outAt)) return null;
    const o1 = overlapOf(inAt, outAt, c.layout.halves[0]);
    const o2 = overlapOf(inAt, outAt, c.layout.halves[1]);
    const len1 = c.layout.halves[0].reduce((n, s) => n + s.to - s.from, 0);
    const len2 = c.layout.halves[1].reduce((n, s) => n + s.to - s.from, 0);
    const firstMore = o1 * len2 > o2 * len1;
    const secondMore = o2 * len1 > o1 * len2;
    if ((which === "first" && !firstMore) || (which === "second" && !secondMore)) return null;
    const halves: [string, string] = which === "first" ? ["P", "A"] : ["A", "P"];
    return {
      params: { actualMin: Math.floor(A / 60), in: hms(inAt), out: hms(outAt) },
      punches: live(inAt, outAt),
      intent: { status: `${halves[0]}:${halves[1]}`, halves, lop: 0.5, flags: flagsFor(f, inAt, outAt, ["SHORTFALL"]), punchCount: 2, actual: Math.floor(A / 60) },
      why: `${Math.floor(A / 60)} min of work, between the half-day (${min(f.half)}) and full-day (${min(f.full)}) minimums, covering more of the ${which} half`,
    };
  };
}

const halfDayFirst: Scenario = {
  name: "half-day-first",
  description: "Between the half-day and full-day minimum, having covered more of the first half.",
  intentText: "The first half present, the second absent (`P:A`), half a day's loss of pay, flag `SHORTFALL`.",
  generate: halfDayGen("first"),
};

const halfDaySecond: Scenario = {
  name: "half-day-second",
  description: "Between the half-day and full-day minimum, having covered more of the second half (a late start).",
  intentText: "The second half present, the first absent (`A:P`), half a day's loss of pay, flag `SHORTFALL`.",
  generate: halfDayGen("second"),
};

const halfDayTie: Scenario = {
  name: "half-day-tie",
  description: "Between the half-day and full-day minimum, having covered exactly the same fraction of both halves.",
  intentText: "Plain half day (`HD`, neither half named), half a day's loss of pay, flag `SHORTFALL`.",
  generate(c) {
    const f = factsOf(c);
    const [h1, h2] = c.layout.halves;
    const len1 = h1[0]!.to - h1[0]!.from;
    const len2 = h2[0]!.to - h2[0]!.from;
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const g = gcd(len1, len2);
    const a = len1 / g;
    const b = len2 / g;
    // cover the same fraction j/g of each half, either side of the break
    const lo = Math.ceil(f.half / (a + b));
    const hi = Math.min(g, Math.floor((f.full - 1) / (a + b)));
    if (lo > hi) return null;
    const j = c.rng.int(lo, hi);
    const inAt = f.breakFrom - a * j;
    const outAt = f.breakTo + b * j;
    const A = actualSeconds(c.layout, inAt, outAt);
    if (A < f.half || A >= f.full || !inWindow(f, inAt, outAt)) return null;
    return {
      params: { j, of: g, in: hms(inAt), out: hms(outAt) },
      punches: live(inAt, outAt),
      intent: { status: "HD", halves: undefined, lop: 0.5, flags: flagsFor(f, inAt, outAt, ["SHORTFALL"]), punchCount: 2 },
      why: `covered ${j}/${g} of each half (${fmt(inAt)}–${fmt(outAt)}): a tie, so a plain half day`,
    };
  },
};

const belowHalfDay: Scenario = {
  name: "below-half-day",
  description: "Under the half-day minimum of work.",
  intentText: "Absent (`A`), the policy's not-met loss of pay, flag `HALF_DAY_MIN_NOT_MET`.",
  generate(c) {
    const f = factsOf(c);
    const A = c.rng.int(minutes(10), f.half - 60);
    const inAt = f.S + c.rng.int(-minutes(10), minutes(120));
    const outAt = outForActual(c.layout, inAt, A);
    if (outAt === null || !inWindow(f, inAt, outAt)) return null;
    return {
      params: { actualMin: Math.floor(A / 60), in: hms(inAt), out: hms(outAt) },
      punches: live(inAt, outAt),
      intent: { status: "A", halves: ["A", "A"], lop: c.policy.halfDayMinNotMetLopDays, flags: flagsFor(f, inAt, outAt, ["HALF_DAY_MIN_NOT_MET"]), punchCount: 2, actual: Math.floor(A / 60) },
      why: `${Math.floor(A / 60)} min of work, under the half-day minimum (${min(f.half)} min)`,
    };
  },
};

const thresholdEdges: Scenario = {
  name: "threshold-edges",
  description: "Work of exactly the full-day or half-day minimum, and one second either side of it.",
  intentText: "At or over a minimum counts as meeting it; one second under does not: full minimum → `P` / half day; half minimum → half day / `A` with the not-met loss.",
  generate(c) {
    const f = factsOf(c);
    const edge = c.rng.pick(["full", "half"] as const);
    const delta = c.rng.pick([-1, 0, 1]);
    const target = (edge === "full" ? f.full : f.half) + delta;
    const inAt = f.S + c.rng.int(-minutes(5), 0);
    const outAt = outForActual(c.layout, inAt, target);
    if (outAt === null || !inWindow(f, inAt, outAt)) return null;
    const meets = delta >= 0;
    let intent: Intent;
    if (edge === "full" && meets) intent = { status: "P", halves: ["P", "P"], lop: 0, flags: flagsFor(f, inAt, outAt), actual: floorMin(target) };
    else if (edge === "full") intent = { status: "P:A", halves: ["P", "A"], lop: 0.5, flags: flagsFor(f, inAt, outAt, ["SHORTFALL"]), actual: floorMin(target) };
    else if (meets) intent = { status: "P:A", halves: ["P", "A"], lop: 0.5, flags: flagsFor(f, inAt, outAt, ["SHORTFALL"]), actual: floorMin(target) };
    else intent = { status: "A", halves: ["A", "A"], lop: c.policy.halfDayMinNotMetLopDays, flags: flagsFor(f, inAt, outAt, ["HALF_DAY_MIN_NOT_MET"]), actual: floorMin(target) };
    // The "first half present" outcomes hold because the person starts at or before the shift start, so covers the first half fully.
    if ((edge === "full" && !meets) || (edge === "half" && meets)) {
      const o1 = overlapOf(inAt, outAt, c.layout.halves[0]);
      const o2 = overlapOf(inAt, outAt, c.layout.halves[1]);
      const len1 = c.layout.halves[0].reduce((n, s) => n + s.to - s.from, 0);
      const len2 = c.layout.halves[1].reduce((n, s) => n + s.to - s.from, 0);
      if (!(o1 * len2 > o2 * len1)) return null;
    }
    return {
      params: { edge, deltaSeconds: delta, in: hms(inAt), out: hms(outAt) },
      punches: live(inAt, outAt),
      intent: { ...intent, punchCount: 2 },
      why: `work of exactly the ${edge}-day minimum ${delta === 0 ? "" : delta > 0 ? "plus" : "minus"} ${Math.abs(delta) || ""}${delta === 0 ? "" : " second"}`.trim(),
    };
  },
};

const missingPunch: Scenario = {
  name: "missing-punch",
  description: "One punch only (an in, or an out: the device doesn't say which).",
  intentText: "Absent (`A`) with flag `MISSING_PUNCH` and a day's loss of pay until regularised; never called late.",
  generate(c) {
    const f = factsOf(c);
    const nearIn = c.rng.chance(0.5);
    const at = nearIn ? f.S - c.rng.int(0, minutes(30)) + c.rng.int(0, minutes(90)) : f.earlyLimit + c.rng.int(-minutes(60), minutes(60));
    if (!inWindow(f, at)) return null;
    return {
      params: { at: hms(at), side: nearIn ? "morning" : "evening" },
      punches: live(at),
      intent: { status: "A", halves: ["A", "A"], lop: 1, flags: ["MISSING_PUNCH"], late: null, early: null, actual: null, punchCount: 1 },
      why: `a single punch at ${hms(at)}: absent, MISSING_PUNCH, a day's loss`,
    };
  },
};

const duplicateSeconds: Scenario = {
  name: "duplicate-seconds",
  description: "A normal day where each of the in and out is punched twice, a few seconds apart (the sample's user 113).",
  intentText: "Each pair counts once: two punches, `collapsed` as many as the extra punches; otherwise exactly a normal day.",
  generate(c) {
    const t = onTimeFullDay(c);
    if (!t) return null;
    const win = c.policy.nearDuplicateSeconds;
    const d1 = c.rng.int(1, Math.min(10, win));
    const d2 = c.rng.int(1, Math.min(10, win));
    const extraIn = c.rng.chance(0.85);
    const extraOut = c.rng.chance(0.85);
    const ats = [t.inAt, ...(extraIn ? [t.inAt + d1] : []), t.outAt, ...(extraOut ? [t.outAt + d2] : [])];
    const lastOut = extraOut ? t.outAt + d2 : t.outAt;
    return {
      params: { in: hms(t.inAt), out: hms(t.outAt), inDup: extraIn ? d1 : 0, outDup: extraOut ? d2 : 0 },
      punches: live(...ats),
      intent: { status: "P", lop: 0, flags: [], late: 0, early: 0, punchCount: 2, collapsed: (extraIn ? 1 : 0) + (extraOut ? 1 : 0), actual: floorMin(actualSeconds(c.layout, t.inAt, t.outAt)) },
      why: `${(extraIn ? 1 : 0) + (extraOut ? 1 : 0)} duplicate punch(es) seconds apart, counted once (last out ${hms(lastOut)})`,
    };
  },
};

const nearDuplicateEdge: Scenario = {
  name: "near-duplicate-edge",
  description: "A second punch exactly at the near-duplicate window after the first, and one second beyond it.",
  intentText: "At the window it is the same punch (counted once); one second beyond it is a separate punch (three punches). Nothing else about the day changes.",
  generate(c) {
    const t = onTimeFullDay(c);
    if (!t) return null;
    const win = c.policy.nearDuplicateSeconds;
    const beyond = c.rng.chance(0.5);
    const gap = win + (beyond ? 1 : 0);
    return {
      params: { in: hms(t.inAt), out: hms(t.outAt), gapSeconds: gap, windowSeconds: win },
      punches: live(t.inAt, t.inAt + gap, t.outAt),
      intent: { status: "P", lop: 0, flags: [], late: 0, early: 0, punchCount: beyond ? 3 : 2, collapsed: beyond ? 0 : 1 },
      why: `a second punch ${gap} s after the first (window ${win} s): ${beyond ? "a separate punch" : "the same punch"}`,
    };
  },
};

const neverPunches: Scenario = {
  name: "never-punches",
  description: "A mapped employee with no punches on a working day.",
  intentText: "Absent (`A`), a day's loss of pay, no flags.",
  generate() {
    return { params: {}, punches: [], intent: { status: "A", halves: ["A", "A"], lop: 1, flags: [], late: null, early: null, actual: null, punchCount: 0 }, why: "no punches on a working day" };
  },
};

const worksPastMidnight: Scenario = {
  name: "works-past-midnight",
  description: "Stays long after the shift ends, with the out after the end (and, on a day shift, after midnight).",
  intentText: "Present, not early, the long hours counted on the shift's START date; the next date is unaffected by this punch.",
  generate(c) {
    const f = factsOf(c);
    const inAt = f.lateLimit - c.rng.int(0, minutes(30));
    const outAt = f.E + c.rng.int(minutes(120), f.winTo - f.E - 60);
    if (!inWindow(f, inAt, outAt)) return null;
    return {
      params: { in: hms(inAt), out: `${hms(outAt)}${outAt >= DAY ? " (next day)" : ""}` },
      punches: live(inAt, outAt),
      intent: { status: "P", lop: 0, flags: [], late: 0, early: 0, punchCount: 2, actual: floorMin(actualSeconds(c.layout, inAt, outAt)) },
      why: `out at ${hms(outAt)}, hours after the end: still the shift's own date`,
    };
  },
};

const outsideWindow: Scenario = {
  name: "outside-window",
  description: "A normal day plus one stray punch in the gap between one day's punch window and the next.",
  intentText: "The stray belongs to no day: it is counted (never silently lost) and the day is exactly a normal one.",
  generate(c) {
    const t = onTimeFullDay(c);
    if (!t) return null;
    const f = factsOf(c);
    const gapFrom = Math.max(0, f.winTo - DAY);
    const gapTo = f.winFrom;
    if (gapTo - gapFrom < minutes(10)) return null;
    const stray = c.rng.int(gapFrom + 120, gapTo - 120);
    return {
      params: { in: hms(t.inAt), out: hms(t.outAt), stray: hms(stray) },
      punches: live(t.inAt, t.outAt),
      outside: live(stray),
      intent: { status: "P", lop: 0, flags: [], late: 0, early: 0, punchCount: 2 },
      why: `a stray punch at ${hms(stray)}, between two days' windows, counted and used by neither`,
    };
  },
};

const strayFlagged: Scenario = {
  name: "stray-flagged",
  description: "A normal day plus one extra punch inside the day that reaches the server far too late to be plausible (so it is flagged).",
  intentText: "The late punch is left out until HR decides on its time: the day is computed without it, with flag `CLOCK_FLAGGED`.",
  generate(c) {
    const t = onTimeFullDay(c);
    if (!t) return null;
    const mid = t.inAt + Math.floor((t.outAt - t.inAt) / 2);
    return {
      params: { in: hms(t.inAt), out: hms(t.outAt), strayAt: hms(mid) },
      punches: [...live(t.inAt, t.outAt), { at: mid, delivery: "stale" }],
      intent: { status: "P", lop: 0, flags: ["CLOCK_FLAGGED"], late: 0, early: 0, punchCount: 2 },
      why: `an implausibly late punch at ${hms(mid)} is excluded; the rest is a normal day`,
    };
  },
};

const staleDay: Scenario = {
  name: "stale-day",
  description: "A normal day whose every punch reaches the server beyond the plausibility window.",
  intentText: "All the punches are flagged and left out: absent (`A`), a day's loss, flag `CLOCK_FLAGGED`, until HR accepts them.",
  generate(c) {
    const t = onTimeFullDay(c);
    if (!t) return null;
    return {
      params: { in: hms(t.inAt), out: hms(t.outAt) },
      punches: withDelivery(live(t.inAt, t.outAt), "stale"),
      intent: { status: "A", halves: ["A", "A"], lop: 1, flags: ["CLOCK_FLAGGED"], late: null, early: null, actual: null, punchCount: 0 },
      why: "every punch reached the server too late to be plausible: excluded until HR decides",
    };
  },
};

const catchUp: Scenario = {
  name: "catch-up",
  description: "A normal day delivered days late (after an outage), inside the plausibility window, in a shuffled order.",
  intentText: "Exactly the same day as if delivered live.",
  generate(c) {
    const t = onTimeFullDay(c);
    if (!t) return null;
    return {
      params: { in: hms(t.inAt), out: hms(t.outAt) },
      punches: withDelivery(live(t.inAt, t.outAt), "late"),
      intent: { status: "P", lop: 0, flags: [], late: 0, early: 0, punchCount: 2, actual: floorMin(actualSeconds(c.layout, t.inAt, t.outAt)) },
      why: "delivered days late but inside the plausibility window: the same day",
    };
  },
};

export const WORKING_DAY_SCENARIOS: ReadonlyArray<readonly [Scenario, number]> = [
  [normalDay, 50],
  [lateArrival, 12],
  [earlyExit, 6],
  [lateAndEarly, 3],
  [halfDayFirst, 2.5],
  [halfDaySecond, 2.5],
  [halfDayTie, 1],
  [belowHalfDay, 2],
  [thresholdEdges, 3],
  [missingPunch, 4],
  [duplicateSeconds, 5],
  [nearDuplicateEdge, 2],
  [neverPunches, 3],
  [strayFlagged, 1.5],
  [staleDay, 1],
  [outsideWindow, 1.5],
  [worksPastMidnight, 1],
  [catchUp, 3],
];

export const FALLBACK = normalDay;

// ── Off days, leave, manual capture, not employed ───────────────────────────

const offDayQuiet: Scenario = {
  name: "off-day-quiet",
  description: "A holiday or week-off with no punches.",
  intentText: "`H` or `O`, not worked, no loss of pay, no flags.",
  generate() {
    return { params: {}, punches: [], intent: { flags: [], lop: 0, workedOnOffDay: false, punchCount: 0 }, why: "nobody came in on a day off" };
  },
};

const offDayWork: Scenario = {
  name: "off-day-work",
  description: "Punches on a holiday or week-off (named `holiday-work` and `weekoff-work` in the catalogue).",
  intentText: "`H` or `O` still (never present or absent), recorded as worked on an off day, never an exception, no loss of pay.",
  generate(c) {
    const f = factsOf(c);
    const inAt = f.S + c.rng.int(-minutes(30), minutes(120));
    const outAt = inAt + c.rng.int(minutes(60), minutes(540));
    if (!inWindow(f, inAt, outAt)) return null;
    return {
      params: { in: hms(inAt), out: hms(outAt) },
      punches: live(inAt, outAt),
      intent: { flags: [], lop: 0, workedOnOffDay: true, punchCount: 2 },
      why: `worked ${fmt(inAt)}–${fmt(outAt)} on a day off: recorded, never an exception`,
    };
  },
};

const lateHalfDefault = (c: GenCtx) => c.rng.int(0, minutes(30));

/** Half-day leave with the other half worked. `leaveHalf` is the half that is on leave. */
export function leaveHalfWorked(c: GenCtx, leaveHalf: "first" | "second", leaveCode: string, unpaid: boolean): Generated | null {
  const f = factsOf(c);
  const L = c.layout;
  let inAt: number;
  let outAt: number;
  if (leaveHalf === "first") {
    const h2 = L.halves[1][0]!;
    inAt = h2.from + f.gIn - lateHalfDefault(c);
    outAt = f.earlyLimit + c.rng.int(0, minutes(20));
  } else {
    const h1 = L.halves[0][0]!;
    inAt = f.S - c.rng.int(minutes(20), minutes(40));
    outAt = h1.to - f.gOut + c.rng.int(0, minutes(10));
  }
  const worked = actualSeconds(L, inAt, outAt);
  if (worked < f.half || !inWindow(f, inAt, outAt)) return null; // the working half has to meet the half-day minimum
  const status = leaveHalf === "first" ? `${leaveCode}:P` : `P:${leaveCode}`;
  return {
    params: { leaveHalf, in: hms(inAt), out: hms(outAt) },
    punches: live(inAt, outAt),
    intent: { status, halves: leaveHalf === "first" ? [leaveCode, "P"] : ["P", leaveCode], lop: unpaid ? 0.5 : 0, flags: [], late: 0, early: 0, punchCount: 2, actual: floorMin(worked) },
    why: `${leaveHalf}-half leave (${leaveCode}), the other half worked ${fmt(inAt)}–${fmt(outAt)}`,
  };
}

export function leaveHalfNoShow(leaveHalf: "first" | "second", leaveCode: string, unpaid: boolean): Generated {
  return {
    params: { leaveHalf },
    punches: [],
    intent: { status: leaveHalf === "first" ? `${leaveCode}:A` : `A:${leaveCode}`, halves: leaveHalf === "first" ? [leaveCode, "A"] : ["A", leaveCode], lop: 0.5 + (unpaid ? 0.5 : 0), flags: [], late: null, early: null, punchCount: 0 },
    why: `${leaveHalf}-half leave (${leaveCode}) and the other half absent`,
  };
}

export function leaveFull(leaveCode: string, unpaid: boolean): Generated {
  return { params: { code: leaveCode }, punches: [], intent: { status: leaveCode, halves: [leaveCode, leaveCode], lop: unpaid ? 1 : 0, flags: [], punchCount: 0 }, why: `full-day leave (${leaveCode})` };
}

export function notEmployed(c: GenCtx, strayPunches: boolean): Generated {
  const f = factsOf(c);
  const punches = strayPunches ? live(f.S + c.rng.int(-minutes(20), minutes(20)), f.E - c.rng.int(0, minutes(20))) : [];
  return {
    params: strayPunches ? { punches: punches.map((p) => hms(p.at)).join(",") } : {},
    punches,
    intent: { noRecord: true },
    why: strayPunches ? "not employed on this date (before joining or after the last day), though the card still punched: no record" : "not employed on this date: no record",
  };
}

export function manualNothing(): Generated {
  return { params: {}, punches: [], manual: null, intent: { status: "NM", halves: ["NM", "NM"], lop: 0, flags: [], punchCount: 0 }, why: "manual capture and nothing entered: not marked (never absent, no loss, no exception)" };
}

export function manualStatus(c: GenCtx): Generated {
  const status = c.rng.weighted([["P", 55], ["A", 15], ["HD_FIRST", 10], ["HD_SECOND", 10], ["WORKED", 10]] as const);
  const intent: Intent =
    status === "P" || status === "WORKED"
      ? { status: "P", halves: ["P", "P"], lop: 0, flags: [], punchCount: 0 }
      : status === "A"
        ? { status: "A", halves: ["A", "A"], lop: 1, flags: [], punchCount: 0 }
        : status === "HD_FIRST"
          ? { status: "P:A", halves: ["P", "A"], lop: 0.5, flags: [], punchCount: 0 }
          : { status: "A:P", halves: ["A", "P"], lop: 0.5, flags: [], punchCount: 0 };
  return { params: { status }, punches: [], manual: { kind: "STATUS_ONLY", status }, intent, why: `a status-only entry (${status}) is taken as entered` };
}

export function manualTimed(c: GenCtx): Generated | null {
  const f = factsOf(c);
  const inM = Math.floor(f.lateLimit / 60) + c.rng.int(-30, 70);
  const inAt = inM * 60;
  const outStart = Math.floor(f.earlyLimit / 60) + c.rng.int(0, 45);
  const outAt = pushOutUntil(c.layout, inAt, outStart * 60, f.full, f.winTo);
  if (outAt === null || !inWindow(f, inAt, outAt) || outAt % 60 !== 0) return null;
  const lateMin = Math.max(0, Math.round((inAt - f.lateLimit) / 60));
  return {
    params: { in: fmt(inAt), out: fmt(outAt) },
    punches: [],
    manual: { kind: "TIMED", inTime: fmt(inAt), outTime: fmt(outAt) },
    intent: { status: "P", lop: 0, flags: lateMin > 0 ? ["LATE_IN"] : [], late: lateMin, early: 0, punchCount: 2, actual: floorMin(actualSeconds(c.layout, inAt, outAt)) },
    why: `a timed entry ${fmt(inAt)}–${fmt(outAt)} goes through the punch rules exactly like punches (late by ${lateMin} min)`,
  };
}

export function manualInOnly(c: GenCtx): Generated {
  const f = factsOf(c);
  const inAt = (Math.floor(f.lateLimit / 60) + c.rng.int(-20, 40)) * 60;
  return {
    params: { in: fmt(inAt) },
    punches: [],
    manual: { kind: "TIMED", inTime: fmt(inAt), outTime: null },
    intent: { status: "A", halves: ["A", "A"], lop: 1, flags: ["MISSING_PUNCH"], late: null, early: null, punchCount: 1 },
    why: `an in with no out (${fmt(inAt)}) counts like a single punch: absent, MISSING_PUNCH`,
  };
}

/** Everything the catalogue and tests need to enumerate. */
export const SCENARIO_INFO: Array<Pick<Scenario, "name" | "description" | "intentText">> = [
  ...WORKING_DAY_SCENARIOS.map(([s]) => ({ name: s.name, description: s.description, intentText: s.intentText })),
  { name: offDayQuiet.name, description: offDayQuiet.description, intentText: offDayQuiet.intentText },
  { name: "holiday-work", description: "Punches on a company holiday.", intentText: offDayWork.intentText },
  { name: "weekoff-work", description: "Punches on the employee's week-off.", intentText: offDayWork.intentText },
  { name: "leave-full", description: "Approved full-day leave, paid or unpaid.", intentText: "The leave code for the day; a day's loss of pay only if the leave is unpaid; punches are not needed." },
  { name: "leave-half-worked", description: "Half-day leave, the other half worked.", intentText: "A split status like `PL:P`; loss of pay only for an unpaid half; the working half has to meet the half-day minimum." },
  { name: "leave-half-no-show", description: "Half-day leave, the other half absent.", intentText: "A split status like `PL:A`; half a day's loss for the absent half, plus half for an unpaid leave half." },
  { name: "not-employed", description: "Before the joining date or after the last working day (sometimes with a stray punch from a card still in use).", intentText: "No record at all." },
  { name: "manual-nothing", description: "A manual-capture employee with nothing entered.", intentText: "`NM`: never absent, no loss of pay, never an exception." },
  { name: "manual-status", description: "A manual-capture employee with a status-only entry.", intentText: "The status as entered (`P`, `A`, first or second half, worked)." },
  { name: "manual-timed", description: "A manual-capture employee with a timed entry.", intentText: "Goes through the punch rules exactly like device punches (late minutes, hours)." },
  { name: "manual-in-only", description: "A timed entry with an in and no out.", intentText: "Counts like a single punch: `A` with `MISSING_PUNCH`." },
  { name: "unmapped", description: "Punches from a device user ID nobody has.", intentText: "They land in the unmapped queue and change no one's day." },
];


export const offDayWork_generate = (c: GenCtx) => offDayWork.generate(c);
export const offDayQuiet_generate = () => offDayQuiet.generate({} as GenCtx) as Generated;
