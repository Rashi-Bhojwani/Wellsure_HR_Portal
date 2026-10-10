import { ceilMin, DAY, floorMin, localText, minutes, secondsOf } from "./time";
import type { Capture, ExpectedDay, Intent, ManualSpec, SimLeaveType, SimPolicy, SimShift } from "./model";

// THE REFERENCE MODEL (docs/plans/PHASE_2.md "P2-G build design", leg 2).
//
// The written rules (spec §4.4, plan §4.2) restated as plain arithmetic on whole
// seconds, with its own types and its own structure, and importing NOTHING from
// the engine (a test greps this package to make sure). It exists to say, for any
// day the simulator builds, what every field should be, so the engine's stored
// days can be compared with it field by field. It is checked against each
// scenario's declared intent (leg 1) before the engine is involved, so a mistake
// here, or in a scenario, is caught on its own.
//
// What it does not do: attribute punches to dates (a scenario builds each day's
// punches, so it knows which day they belong to; the engine's attribution is
// exercised by the days coming out right), nor model a day that is still open
// (the replay month is closed) nor a missing shift.
//
// Order, as the rules state it: not employed → no record; holiday; week-off;
// approved leave (per half); manual capture; compute from punches.

export interface RefDay {
  date: string;
  employed: boolean;
  holiday: string | null;
  weekOff: boolean;
  leave: { first: SimLeaveType | null; second: SimLeaveType | null };
  capture: Capture;
  manual: ManualSpec | null;
  /** Seconds on the start date's timeline of the punches that belong to this day (before collapsing near-duplicates). */
  punches: number[];
  /** Punches for this day that arrived flagged (too old, too far ahead) and so are left out until HR decides. */
  flaggedExcluded: number;
  outsideWindowPunches: number;
  shift: SimShift;
  policy: SimPolicy;
}

interface Span {
  from: number;
  to: number;
}

export interface Layout {
  start: number;
  end: number; // after start; past 86,400 when the shift crosses midnight
  windowStart: number;
  windowEnd: number;
  halves: [Span[], Span[]]; // the work of each half
  breaks: Span[];
}

/** A shift laid out on its start date's timeline: two work sessions around one break, as every simulator shift is. */
export function layoutOf(shift: SimShift): Layout {
  const start = secondsOf(shift.start);
  const rawEnd = secondsOf(shift.end);
  const end = rawEnd <= start ? rawEnd + DAY : rawEnd;
  const at = (hhmm: string) => {
    const t = secondsOf(hhmm);
    return t < start ? t + DAY : t;
  };
  const span = (s: { start: string; end: string }): Span => {
    const from = at(s.start);
    const to = at(s.end);
    return { from, to: to <= from ? to + DAY : to };
  };
  const work = shift.sessions.filter((s) => s.kind === "WORK").map(span);
  const breaks = shift.sessions.filter((s) => s.kind === "BREAK").map(span);
  if (work.length !== 2 || breaks.length !== 1) throw new Error(`Simulator shifts have two work sessions around one break (${shift.code}).`);
  return { start, end, windowStart: start - minutes(shift.windowBeforeMinutes), windowEnd: end + minutes(shift.windowAfterMinutes), halves: [[work[0]!], [work[1]!]], breaks };
}

export const overlapOf = (a: number, b: number, spans: Span[]): number => spans.reduce((n, s) => n + Math.max(0, Math.min(b, s.to) - Math.max(a, s.from)), 0);
const lengthOf = (spans: Span[]): number => spans.reduce((n, s) => n + (s.to - s.from), 0);

/** The seconds a person is on the premises-and-working for, less the scheduled break the span covers. */
export function actualSeconds(layout: Layout, from: number, to: number): number {
  return to - from - overlapOf(from, to, layout.breaks);
}

interface Figures {
  first: number;
  last: number | null;
  total: number | null;
  breaks: number | null;
  actual: number | null;
  inShift: number | null;
  late: number;
  early: number | null;
  shortfall: number | null;
  excess: number | null;
}

function figuresOf(points: number[], layout: Layout, working: [boolean, boolean], shift: SimShift): Figures {
  const first = points[0]!;
  const expected = [...(working[0] ? layout.halves[0] : []), ...(working[1] ? layout.halves[1] : [])];
  const expStart = Math.min(...expected.map((s) => s.from));
  const expEnd = Math.max(...expected.map((s) => s.to));
  const late = Math.max(0, first - (expStart + minutes(shift.graceInMinutes)));
  if (points.length < 2) return { first, last: null, total: null, breaks: null, actual: null, inShift: null, late, early: null, shortfall: null, excess: null };
  const last = points[points.length - 1]!;
  const breaks = overlapOf(first, last, layout.breaks);
  const actual = last - first - breaks;
  const wanted = lengthOf(expected);
  return {
    first,
    last,
    total: last - first,
    breaks,
    actual,
    inShift: overlapOf(first, last, expected),
    late,
    early: Math.max(0, expEnd - minutes(shift.graceOutMinutes) - last),
    shortfall: Math.max(0, wanted - actual),
    excess: Math.max(0, actual - wanted),
  };
}

