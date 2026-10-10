import { addDays, dayStartMs, shiftTimeline } from "./time";
import type { PunchRef, ShiftDef } from "./types";

// Which business date does a punch count toward? (docs/plans/PHASE_2.md §4.2
// step 7.) Each date with a shift has a punch window — shift start − 4 h to
// shift end + 6 h, both configurable per shift — laid out on that date's
// timeline, so a night shift crossing midnight keeps its after-midnight
// punches on its START date. A punch inside two dates' windows goes to the
// date whose shift start is nearer; an exact tie goes to the earlier date.
// A date without a shift uses its calendar day (00:00–24:00 IST); a date on which the person is
// not employed has no window at all (the loader leaves it out). A punch in
// no window at all is left out of every day (counted, never silently lost).

export interface DayShift {
  date: string;
  shift: ShiftDef | null;
}

export interface Attribution {
  byDate: Map<string, PunchRef[]>;
  outside: PunchRef[];
}

export function windowOf(date: string, shift: ShiftDef | null): { from: number; to: number; anchor: number } {
  const base = dayStartMs(date);
  if (!shift) return { from: base, to: base + 86_400_000, anchor: base };
  const t = shiftTimeline(shift);
  return { from: base + t.windowStart * 1000, to: base + t.windowEnd * 1000, anchor: base + t.start * 1000 };
}

/** Attribute punches to dates. `days` should include a day either side of the range of interest. */
export function attributePunches(punches: PunchRef[], days: DayShift[]): Attribution {
  const windows = [...days].sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({ date: d.date, ...windowOf(d.date, d.shift) }));
  const byDate = new Map<string, PunchRef[]>();
  const outside: PunchRef[] = [];
  for (const p of [...punches].sort((a, b) => a.at - b.at)) {
    let chosen: (typeof windows)[number] | null = null;
    for (const w of windows) {
      if (p.at < w.from || p.at >= w.to) continue;
      if (!chosen || Math.abs(p.at - w.anchor) < Math.abs(p.at - chosen.anchor)) chosen = w; // strict: a tie keeps the earlier date
    }
    if (chosen) byDate.set(chosen.date, [...(byDate.get(chosen.date) ?? []), p]);
    else outside.push(p);
  }
  return { byDate, outside };
}

/** The dates either side of [from, to], for attribution near the range edges. */
export function datesAround(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = addDays(from, -1); d <= addDays(to, 1); d = addDays(d, 1)) out.push(d);
  return out;
}
