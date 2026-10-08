import { dayStartMs, hhmmToSeconds, length, overlap, shiftTimeline, type Interval, type ShiftTimeline } from "./time";
import type { DayInput, DayResult, ExceptionFlag, HalfLeave, PolicyDef } from "./types";

// THE rules engine (docs/plans/PHASE_2.md §4.2, spec §4.4): one employee, one
// business date, no I/O. Evaluation order:
//   1. not employed on D → no record
//   2. holiday → H          (punches or a "worked" entry mark worked_on_off_day)
//   3. week-off → O         (likewise)
//   4. approved leave → the leave code; half-day leave combines with the other half
//   5. manual override — Phase 3
//   6. manual capture (no device mapping on D): TIMED times go through step 7
//      exactly like punches; STATUS_ONLY is taken as entered; nothing → NM
//   7. compute from punches
// Every rule decided here without HR or the spec saying so is listed in the
// plan's "As built: P2-C" with the reason.

const DAY_MS = 86_400_000;
const DEFAULT_NEAR_DUPLICATE_SECONDS = 120;

type Half = "P" | "A" | "NM" | string; // or a leave code

interface Figures {
  firstIn: number; // seconds on D's timeline
  lastOut: number | null;
  totalSeconds: number | null;
  breakSeconds: number | null;
  actualSeconds: number | null;
  inShiftSeconds: number | null;
  lateSeconds: number | null;
  earlySeconds: number | null;
  shortfallSeconds: number | null;
  excessSeconds: number | null;
}

const floorMin = (s: number | null) => (s === null ? null : Math.floor(s / 60));
const ceilMin = (s: number | null) => (s === null ? null : Math.ceil(s / 60));

/** Near-duplicates (the same person punching twice seconds apart) count once: a punch within the window of the last one kept is dropped. */
export function collapseNearDuplicates(times: number[], windowSeconds: number): { kept: number[]; keptIdx: number[] } {
  const order = times.map((t, i) => ({ t, i })).sort((a, b) => a.t - b.t);
  const kept: number[] = [];
  const keptIdx: number[] = [];
  for (const { t, i } of order) {
    if (kept.length && t - kept[kept.length - 1]! <= windowSeconds * 1000) continue;
    kept.push(t);
    keptIdx.push(i);
  }
  return { kept, keptIdx };
}

/** First punch = first in, last = last out (no direction from the device). Break = scheduled breaks the span covers, unless inferred pairing is on. */
export function computeFigures(points: number[], tl: ShiftTimeline, working: [boolean, boolean], policy: Pick<PolicyDef, "inferBreakPairing">, shift: { graceInMinutes: number; graceOutMinutes: number }): Figures {
  const first = points[0]!;
  const expected: Interval[] = [...(working[0] ? tl.halves[0] : []), ...(working[1] ? tl.halves[1] : [])];
  const expStart = Math.min(...expected.map((i) => i.start));
  const expEnd = Math.max(...expected.map((i) => i.end));
  const late = first - (expStart + shift.graceInMinutes * 60);
  if (points.length < 2) {
    return { firstIn: first, lastOut: null, totalSeconds: null, breakSeconds: null, actualSeconds: null, inShiftSeconds: null, lateSeconds: Math.max(0, late), earlySeconds: null, shortfallSeconds: null, excessSeconds: null };
  }
  const last = points[points.length - 1]!;
  const total = last - first;
  let breakSeconds: number;
  if (policy.inferBreakPairing && points.length >= 4 && points.length % 2 === 0) {
    // Optional, off by default: pair punches IN/OUT in order; the gaps between pairs are breaks.
    let worked = 0;
    for (let i = 0; i < points.length; i += 2) worked += points[i + 1]! - points[i]!;
    breakSeconds = total - worked;
  } else {
    breakSeconds = overlap(first, last, tl.breaks);
  }
  const actual = total - breakSeconds;
  const expectedWork = length(expected);
  return {
    firstIn: first,
    lastOut: last,
    totalSeconds: total,
    breakSeconds,
    actualSeconds: actual,
    inShiftSeconds: overlap(first, last, expected),
    lateSeconds: Math.max(0, late),
    earlySeconds: Math.max(0, expEnd - shift.graceOutMinutes * 60 - last),
    shortfallSeconds: Math.max(0, expectedWork - actual),
    excessSeconds: Math.max(0, actual - expectedWork),
  };
}

