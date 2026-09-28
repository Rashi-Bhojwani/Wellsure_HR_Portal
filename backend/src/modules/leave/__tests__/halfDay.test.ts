import { describe, expect, it } from "vitest";
import { computeTotalLeaveDays } from "../dayCount";
import { utcDate } from "./leaveTestHelpers";

describe("half-day arithmetic and holiday/week-off exclusion (spec §5.4)", () => {
  const noHolidays = new Set<string>();
  const noWeekOffs: number[] = [];
  const sunSat = [0, 6]; // default week-off days

  it("a single full day is 1", () => {
    const d = utcDate("2026-08-10"); // Monday
    expect(computeTotalLeaveDays(d, d, "FULL", "FULL", noHolidays, noWeekOffs).toNumber()).toBe(1);
  });

  it("a single half day is 0.5, using fromDayPart regardless of toDayPart", () => {
    const d = utcDate("2026-08-10");
    expect(computeTotalLeaveDays(d, d, "FIRST_HALF", "FIRST_HALF", noHolidays, noWeekOffs).toNumber()).toBe(0.5);
    expect(computeTotalLeaveDays(d, d, "SECOND_HALF", "SECOND_HALF", noHolidays, noWeekOffs).toNumber()).toBe(0.5);
  });

  it("Mon-Wed, all full days, no exclusions, is 3", () => {
    const from = utcDate("2026-08-10"); // Mon
    const to = utcDate("2026-08-12"); // Wed
    expect(computeTotalLeaveDays(from, to, "FULL", "FULL", noHolidays, noWeekOffs).toNumber()).toBe(3);
  });

  it("Mon(half)-Wed(full) is 2.5", () => {
    const from = utcDate("2026-08-10");
    const to = utcDate("2026-08-12");
    expect(computeTotalLeaveDays(from, to, "FIRST_HALF", "FULL", noHolidays, noWeekOffs).toNumber()).toBe(2.5);
  });

  it("Mon(full)-Wed(half) is 2.5", () => {
    const from = utcDate("2026-08-10");
    const to = utcDate("2026-08-12");
    expect(computeTotalLeaveDays(from, to, "FULL", "SECOND_HALF", noHolidays, noWeekOffs).toNumber()).toBe(2.5);
  });

  it("a holiday inside the range is excluded from the count", () => {
    const from = utcDate("2026-08-10"); // Mon
    const to = utcDate("2026-08-14"); // Fri
    const holidays = new Set(["2026-08-12"]); // Wed is a holiday
    expect(computeTotalLeaveDays(from, to, "FULL", "FULL", holidays, noWeekOffs).toNumber()).toBe(4); // Mon,Tue,Thu,Fri
  });

  it("a week-off spanning the range is excluded from the count", () => {
    const from = utcDate("2026-08-14"); // Fri
    const to = utcDate("2026-08-17"); // Mon
    expect(computeTotalLeaveDays(from, to, "FULL", "FULL", noHolidays, sunSat).toNumber()).toBe(2); // Fri + Mon only
  });

  it("a half-day start that falls on the from-date still applies even when the range also excludes other days", () => {
    const from = utcDate("2026-08-14"); // Fri, half day
    const to = utcDate("2026-08-17"); // Mon, full day
    expect(computeTotalLeaveDays(from, to, "FIRST_HALF", "FULL", noHolidays, sunSat).toNumber()).toBe(1.5); // 0.5 (Fri) + 1 (Mon)
  });
});
