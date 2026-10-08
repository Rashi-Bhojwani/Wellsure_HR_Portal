import { describe, expect, it } from "vitest";
import { crossesMidnight, describeWeekOff, isWeekOff, sessionProblems, sessionTotals, weekOffRuleProblems, type SessionInput } from "@shared/utils/attendance";

// Shared helpers behind Attendance Settings and (from P2-C) the rules engine.
const GEN: SessionInput[] = [
  { kind: "WORK", label: "First session", startTime: "10:00", endTime: "14:00" },
  { kind: "BREAK", label: "Lunch", startTime: "14:00", endTime: "14:45" },
  { kind: "WORK", label: "Second session", startTime: "14:45", endTime: "19:00" },
];

describe("shift sessions", () => {
  it("HR's GEN shift is valid: 8h15m of work, 45m of lunch", () => {
    expect(sessionProblems("10:00", "19:00", GEN)).toEqual([]);
    expect(sessionTotals("10:00", GEN)).toEqual({ workMinutes: 495, breakMinutes: 45 });
  });

  it("a night shift across midnight is valid and belongs to its start", () => {
    const night: SessionInput[] = [
      { kind: "WORK", label: "A", startTime: "22:00", endTime: "02:00" },
      { kind: "BREAK", label: "Meal", startTime: "02:00", endTime: "02:30" },
      { kind: "WORK", label: "B", startTime: "02:30", endTime: "06:00" },
    ];
    expect(crossesMidnight("22:00", "06:00")).toBe(true);
    expect(sessionProblems("22:00", "06:00", night)).toEqual([]);
    expect(sessionTotals("22:00", night)).toEqual({ workMinutes: 450, breakMinutes: 30 });
  });

  it("refuses gaps, a break at either end, two breaks together and parts outside the shift", () => {
    const gap = [GEN[0]!, { ...GEN[2]!, startTime: "14:50" }];
    expect(sessionProblems("10:00", "19:00", [{ ...GEN[0]!, endTime: "14:00" }, { ...GEN[2]!, startTime: "14:00" }])).toEqual([]);
    expect(sessionProblems("10:00", "19:00", gap).join(" ")).toMatch(/must start when part 1 ends/);
    expect(sessionProblems("10:00", "19:00", [GEN[1]!, ...GEN.slice(2)]).join(" ")).toMatch(/start and end with a work session/);
    const twoBreaks = [GEN[0]!, { ...GEN[1]!, endTime: "14:20" }, { ...GEN[1]!, label: "Tea", startTime: "14:20", endTime: "14:45" }, GEN[2]!];
    expect(sessionProblems("10:00", "19:00", twoBreaks).join(" ")).toMatch(/both breaks/);
    expect(sessionProblems("10:00", "19:00", [{ ...GEN[0]!, endTime: "19:00" }, { ...GEN[2]!, startTime: "19:00", endTime: "20:00" }]).join(" ")).toMatch(/must end when the shift ends/);
    expect(sessionProblems("10:00", "10:00", GEN)).toEqual(["A shift can't start and end at the same time."]);
    expect(sessionProblems("10:00", "19:00", [])).toEqual(["Add at least one work session."]);
  });
});

describe("week-off patterns", () => {
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  it("Sunday off (HR 2026-10-08): every Sunday, never a Saturday", () => {
    const sun = [{ weekday: 0 }];
    expect(isWeekOff(sun, d("2026-10-11"))).toBe(true);
    expect(isWeekOff(sun, d("2026-10-10"))).toBe(false);
    expect(describeWeekOff(sun)).toBe("Sunday");
  });
  it("2nd and 4th Saturday counts occurrences within the month", () => {
    const alt = [{ weekday: 0 }, { weekday: 6, weeks: [2, 4] }];
    expect(isWeekOff(alt, d("2026-10-03"))).toBe(false); // 1st Saturday
    expect(isWeekOff(alt, d("2026-10-10"))).toBe(true); // 2nd
    expect(isWeekOff(alt, d("2026-10-24"))).toBe(true); // 4th
    expect(isWeekOff(alt, d("2026-10-31"))).toBe(false); // 5th
    expect(describeWeekOff(alt)).toBe("Sunday; 2nd and 4th Saturday");
  });
  it("refuses a weekday listed twice, bad weeks, and every day off", () => {
    expect(weekOffRuleProblems([{ weekday: 0 }, { weekday: 0 }]).join(" ")).toMatch(/appears twice/);
    expect(weekOffRuleProblems([{ weekday: 6, weeks: [6] }]).join(" ")).toMatch(/1 to 5/);
    expect(weekOffRuleProblems([0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday }))).join(" ")).toMatch(/Every day/);
  });
});