function compose(h1: Half | null, h2: Half | null): string {
  if (h1 === h2) return h1 ?? "";
  return `${h1}:${h2}`;
}

function leaveLop(l: HalfLeave | null): number {
  return l?.unpaid ? 0.5 : 0;
}

export function evaluateDay(input: DayInput): DayResult | null {
  // 1. Not employed on D: no record.
  if (!input.employed) return null;

  const tl = input.shift ? shiftTimeline(input.shift) : null;
  const base = dayStartMs(input.date);
  const provisional = input.now < base + (tl ? tl.windowEnd * 1000 : DAY_MS);
  const policy = input.policy;
  const toMs = (s: number) => base + s * 1000;

  // The day's points, as seconds on D's timeline: collapsed device punches, or a TIMED manual entry's times.
  let points: number[] = [];
  let usedPunchIds: string[] = [];
  let collapsed = 0;
  if (input.capture === "DEVICE") {
    const { kept, keptIdx } = collapseNearDuplicates(
      input.punches.map((p) => p.at),
      policy?.nearDuplicateSeconds ?? DEFAULT_NEAR_DUPLICATE_SECONDS,
    );
    points = kept.map((ms) => (ms - base) / 1000);
    usedPunchIds = keptIdx.map((i) => input.punches[i]!.id);
    collapsed = input.punches.length - kept.length;
  } else if (input.manual?.kind === "TIMED") {
    const crosses = tl ? tl.end > 86_400 : false;
    const read = (hhmm: string) => {
      const t = hhmmToSeconds(hhmm);
      return crosses && tl && t < tl.windowStart ? t + 86_400 : t; // after midnight on a night shift
    };
    const inS = read(input.manual.inTime);
    points = [inS];
    if (input.manual.outTime) {
      let outS = read(input.manual.outTime);
      if (outS <= inS) outS += 86_400;
      points.push(outS);
    }
  }

  const result: DayResult = {
    status: "",
    firstHalfStatus: null,
    secondHalfStatus: null,
    source: input.capture,
    capture: input.capture,
    lopDays: 0,
    flags: [],
    workedOnOffDay: false,
    provisional,
    leaveTypeCode: null,
    holidayName: null,
    shiftCode: input.shift?.code ?? null,
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
    punchCount: points.length,
    usedPunchIds,
    collapsedPunches: collapsed,
    manualEntryId: input.manual?.id ?? null,
  };

  const recordFigures = (f: Figures, opts: { timeFlags: boolean }) => {
    result.firstIn = toMs(f.firstIn);
    result.lastOut = f.lastOut === null ? null : toMs(f.lastOut);
    result.totalMinutes = floorMin(f.totalSeconds);
    result.breakMinutes = floorMin(f.breakSeconds);
    result.actualMinutes = floorMin(f.actualSeconds);
    result.inShiftMinutes = floorMin(f.inShiftSeconds);
    // A lone punch on a closed day may be the out, so it's never called late.
    const lateKnown = f.lastOut !== null || provisional;
    result.lateInMinutes = lateKnown ? ceilMin(f.lateSeconds) : null;
    result.earlyOutMinutes = ceilMin(f.earlySeconds);
    result.shortfallMinutes = floorMin(f.shortfallSeconds);
    result.excessMinutes = floorMin(f.excessSeconds);
    if (opts.timeFlags) {
      if (lateKnown && (f.lateSeconds ?? 0) > 0) result.flags.push("LATE_IN");
      if (!provisional && (f.earlySeconds ?? 0) > 0) result.flags.push("EARLY_OUT");
    }
  };

  // 2–3. Holiday, then week-off. Work on the day is recorded (comp-off is HR's call), never an exception.
  const offDay = input.holiday !== null ? { status: "H", source: "HOLIDAY" as const } : input.weekOff ? { status: "O", source: "WEEK_OFF" as const } : null;
  if (offDay) {
    result.status = offDay.status;
    result.firstHalfStatus = offDay.status;
    result.secondHalfStatus = offDay.status;
    result.source = offDay.source;
    result.holidayName = input.holiday;
    const manualWorked = input.manual?.kind === "STATUS_ONLY" && (input.manual.status === "WORKED" || input.manual.status === "P");
    result.workedOnOffDay = points.length > 0 || manualWorked;
    if (tl && points.length > 0) recordFigures(computeFigures(points, tl, [true, true], policy ?? { inferBreakPairing: false }, input.shift!), { timeFlags: false });
    return result;
  }

  // 4. Approved leave, per half.
  const { first: leave1, second: leave2 } = input.leave;
  if (leave1 && leave2) {
    result.status = leave1.code === leave2.code ? leave1.code : `${leave1.code}:${leave2.code}`;
    result.firstHalfStatus = leave1.code;
    result.secondHalfStatus = leave2.code;
    result.source = "LEAVE";
    result.leaveTypeCode = leave1.code === leave2.code ? leave1.code : `${leave1.code}:${leave2.code}`;
    result.lopDays = leaveLop(leave1) + leaveLop(leave2);
    return result;
  }
  const working: [boolean, boolean] = [!leave1, !leave2];
  const leaveHalf = leave1 ?? leave2 ?? null;
  result.leaveTypeCode = leaveHalf?.code ?? null;
  const halves: [Half | null, Half | null] = [leave1?.code ?? null, leave2?.code ?? null];
  const workingCount = (working[0] ? 1 : 0) + (working[1] ? 1 : 0);
  const finish = (h: Half, perHalfLop: number) => {
    if (working[0]) halves[0] = h;
    if (working[1]) halves[1] = h;
    result.lopDays = perHalfLop * workingCount + leaveLop(leave1) + leaveLop(leave2);
  };
  const done = () => {
    result.firstHalfStatus = halves[0];
    result.secondHalfStatus = halves[1];
    result.status = compose(halves[0], halves[1]);
    if (input.capture === "DEVICE" && input.flaggedExcluded > 0) result.flags.push("CLOCK_FLAGGED");
    return result;
  };

  // 6. Manual capture: status-only, or nothing entered (NM — never absent, never an exception, no LOP).
  if (input.capture === "MANUAL" && input.manual?.kind !== "TIMED") {
    const m = input.manual;
    if (!m) {
      finish("NM", 0);
      return done();
    }
    if (workingCount === 2 && (m.status === "HD_FIRST" || m.status === "HD_SECOND")) {
      halves[0] = m.status === "HD_FIRST" ? "P" : "A";
      halves[1] = m.status === "HD_FIRST" ? "A" : "P";
      result.lopDays = 0.5;
      return done();
    }
    if (m.status === "A") finish("A", 0.5);
    else finish("P", 0);
    return done();
  }

  // 7. Compute from punches (or a TIMED entry's times).
  if (!tl || !input.shift) {
    result.flags.push("NO_SHIFT");
    result.status = "NS";
    return result;
  }
  if (points.length === 0) {
    finish("A", provisional ? 0 : 0.5);
    return done();
  }
  const f = computeFigures(points, tl, working, policy ?? { inferBreakPairing: false }, input.shift);
  recordFigures(f, { timeFlags: true });
  if (provisional) {
    // The shift window is still open: someone who has punched is shown present so far; nothing is final.
    finish("P", 0);
    return done();
  }
  if (points.length === 1) {
    finish("A", 0.5);
    result.flags.push("MISSING_PUNCH");
    return done();
  }
  const actual = f.actualSeconds!;
  const fullMin = (policy?.fullDayMinMinutes ?? 0) * 60;
  const halfMin = (policy?.halfDayMinMinutes ?? 0) * 60;
  if (workingCount === 2) {
    if (actual >= fullMin) {
      finish("P", 0);
    } else if (actual >= halfMin) {
      // Half day: the half the person actually covered more of is the present one.
      const c1 = overlap(f.firstIn, f.lastOut!, tl.halves[0]) / Math.max(1, length(tl.halves[0]));
      const c2 = overlap(f.firstIn, f.lastOut!, tl.halves[1]) / Math.max(1, length(tl.halves[1]));
      if (c1 === c2) {
        result.status = "HD";
        result.lopDays = 0.5;
        result.flags.push("SHORTFALL");
        if (input.flaggedExcluded > 0) result.flags.push("CLOCK_FLAGGED");
        return result;
      }
      halves[0] = c1 > c2 ? "P" : "A";
      halves[1] = c1 > c2 ? "A" : "P";
      result.lopDays = 0.5;
      result.flags.push("SHORTFALL");
    } else {
      finish("A", 0);
      result.lopDays = policy?.halfDayMinNotMetLopDays ?? 1;
      result.flags.push("HALF_DAY_MIN_NOT_MET");
    }
  } else if (actual >= halfMin) {
    finish("P", 0);
  } else {
    finish("A", 0.5);
    result.flags.push("HALF_DAY_MIN_NOT_MET");
  }
  return done();
}

export type { ExceptionFlag };
