import { describe, expect, it } from "vitest";
import { addCalendarDays } from "../businessDate";
import { planTimelineChange, type TimelineRow } from "../effectiveDating";

// The pure timeline planner (EF1). A property test drives random sequences
// of changes through it against a tiny reference model and checks, after
// every step, that the history is contiguous, never overlaps, never runs
// backwards, and that what's in force on every day is what the reference
// says — the invariants payroll will rely on.

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const TODAY = day("2026-10-03");

function apply(rows: TimelineRow[], d: Date, value: string, values: Map<string, string>): TimelineRow[] {
  const plan = planTimelineChange(rows, d, TODAY, 366);
  if (plan.kind === "amend") {
    values.set(plan.id, value);
    return rows;
  }
  const id = `r${values.size + 1}`;
  values.set(id, value);
  const closed = plan.kind === "append" ? rows.map((r) => (r.id === plan.closeId ? { ...r, to: d } : r)) : rows;
  return [...closed, { id, from: d, to: null }];
}

const inForce = (rows: TimelineRow[], d: Date) => rows.filter((r) => r.from <= d && (r.to === null || r.to > d));

describe("planTimelineChange", () => {
  const rows: TimelineRow[] = [
    { id: "a", from: day("2024-01-01"), to: day("2026-05-01") },
    { id: "b", from: day("2026-05-01"), to: null },
  ];

  it("appends after the latest row, amends on its own start date, refuses anything earlier", () => {
    expect(planTimelineChange(rows, day("2026-09-01"), TODAY, 366)).toEqual({ kind: "append", closeId: "b" });
    expect(planTimelineChange(rows, day("2026-05-01"), TODAY, 366)).toEqual({ kind: "amend", id: "b" });
    expect(() => planTimelineChange(rows, day("2026-04-30"), TODAY, 366)).toThrow(expect.objectContaining({ code: "HISTORY_BEFORE_LATEST" }));
    expect(planTimelineChange([], day("2024-01-01"), TODAY, 366)).toEqual({ kind: "first" });
  });

  it("a scheduled change must be cancelled before anything is dated before it; at most N days ahead", () => {
    const scheduled = [...rows.slice(0, 1), { ...rows[1]!, to: day("2026-11-01") }, { id: "c", from: day("2026-11-01"), to: null }];
    expect(() => planTimelineChange(scheduled, day("2026-10-15"), TODAY, 366)).toThrow(expect.objectContaining({ code: "HISTORY_SCHEDULED_EXISTS" }));
    expect(planTimelineChange(scheduled, day("2026-12-01"), TODAY, 366)).toEqual({ kind: "append", closeId: "c" });
    expect(() => planTimelineChange(rows, addCalendarDays(TODAY, 367), TODAY, 366)).toThrow(expect.objectContaining({ code: "HISTORY_TOO_FAR_AHEAD" }));
    expect(planTimelineChange(rows, addCalendarDays(TODAY, 366), TODAY, 366).kind).toBe("append");
  });

  it("a closed history (they left) can't change", () => {
    const left = [{ id: "a", from: day("2024-01-01"), to: day("2026-06-01") }];
    expect(() => planTimelineChange(left, day("2026-07-01"), TODAY, 366)).toThrow(expect.objectContaining({ code: "HISTORY_CLOSED" }));
  });

  it("property: any sequence of accepted changes keeps one contiguous, non-overlapping timeline matching the reference", () => {
    let seed = 20261003;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    for (let run = 0; run < 300; run++) {
      let rows: TimelineRow[] = [];
      const values = new Map<string, string>();
      const reference: Array<{ from: Date; value: string }> = []; // sorted change points
      const start = day("2024-01-01");
      for (let step = 0; step < 12; step++) {
        const d = addCalendarDays(start, rand(1400));
        const value = `v${run}.${step}`;
        let accepted = true;
        try {
          rows = apply(rows, d, value, values);
        } catch {
          accepted = false;
        }
        // Reference: the planner accepts exactly when d is on/after the last change point.
        const last = reference.at(-1);
        const shouldAccept = d <= addCalendarDays(TODAY, 366) && (!last || d >= last.from);
        expect(accepted).toBe(shouldAccept);
        if (accepted) {
          if (last && last.from.getTime() === d.getTime()) last.value = value;
          else reference.push({ from: d, value });
        }

        // Invariants: ordered, contiguous, exactly one open row, nothing backwards.
        const sorted = [...rows].sort((a, b) => a.from.getTime() - b.from.getTime());
        for (let i = 0; i < sorted.length; i++) {
          const r = sorted[i]!;
          if (r.to) expect(r.to.getTime()).toBeGreaterThan(r.from.getTime());
          if (i < sorted.length - 1) expect(r.to?.getTime()).toBe(sorted[i + 1]!.from.getTime());
          else expect(r.to).toBeNull();
        }
        // In force on a sample of days = the reference's value on that day.
        for (let k = 0; k < 6; k++) {
          const probe = addCalendarDays(start, rand(1500) - 50);
          const got = inForce(rows, probe);
          expect(got.length).toBeLessThanOrEqual(1);
          const expected = [...reference].reverse().find((c) => c.from <= probe)?.value;
          expect(got[0] ? values.get(got[0].id) : undefined).toBe(expected);
        }
      }
    }
  });
});