/** Two punches within the window count once: one is dropped if it is within the window of the last one kept. */
export function collapse(points: number[], windowSeconds: number): number[] {
  const kept: number[] = [];
  for (const p of [...points].sort((a, b) => a - b)) {
    if (kept.length && p - kept[kept.length - 1]! <= windowSeconds) continue;
    kept.push(p);
  }
  return kept;
}

const sortFlags = (flags: string[]) => [...new Set(flags)].sort();

export function referenceDay(d: RefDay): ExpectedDay | null {
  if (!d.employed) return null;
  const layout = layoutOf(d.shift);
  const crosses = layout.end > DAY;

  // The day's points: collapsed device punches, or a timed manual entry's two times.
  let points: number[] = [];
  let collapsedCount = 0;
  if (d.capture === "DEVICE") {
    points = collapse(d.punches, d.policy.nearDuplicateSeconds);
    collapsedCount = d.punches.length - points.length;
  } else if (d.manual?.kind === "TIMED") {
    const read = (hhmm: string) => {
      const t = secondsOf(hhmm);
      return crosses && t < layout.windowStart ? t + DAY : t;
    };
    const inS = read(d.manual.inTime);
    points = [inS];
    if (d.manual.outTime) {
      let outS = read(d.manual.outTime);
      if (outS <= inS) outS += DAY;
      points.push(outS);
    }
  }

  const out: ExpectedDay = {
    status: "",
    firstHalf: null,
    secondHalf: null,
    source: d.capture,
    capture: d.capture,
    lopDays: 0,
    flags: [],
    workedOnOffDay: false,
    provisional: false,
    shiftCode: d.shift.code,
    holidayName: null,
    leaveTypeCode: null,
    punchCount: points.length,
    collapsedPunches: collapsedCount,
    firstIn: null,
    lastOut: null,
    totalMinutes: null,
    breakMinutes: null,
    actualMinutes: null,
    inShiftMinutes: null,
    lateInMinutes: null,
    earlyOutMinutes: null,
    shortfallMinutes: null,
    excessMinutes: null,
    outsideWindowPunches: d.outsideWindowPunches,
  };

  const flags: string[] = [];
  const record = (f: Figures, timeFlags: boolean) => {
    out.firstIn = localText(d.date, f.first);
    out.lastOut = f.last === null ? null : localText(d.date, f.last);
    out.totalMinutes = f.total === null ? null : floorMin(f.total);
    out.breakMinutes = f.breaks === null ? null : floorMin(f.breaks);
    out.actualMinutes = f.actual === null ? null : floorMin(f.actual);
    out.inShiftMinutes = f.inShift === null ? null : floorMin(f.inShift);
    // A lone punch on a closed day might be the way OUT, so it is never called late.
    const lateKnown = f.last !== null;
    out.lateInMinutes = lateKnown ? ceilMin(f.late) : null;
    out.earlyOutMinutes = f.early === null ? null : ceilMin(f.early);
    out.shortfallMinutes = f.shortfall === null ? null : floorMin(f.shortfall);
    out.excessMinutes = f.excess === null ? null : floorMin(f.excess);
    if (timeFlags) {
      if (lateKnown && f.late > 0) flags.push("LATE_IN");
      if (f.early !== null && f.early > 0) flags.push("EARLY_OUT");
    }
  };
  const finish = (): ExpectedDay => {
    out.flags = sortFlags(flags);
    return out;
  };

  // Holiday, then week-off: worked or not, never an exception.
  const off = d.holiday !== null ? { status: "H", source: "HOLIDAY" as const } : d.weekOff ? { status: "O", source: "WEEK_OFF" as const } : null;
  if (off) {
    out.status = off.status;
    out.firstHalf = off.status;
    out.secondHalf = off.status;
    out.source = off.source;
    out.holidayName = d.holiday;
    const manualWorked = d.manual?.kind === "STATUS_ONLY" && (d.manual.status === "WORKED" || d.manual.status === "P");
    out.workedOnOffDay = points.length > 0 || manualWorked;
    if (points.length > 0) record(figuresOf(points, layout, [true, true], d.shift), false);
    return finish();
  }

  // Approved leave, per half.
  const { first: l1, second: l2 } = d.leave;
  const unpaidHalf = (l: SimLeaveType | null) => (l && !l.paid ? 0.5 : 0);
  if (l1 && l2) {
    const code = l1.code === l2.code ? l1.code : `${l1.code}:${l2.code}`;
    out.status = code;
    out.firstHalf = l1.code;
    out.secondHalf = l2.code;
    out.source = "LEAVE";
    out.leaveTypeCode = code;
    out.lopDays = unpaidHalf(l1) + unpaidHalf(l2);
    return finish();
  }
  const working: [boolean, boolean] = [!l1, !l2];
  const workingCount = (working[0] ? 1 : 0) + (working[1] ? 1 : 0);
  out.leaveTypeCode = (l1 ?? l2)?.code ?? null;
  const halves: [string | null, string | null] = [l1?.code ?? null, l2?.code ?? null];
  const settle = (h: string, lopPerWorkingHalf: number) => {
    if (working[0]) halves[0] = h;
    if (working[1]) halves[1] = h;
    out.lopDays = lopPerWorkingHalf * workingCount + unpaidHalf(l1) + unpaidHalf(l2);
  };
  const done = (): ExpectedDay => {
    out.firstHalf = halves[0];
    out.secondHalf = halves[1];
    out.status = halves[0] === halves[1] ? (halves[0] ?? "") : `${halves[0]}:${halves[1]}`;
    if (d.capture === "DEVICE" && d.flaggedExcluded > 0) flags.push("CLOCK_FLAGGED");
    return finish();
  };

  // Manual capture without times: nothing entered is "not marked" (never absent, no loss, no exception); a status is taken as entered.
  if (d.capture === "MANUAL" && d.manual?.kind !== "TIMED") {
    const m = d.manual;
    if (!m) {
      settle("NM", 0);
      return done();
    }
    if (workingCount === 2 && (m.status === "HD_FIRST" || m.status === "HD_SECOND")) {
      halves[0] = m.status === "HD_FIRST" ? "P" : "A";
      halves[1] = m.status === "HD_FIRST" ? "A" : "P";
      out.lopDays = 0.5;
      return done();
    }
    if (m.status === "A") settle("A", 0.5);
    else settle("P", 0);
    return done();
  }

  // Compute from the points.
  if (points.length === 0) {
    settle("A", 0.5);
    return done();
  }
  const f = figuresOf(points, layout, working, d.shift);
  record(f, true);
  if (points.length === 1) {
    settle("A", 0.5);
    flags.push("MISSING_PUNCH");
    return done();
  }
  const actual = f.actual!;
  const full = minutes(d.policy.fullDayMinMinutes);
  const half = minutes(d.policy.halfDayMinMinutes);
  if (workingCount === 2) {
    if (actual >= full) settle("P", 0);
    else if (actual >= half) {
      // Half a day: the half the person covered more of is the present one (exact fractions, by cross-multiplying).
      const o1 = overlapOf(f.first, f.last!, layout.halves[0]);
      const o2 = overlapOf(f.first, f.last!, layout.halves[1]);
      const len1 = Math.max(1, lengthOf(layout.halves[0]));
      const len2 = Math.max(1, lengthOf(layout.halves[1]));
      flags.push("SHORTFALL");
      out.lopDays = 0.5;
      if (o1 * len2 === o2 * len1) {
        out.status = "HD";
        if (d.capture === "DEVICE" && d.flaggedExcluded > 0) flags.push("CLOCK_FLAGGED");
        return finish();
      }
      halves[0] = o1 * len2 > o2 * len1 ? "P" : "A";
      halves[1] = o1 * len2 > o2 * len1 ? "A" : "P";
    } else {
      settle("A", 0);
      out.lopDays = d.policy.halfDayMinNotMetLopDays;
      flags.push("HALF_DAY_MIN_NOT_MET");
    }
  } else if (actual >= half) settle("P", 0);
  else {
    settle("A", 0.5);
    flags.push("HALF_DAY_MIN_NOT_MET");
  }
  return done();
}

