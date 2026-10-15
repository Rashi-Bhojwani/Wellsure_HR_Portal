import { describe, expect, it } from "vitest";
import { rotationSegments } from "../roster/rotation";

// The shift roster's rotation maths (Phase 3 commit 2): pure, so every shape of pattern is a table row.
describe("rotationSegments", () => {
  const A = "A";
  const B = "B";
  const C = "C";

  it("one shift, no repeat: a single open-ended segment from the start", () => {
    expect(rotationSegments({ start: "2026-10-05", steps: [{ shiftId: A, days: 1 }], repeat: false })).toEqual([{ from: "2026-10-05", shiftId: A }]);
  });

  it("a weekly rotation A,B repeats until the end date, one segment per change", () => {
    expect(
      rotationSegments({ start: "2026-10-05", steps: [{ shiftId: A, days: 7 }, { shiftId: B, days: 7 }], repeat: true, until: "2026-11-01" }),
    ).toEqual([
      { from: "2026-10-05", shiftId: A },
      { from: "2026-10-12", shiftId: B },
      { from: "2026-10-19", shiftId: A },
      { from: "2026-10-26", shiftId: B },
    ]);
  });

  it("the end date is inclusive: a step that would start on it is written, one after it is not", () => {
    const steps = [{ shiftId: A, days: 7 }, { shiftId: B, days: 7 }];
    expect(rotationSegments({ start: "2026-10-05", steps, repeat: true, until: "2026-10-12" }).map((s) => s.from)).toEqual(["2026-10-05", "2026-10-12"]);
    expect(rotationSegments({ start: "2026-10-05", steps, repeat: true, until: "2026-10-11" }).map((s) => s.from)).toEqual(["2026-10-05"]);
  });

  it("three shifts of different lengths cycle in order", () => {
    const segs = rotationSegments({ start: "2026-10-01", steps: [{ shiftId: A, days: 2 }, { shiftId: B, days: 3 }, { shiftId: C, days: 1 }], repeat: true, until: "2026-10-14" });
    expect(segs.map((s) => `${s.from}:${s.shiftId}`)).toEqual(["2026-10-01:A", "2026-10-03:B", "2026-10-06:C", "2026-10-07:A", "2026-10-09:B", "2026-10-12:C", "2026-10-13:A"]);
  });

  it("adjacent equal shifts merge into one row (the history stores changes, not days)", () => {
    expect(rotationSegments({ start: "2026-10-05", steps: [{ shiftId: A, days: 3 }, { shiftId: A, days: 4 }, { shiftId: B, days: 7 }], repeat: true, until: "2026-10-25" }).map((s) => `${s.from}:${s.shiftId}`)).toEqual([
      "2026-10-05:A",
      "2026-10-12:B",
      "2026-10-19:A",
    ]);
  });

  it("without repeat the steps run once and the last shift stays", () => {
    expect(rotationSegments({ start: "2026-10-05", steps: [{ shiftId: A, days: 7 }, { shiftId: B, days: 7 }], repeat: false }).map((s) => `${s.from}:${s.shiftId}`)).toEqual(["2026-10-05:A", "2026-10-12:B"]);
  });

  it("a repeating rotation without an end date is refused", () => {
    expect(() => rotationSegments({ start: "2026-10-05", steps: [{ shiftId: A, days: 7 }], repeat: true })).toThrow();
  });

  it("crosses month and year ends", () => {
    expect(rotationSegments({ start: "2026-12-28", steps: [{ shiftId: A, days: 7 }, { shiftId: B, days: 7 }], repeat: true, until: "2027-01-12" }).map((s) => s.from)).toEqual(["2026-12-28", "2027-01-04", "2027-01-11"]);
  });
});
