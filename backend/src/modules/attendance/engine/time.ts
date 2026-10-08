import { toMinutes } from "@shared/utils/attendance";
import type { ShiftDef } from "./types";

// Business time is Asia/Kolkata, a fixed UTC+05:30 with no daylight saving
// (spec §1). A shift's times are wall-clock times on its business date D;
// on the engine's timeline they are seconds since D 00:00 IST, so a night
// shift's end (and its window) simply runs past 86,400.

export const IST_OFFSET_MS = 330 * 60_000;
const DAY_S = 86_400;

/** Epoch ms of D 00:00 in business time. */
export function dayStartMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) - IST_OFFSET_MS;
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The business date (IST) an instant falls on. */
export function businessDateOf(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export interface Interval {
  start: number; // seconds on D's timeline
  end: number;
}

export interface ShiftTimeline {
  start: number;
  end: number;
  windowStart: number;
  windowEnd: number;
  work: Interval[];
  breaks: Interval[];
  /** The work sessions of each half: the first work session(s) and the last (docs/plans/PHASE_2.md §2.1). */
  halves: [Interval[], Interval[]];
}

/** A shift laid out on its start date's timeline. Times at or before the start belong to the next calendar day. */
export function shiftTimeline(shift: ShiftDef): ShiftTimeline {
  const start = toMinutes(shift.startTime) * 60;
  const at = (hhmm: string) => {
    const t = toMinutes(hhmm) * 60;
    return t < start ? t + DAY_S : t;
  };
  const endRaw = toMinutes(shift.endTime) * 60;
  const end = endRaw <= start ? endRaw + DAY_S : endRaw;
  const parts = shift.sessions.map((s) => {
    const from = at(s.startTime);
    let to = at(s.endTime);
    if (to <= from) to += DAY_S;
    return { kind: s.kind, interval: { start: from, end: to } };
  });
  const work = parts.filter((p) => p.kind === "WORK").map((p) => p.interval);
  const breaks = parts.filter((p) => p.kind === "BREAK").map((p) => p.interval);
  return { start, end, windowStart: start - shift.windowBeforeMinutes * 60, windowEnd: end + shift.windowAfterMinutes * 60, work, breaks, halves: splitHalves(work, start, end) };
}

/**
 * Two or more work sessions: the halves split at the scheduled break nearest
 * the middle of the shift (GEN: lunch 14:00–14:45, so 10:00–14:00 and
 * 14:45–19:00). One work session: it splits at its midpoint.
 */
function splitHalves(work: Interval[], start: number, end: number): [Interval[], Interval[]] {
  if (work.length === 0) return [[], []];
  if (work.length === 1) {
    const mid = Math.floor((work[0]!.start + work[0]!.end) / 2);
    return [[{ start: work[0]!.start, end: mid }], [{ start: mid, end: work[0]!.end }]];
  }
  const middle = (start + end) / 2;
  let best = 1;
  for (let i = 1; i < work.length; i++) {
    const gap = (work[i - 1]!.end + work[i]!.start) / 2;
    const bestGap = (work[best - 1]!.end + work[best]!.start) / 2;
    if (Math.abs(gap - middle) < Math.abs(bestGap - middle)) best = i;
  }
  return [work.slice(0, best), work.slice(best)];
}

/** Seconds of [a, b] that fall inside the intervals. */
export function overlap(a: number, b: number, intervals: Interval[]): number {
  return intervals.reduce((sum, i) => sum + Math.max(0, Math.min(b, i.end) - Math.max(a, i.start)), 0);
}

export function length(intervals: Interval[]): number {
  return intervals.reduce((sum, i) => sum + (i.end - i.start), 0);
}

/** "HH:MM" on D's timeline. */
export function hhmmToSeconds(hhmm: string): number {
  return toMinutes(hhmm) * 60;
}
