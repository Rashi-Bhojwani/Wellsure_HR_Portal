import { describe, expect, it } from "vitest";
import { cycleChangeProblem, cycleForRules, recentCycles, type CycleRule } from "../attendanceCycle";

// The attendance cycle (docs/plans/PHASE_2.md §2.1): calendar month by the
// user's confirmation, configurable start day, changes only from a future
// boundary so past cycles never move.
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (x: Date) => x.toISOString().slice(0, 10);
const span = (rules: CycleRule[], day: string) => {
  const c = cycleForRules(rules, d(day));
  return [iso(c.start), iso(c.end), c.label];
};
const CAL: CycleRule[] = [{ effectiveFrom: d("2000-01-01"), startDay: 1 }];

describe("cycleFor", () => {
  it("start day 1 is the calendar month, leap years included", () => {
    expect(span(CAL, "2026-10-08")).toEqual(["2026-10-01", "2026-10-31", "Oct 2026"]);
    expect(span(CAL, "2028-02-29")).toEqual(["2028-02-01", "2028-02-29", "Feb 2028"]);
    expect(span(CAL, "2026-12-31")).toEqual(["2026-12-01", "2026-12-31", "Dec 2026"]);
  });

  it("start day 26 runs the 26th to the 25th, across a year end", () => {
    const r: CycleRule[] = [{ effectiveFrom: d("2000-01-26"), startDay: 26 }];
    expect(span(r, "2026-10-25")).toEqual(["2026-09-26", "2026-10-25", "26 Sep – 25 Oct 2026"]);
    expect(span(r, "2026-10-26")).toEqual(["2026-10-26", "2026-11-25", "26 Oct – 25 Nov 2026"]);
    expect(span(r, "2027-01-03")).toEqual(["2026-12-26", "2027-01-25", "26 Dec 2026 – 25 Jan 2027"]);
  });

  it("a change from the 26th clips the cycle before it, and past cycles keep their boundaries", () => {
    const r: CycleRule[] = [...CAL, { effectiveFrom: d("2026-11-26"), startDay: 26 }];
    expect(span(r, "2026-10-15")).toEqual(["2026-10-01", "2026-10-31", "Oct 2026"]);
    expect(span(r, "2026-11-10")).toEqual(["2026-11-01", "2026-11-25", "1 Nov – 25 Nov 2026"]);
    expect(span(r, "2026-11-26")).toEqual(["2026-11-26", "2026-12-25", "26 Nov – 25 Dec 2026"]);
  });

  it("recentCycles walks back newest first without gaps", () => {
    const cs = recentCycles(CAL, d("2026-02-10"), 3).map((c) => c.label);
    expect(cs).toEqual(["Feb 2026", "Jan 2026", "Dec 2025"]);
  });
});

describe("cycleChangeProblem", () => {
  const today = d("2026-10-08");
  it("refuses a date inside the current cycle, or not on the new start day", () => {
    expect(cycleChangeProblem(CAL, d("2026-10-26"), 26, today)).toMatch(/current cycle \(Oct 2026\) keeps its boundaries/);
    expect(cycleChangeProblem(CAL, d("2026-11-25"), 26, today)).toMatch(/26th of the month/);
    expect(cycleChangeProblem(CAL, d("2026-11-29"), 29, today)).toMatch(/between 1 and 28/);
  });
  it("accepts a date after the current cycle on the new start day", () => {
    expect(cycleChangeProblem(CAL, d("2026-11-26"), 26, today)).toBeNull();
    expect(cycleChangeProblem(CAL, d("2026-12-01"), 1, today)).toBeNull();
  });
});