/** Where a scenario's declared intent and the reference model disagree (leg 1 against leg 2). Empty is agreement. */
export function intentMismatches(intent: Intent, got: ExpectedDay | null): string[] {
  const bad: string[] = [];
  if (intent.noRecord) return got === null ? [] : [`intent: no record, reference: ${got.status}`];
  if (got === null) return ["intent: a record, reference: none"];
  const check = (name: string, want: unknown, have: unknown) => {
    if (JSON.stringify(want) !== JSON.stringify(have)) bad.push(`${name}: intent ${JSON.stringify(want)}, reference ${JSON.stringify(have)}`);
  };
  if (intent.status !== undefined) check("status", intent.status, got.status);
  if (intent.halves !== undefined) check("halves", intent.halves, [got.firstHalf, got.secondHalf]);
  if (intent.lop !== undefined) check("lop", intent.lop, got.lopDays);
  if (intent.flags !== undefined) check("flags", sortFlags(intent.flags), got.flags);
  if (intent.late !== undefined) check("late", intent.late, got.lateInMinutes);
  if (intent.early !== undefined) check("early", intent.early, got.earlyOutMinutes);
  if (intent.actual !== undefined) check("actual", intent.actual, got.actualMinutes);
  if (intent.punchCount !== undefined) check("punchCount", intent.punchCount, got.punchCount);
  if (intent.collapsed !== undefined) check("collapsed", intent.collapsed, got.collapsedPunches);
  if (intent.workedOnOffDay !== undefined) check("workedOnOffDay", intent.workedOnOffDay, got.workedOnOffDay);
  return bad;
}
