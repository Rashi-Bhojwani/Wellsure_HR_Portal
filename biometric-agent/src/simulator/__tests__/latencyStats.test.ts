import { describe, expect, it } from "vitest";
import { msUntilClearOfMidnight } from "../latency/allDay";
import { baselineOf, summarise, summarisePerRoute, verdict, type Sample } from "../latency/stats";

const sample = (route: Sample["route"], e: number | null, w: number | null): Sample => ({ route, employee: "1", employeeScreenMs: e, whoIsInMs: w, punchToServerMs: null });
const all = (e: number, w: number): Sample[] => (["agent", "push", "file"] as const).flatMap((r) => [sample(r, e, w), sample(r, e, null), sample(r, null, w)]);

describe("the latency test's pass and fail rules", () => {
  it("summarises min, median and max", () => {
    expect(summarise([])).toBeNull();
    expect(summarise([900, 300, 600])).toEqual({ count: 3, min: 300, median: 600, max: 900 });
    expect(summarise([100, 300])).toEqual({ count: 2, min: 100, median: 200, max: 300 });
  });

  it("passes when every sample on both screens is inside the gate", () => {
    const s = all(900, 1400);
    expect(verdict(s, summarisePerRoute(s), null)).toEqual([]);
  });

  it("fails on one slow sample, naming the route and the screen", () => {
    const s = [...all(900, 1400), sample("file", 5001, null)];
    const v = verdict(s, summarisePerRoute(s), null);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/file route → the employee's Attendance Info: slowest 5001 ms, over the 5000 ms gate/);
  });

  it("fails if a route or screen was never measured, so a skipped check can't pass", () => {
    const s = all(900, 1400).filter((x) => !(x.route === "push" && x.whoIsInMs !== null));
    expect(verdict(s, summarisePerRoute(s), null).join("\n")).toMatch(/push route → HR's Who Is In\?: never measured/);
    expect(verdict([], summarisePerRoute([]), null)).toContain("no samples were taken");
  });

  it("flags a regression against the baseline only when it is more than double AND over the floor", () => {
    const base = baselineOf(summarisePerRoute(all(300, 400)));
    const slowButFine = all(1500, 1900); // 5x the baseline, still under the 2 s floor: jitter, not a regression
    expect(verdict(slowButFine, summarisePerRoute(slowButFine), base)).toEqual([]);
    const regressed = all(2600, 400);
    const v = verdict(regressed, summarisePerRoute(regressed), base);
    expect(v.length).toBe(3);
    expect(v[0]).toMatch(/baseline of 300 ms/);
  });
});

// The test must not depend on the hour it runs at (allDay.ts): the only moment it holds back is the last minutes of the day.
describe("msUntilClearOfMidnight", () => {
  it("does not wait at any ordinary hour, including the small hours the test used to fail in", () => {
    for (const t of ["00:00:00", "00:10:00", "03:30:00", "06:00:00", "12:00:00", "18:00:00", "23:54:59"]) expect(msUntilClearOfMidnight(t)).toBe(0);
  });
  it("waits until just after midnight when it is 23:55 or later", () => {
    expect(msUntilClearOfMidnight("23:55:00")).toBe((5 * 60 + 30) * 1000);
    expect(msUntilClearOfMidnight("23:59:30")).toBe(60 * 1000);
    expect(msUntilClearOfMidnight("23:59:59")).toBe(31 * 1000);
  });
});
