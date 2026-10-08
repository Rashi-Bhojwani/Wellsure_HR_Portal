import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { localTimeToInstant, parseAttlog } from "@shared/attendance/attlog";
import { collapseNearDuplicates, evaluateDay } from "../engine/engine";
import { attributePunches } from "../engine/windows";
import { shiftTimeline } from "../engine/time";
import type { DayInput, HalfLeave, PolicyDef, ShiftDef } from "../engine/types";

// The rules engine, rule by rule (docs/plans/PHASE_2.md §4.2, §4.5). Each case
// is named after the rule it pins. HR's GEN shift (2026-10-08): 10:00–19:00 in
// two sessions with lunch 14:00–14:45 — 8 h 15 m of scheduled work.
const GEN: ShiftDef = {
  id: "gen",
  code: "GEN",
  name: "General Shift",
  startTime: "10:00",
  endTime: "19:00",
  graceInMinutes: 0,
  graceOutMinutes: 0,
  windowBeforeMinutes: 240,
  windowAfterMinutes: 360,
  sessions: [
    { kind: "WORK", label: "First session", startTime: "10:00", endTime: "14:00" },
    { kind: "BREAK", label: "Lunch", startTime: "14:00", endTime: "14:45" },
    { kind: "WORK", label: "Second session", startTime: "14:45", endTime: "19:00" },
  ],
};
const NIGHT: ShiftDef = {
  ...GEN,
  id: "night",
  code: "NIGHT",
  startTime: "22:00",
  endTime: "06:00",
  sessions: [
    { kind: "WORK", label: "A", startTime: "22:00", endTime: "02:00" },
    { kind: "BREAK", label: "Meal", startTime: "02:00", endTime: "02:30" },
    { kind: "WORK", label: "B", startTime: "02:30", endTime: "06:00" },
  ],
};
const POLICY: PolicyDef = { id: "p", fullDayMinMinutes: 480, halfDayMinMinutes: 240, halfDayMinNotMetLopDays: 1, nearDuplicateSeconds: 120, inferBreakPairing: false };
const D = "2026-10-05"; // a Monday
const LATER = Date.parse("2027-01-01T00:00:00Z"); // long after every window has closed
const PL: HalfLeave = { code: "PL", unpaid: false };
const LOP: HalfLeave = { code: "LOP", unpaid: true };

/** An instant from IST wall-clock time on a date. */
const at = (time: string, date = D) => localTimeToInstant(`${date} ${time.length === 5 ? `${time}:00` : time}`, "Asia/Kolkata").getTime();
let n = 0;
const punches = (...times: string[]) => times.map((t) => ({ id: `p${++n}`, at: at(t) }));

function day(over: Partial<DayInput> = {}): DayInput {
  return { date: D, employed: true, holiday: null, shift: GEN, weekOff: false, leave: { first: null, second: null }, capture: "DEVICE", manual: null, punches: [], flaggedExcluded: 0, policy: POLICY, now: LATER, ...over };
}
const ev = (over: Partial<DayInput> = {}) => evaluateDay(day(over))!;

describe("shift timeline", () => {
  it("GEN: halves split at lunch; 8h15m of work, 45m of break", () => {
    const tl = shiftTimeline(GEN);
    expect(tl.halves.map((h) => h.map((i) => [i.start / 3600, i.end / 3600]))).toEqual([[[10, 14]], [[14.75, 19]]]);
    expect(tl.breaks).toEqual([{ start: 14 * 3600, end: 14.75 * 3600 }]);
  });
});

describe("step 7: computed from punches", () => {
  it("a normal day: in 10:00, out 19:00 → P; the scheduled lunch is deducted", () => {
    const r = ev({ punches: punches("10:00", "19:00") });
    expect(r).toMatchObject({ status: "P", firstHalfStatus: "P", secondHalfStatus: "P", source: "DEVICE", lopDays: 0, flags: [] });
    expect(r).toMatchObject({ totalMinutes: 540, breakMinutes: 45, actualMinutes: 495, inShiftMinutes: 495, lateInMinutes: 0, earlyOutMinutes: 0, shortfallMinutes: 0, excessMinutes: 0 });
  });

  it("direction is inferred: first punch is in, last is out, whatever order they arrive in", () => {
    const r = ev({ punches: [{ id: "x", at: at("19:00") }, { id: "y", at: at("10:00") }, { id: "z", at: at("12:00") }] });
    expect([r.firstIn, r.lastOut]).toEqual([at("10:00"), at("19:00")]);
    expect(r.status).toBe("P");
  });

  describe("grace, at the second", () => {
    it("grace 0: 10:00:00 is on time, 10:00:01 is late (1 minute, rounded up)", () => {
      expect(ev({ punches: punches("10:00:00", "19:00") }).flags).toEqual([]);
      expect(ev({ punches: punches("10:00:01", "19:00") })).toMatchObject({ flags: ["LATE_IN"], lateInMinutes: 1, status: "P" });
    });
    it("grace 10: 10:10:00 is on time, 10:10:01 is late", () => {
      const shift = { ...GEN, graceInMinutes: 10 };
      expect(ev({ shift, punches: punches("10:10:00", "19:00") }).flags).toEqual([]);
      expect(ev({ shift, punches: punches("10:10:01", "19:00") })).toMatchObject({ flags: ["LATE_IN"], lateInMinutes: 1 });
    });
    it("early out: 18:59:59 with grace out 0 is early; 18:55 with grace out 5 isn't", () => {
      expect(ev({ punches: punches("10:00", "18:59:59") })).toMatchObject({ flags: ["EARLY_OUT"], earlyOutMinutes: 1 });
      expect(ev({ shift: { ...GEN, graceOutMinutes: 5 }, punches: punches("10:00", "18:55") }).flags).toEqual([]);
    });
    it("lateness is recorded with no penalty (HR 2026-10-08): no LOP for being late", () => {
      expect(ev({ punches: punches("10:10", "19:00") })).toMatchObject({ status: "P", lopDays: 0, lateInMinutes: 10, flags: ["LATE_IN"] });
    });
    it("…but hours still count: with an 8 h full-day minimum against 8 h 15 m of work, arriving 11:30 is a half day", () => {
      expect(ev({ punches: punches("11:30", "19:00") })).toMatchObject({ actualMinutes: 405, status: "A:P", lopDays: 0.5, lateInMinutes: 90, flags: ["LATE_IN", "SHORTFALL"] });
    });
    it("the fail-safe placeholder thresholds (6 h / 3 h) never turn lateness into a half day", () => {
      const policy = { ...POLICY, fullDayMinMinutes: 360, halfDayMinMinutes: 180 };
      expect(ev({ policy, punches: punches("11:30", "19:00") })).toMatchObject({ status: "P", lopDays: 0, lateInMinutes: 90, flags: ["LATE_IN"] });
      expect(ev({ policy, punches: punches("12:00", "19:00") })).toMatchObject({ actualMinutes: 375, status: "P", lopDays: 0 });
      // a genuine short day is still a half day: 10:00–14:00 is the whole first half
      expect(ev({ policy, punches: punches("10:00", "14:00") })).toMatchObject({ actualMinutes: 240, status: "P:A", lopDays: 0.5 });
    });
  });

  describe("the two-session shift and the lunch break", () => {
    it("leaves and returns within the break: the scheduled 45m is deducted, not the real gap (inference off)", () => {
      const r = ev({ punches: punches("10:00", "14:05", "14:40", "19:00") });
      expect(r).toMatchObject({ status: "P", punchCount: 4, breakMinutes: 45, actualMinutes: 495 });
    });
    it("with inferred pairing on, the real gap is the break", () => {
      const r = ev({ policy: { ...POLICY, inferBreakPairing: true }, punches: punches("10:00", "14:05", "14:40", "19:00") });
      expect(r).toMatchObject({ status: "P", breakMinutes: 35, actualMinutes: 505 });
    });
    it("leaves during lunch and never returns: only the lunch it covered is deducted → first half present", () => {
      const r = ev({ punches: punches("10:00", "14:20") });
      expect(r).toMatchObject({ totalMinutes: 260, breakMinutes: 20, actualMinutes: 240, status: "P:A", lopDays: 0.5, flags: ["EARLY_OUT", "SHORTFALL"] });
    });
    it("arrives during lunch: the rest of lunch is deducted → second half present, late from 10:00", () => {
      const r = ev({ punches: punches("14:30", "19:00") });
      expect(r).toMatchObject({ breakMinutes: 15, actualMinutes: 255, status: "A:P", lopDays: 0.5, lateInMinutes: 270 });
      expect(r.flags).toEqual(["LATE_IN", "SHORTFALL"]);
    });
  });

  describe("full-day and half-day thresholds, exactly", () => {
    it("actual = full-day minimum → P; one second under → half day", () => {
      expect(ev({ punches: punches("10:00", "18:45") })).toMatchObject({ actualMinutes: 480, status: "P" });
      expect(ev({ punches: punches("10:00", "18:44:59") }).status).toBe("P:A");
    });
    it("actual = half-day minimum → half day; one second under → absent, half-day minimum not met, 1 day LOP", () => {
      expect(ev({ punches: punches("10:00", "14:00") })).toMatchObject({ actualMinutes: 240, status: "P:A", lopDays: 0.5 });
      expect(ev({ punches: punches("10:00", "13:59:59") })).toMatchObject({ status: "A", lopDays: 1 });
      expect(ev({ punches: punches("10:00", "13:59:59") }).flags).toContain("HALF_DAY_MIN_NOT_MET");
    });
    it("the LOP for half-day minimum not met is configurable", () => {
      expect(ev({ policy: { ...POLICY, halfDayMinNotMetLopDays: 0.5 }, punches: punches("10:00", "12:00") }).lopDays).toBe(0.5);
    });
    it("a half day covering both halves equally is HD with no half named", () => {
      // 12:00–16:52:30: 2 h of the 4 h first half (50%), 2 h 7½ m of the 4 h 15 m second half (50%)
      const r = ev({ punches: punches("12:00", "16:52:30") });
      expect(r.actualMinutes).toBeGreaterThanOrEqual(240);
      expect(r.status).toBe("HD");
    });
  });

  it("one punch only → A with MISSING_PUNCH, until regularized", () => {
    expect(ev({ punches: punches("10:02") })).toMatchObject({ status: "A", lopDays: 1, flags: ["MISSING_PUNCH"], lateInMinutes: null });
    expect(ev({ punches: punches("19:00") })).toMatchObject({ flags: ["MISSING_PUNCH"] }); // a lone evening punch isn't "late"
  });

  it("no punches on a working day → A, 1 day LOP, not an exception", () => {
    expect(ev()).toMatchObject({ status: "A", lopDays: 1, flags: [] });
  });

  describe("near-duplicates", () => {
    it("the real sample's user 113: two punches three seconds apart count once", () => {
      const sample = readFileSync(path.join(__dirname, "../../biometric/__tests__/fixtures/sample-attlog.txt"), "utf8");
      const user113 = parseAttlog(sample).lines.filter((l) => l.deviceUserId === "113").map((l) => localTimeToInstant(l.localTime, "Asia/Kolkata").getTime());
      expect(user113).toHaveLength(2);
      expect(collapseNearDuplicates(user113, 120).kept).toEqual([user113[0]]);
      const r = evaluateDay(day({ date: "2021-09-01", punches: [{ id: "in", at: at("10:00", "2021-09-01") }, ...user113.map((ms, i) => ({ id: `113-${i}`, at: ms }))] }))!;
      expect(r).toMatchObject({ punchCount: 2, collapsedPunches: 1, usedPunchIds: ["in", "113-0"] });
    });
    it("collapse compares with the last punch kept: 0s, 90s, 180s with a 120s window keep 0s and 180s", () => {
      const t = at("10:00");
      expect(collapseNearDuplicates([t, t + 90_000, t + 180_000], 120).kept).toEqual([t, t + 180_000]);
    });
  });

  it("CLOCK_FLAGGED when a punch on the day still awaits HR's decision on its time", () => {
    expect(ev({ punches: punches("10:00", "19:00"), flaggedExcluded: 1 }).flags).toEqual(["CLOCK_FLAGGED"]);
  });

  it("no shift assigned → NS with NO_SHIFT, never LOP", () => {
    expect(ev({ shift: null, punches: punches("10:00", "19:00") })).toMatchObject({ status: "NS", flags: ["NO_SHIFT"], lopDays: 0 });
  });

  describe("provisional while the shift window is open", () => {
    it("someone who has punched in is present so far; no missing punch yet", () => {
      expect(ev({ now: at("12:00"), punches: punches("10:05") })).toMatchObject({ status: "P", provisional: true, flags: ["LATE_IN"], lopDays: 0 });
    });
    it("nobody yet: absent so far, no LOP until the window closes", () => {
      expect(ev({ now: at("12:00") })).toMatchObject({ status: "A", provisional: true, lopDays: 0 });
    });
    it("final after the window closes (GEN: 01:00 the next day)", () => {
      expect(ev({ now: at("00:59", "2026-10-06"), punches: punches("10:05") }).provisional).toBe(true);
      expect(ev({ now: at("01:00", "2026-10-06"), punches: punches("10:05") })).toMatchObject({ provisional: false, status: "A", flags: ["MISSING_PUNCH"] });
    });
  });
});

describe("steps 1–4: order of precedence", () => {
  it("not employed on D → no record", () => {
    expect(evaluateDay(day({ employed: false, punches: punches("10:00", "19:00") }))).toBeNull();
  });
  it("holiday beats week-off and leave; work on it is recorded, never an exception", () => {
    const r = ev({ holiday: "Diwali", weekOff: true, leave: { first: PL, second: PL }, punches: punches("10:00", "19:00") });
    expect(r).toMatchObject({ status: "H", source: "HOLIDAY", holidayName: "Diwali", workedOnOffDay: true, lopDays: 0, flags: [], actualMinutes: 495 });
  });
  it("week-off beats leave; a week-off without work isn't worked", () => {
    expect(ev({ weekOff: true, leave: { first: PL, second: PL } })).toMatchObject({ status: "O", source: "WEEK_OFF", workedOnOffDay: false, lopDays: 0 });
    expect(ev({ weekOff: true, punches: punches("10:00") })).toMatchObject({ status: "O", workedOnOffDay: true, flags: [] });
  });
  it("full-day leave → the leave code; unpaid leave is LOP", () => {
    expect(ev({ leave: { first: PL, second: PL }, punches: punches("10:00", "19:00") })).toMatchObject({ status: "PL", source: "LEAVE", leaveTypeCode: "PL", lopDays: 0 });
    expect(ev({ leave: { first: LOP, second: LOP } })).toMatchObject({ status: "LOP", lopDays: 1 });
  });
  it("first-half leave + worked second half → PL:P, lateness measured from the second half's start", () => {
    const r = ev({ leave: { first: PL, second: null }, punches: punches("14:45", "19:00") });
    expect(r).toMatchObject({ status: "PL:P", firstHalfStatus: "PL", secondHalfStatus: "P", lopDays: 0, flags: [], actualMinutes: 255 });
    expect(ev({ leave: { first: PL, second: null }, punches: punches("15:00", "19:00") })).toMatchObject({ lateInMinutes: 15, flags: ["LATE_IN"] });
  });
  it("first-half leave + second half not worked → PL:A, half a day LOP", () => {
    expect(ev({ leave: { first: PL, second: null } })).toMatchObject({ status: "PL:A", lopDays: 0.5 });
  });
  it("second-half leave + worked first half → P:PL, early-out measured at the first half's end", () => {
    expect(ev({ leave: { first: null, second: PL }, punches: punches("10:00", "14:00") })).toMatchObject({ status: "P:PL", flags: [] });
    expect(ev({ leave: { first: null, second: PL }, punches: punches("10:00", "13:30") }).flags).toEqual(["EARLY_OUT", "HALF_DAY_MIN_NOT_MET"]);
  });
  it("different leave on each half → PL:LOP, half a day LOP", () => {
    expect(ev({ leave: { first: PL, second: LOP } })).toMatchObject({ status: "PL:LOP", lopDays: 0.5 });
  });
});

describe("step 6: manual capture (no device mapping on D)", () => {
  it("nothing entered → NM: never absent, never an exception, no LOP", () => {
    expect(ev({ capture: "MANUAL" })).toMatchObject({ status: "NM", source: "MANUAL", flags: [], lopDays: 0 });
    expect(ev({ capture: "MANUAL", leave: { first: PL, second: null } })).toMatchObject({ status: "PL:NM", lopDays: 0 });
  });
  it("a TIMED entry goes through the punch rules exactly like device punches (10:45 is late)", () => {
    const manual = ev({ capture: "MANUAL", manual: { kind: "TIMED", id: "m1", inTime: "10:45", outTime: "19:00" } });
    const device = ev({ punches: punches("10:45", "19:00") });
    // late, exactly as a punched 10:45 — and, with an 8 h full-day minimum, a half day like it
    expect(manual).toMatchObject({ source: "MANUAL", status: "A:P", lateInMinutes: 45, flags: ["LATE_IN", "SHORTFALL"], manualEntryId: "m1" });
    const strip = ({ source: _s, capture: _c, usedPunchIds: _u, manualEntryId: _m, ...rest }: ReturnType<typeof ev>) => rest;
    expect(strip(manual)).toEqual(strip(device));
  });
  it("a TIMED entry with only an IN → A with MISSING_PUNCH, like one punch", () => {
    expect(ev({ capture: "MANUAL", manual: { kind: "TIMED", id: "m", inTime: "10:00", outTime: null } })).toMatchObject({ status: "A", flags: ["MISSING_PUNCH"] });
  });
  it("STATUS_ONLY is taken as entered, with no times and never an exception", () => {
    const so = (status: "P" | "A" | "HD_FIRST" | "HD_SECOND") => ev({ capture: "MANUAL", manual: { kind: "STATUS_ONLY", id: "s", status } });
    expect(so("P")).toMatchObject({ status: "P", lopDays: 0, flags: [], actualMinutes: null });
    expect(so("A")).toMatchObject({ status: "A", lopDays: 1, flags: [] });
    expect(so("HD_FIRST")).toMatchObject({ status: "P:A", lopDays: 0.5 });
    expect(so("HD_SECOND")).toMatchObject({ status: "A:P", lopDays: 0.5 });
  });
  it("a manual WORKED on a week-off marks it worked", () => {
    expect(ev({ capture: "MANUAL", weekOff: true, manual: { kind: "STATUS_ONLY", id: "s", status: "WORKED" } })).toMatchObject({ status: "O", workedOnOffDay: true });
  });
});

describe("punch windows and night shifts", () => {
  it("a night shift crossing midnight: the after-midnight punch belongs to the shift's start date", () => {
    const ps = [
      { id: "in", at: at("21:58", "2026-10-05") },
      { id: "out", at: at("06:04", "2026-10-06") },
      { id: "next", at: at("21:59", "2026-10-06") },
    ];
    const { byDate, outside } = attributePunches(ps, ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"].map((date) => ({ date, shift: NIGHT })));
    expect(byDate.get("2026-10-05")!.map((p) => p.id)).toEqual(["in", "out"]);
    expect(byDate.get("2026-10-06")!.map((p) => p.id)).toEqual(["next"]);
    expect(outside).toEqual([]);
    // A night shift has 7 h 30 m of work, so it needs its own policy thresholds.
    const r = evaluateDay(day({ shift: NIGHT, policy: { ...POLICY, fullDayMinMinutes: 420, halfDayMinMinutes: 210 }, punches: byDate.get("2026-10-05")! }))!;
    expect(r).toMatchObject({ status: "P", totalMinutes: 486, breakMinutes: 30, actualMinutes: 456, flags: [] });
  });
  it("a manual night-shift entry reads the out time as the next morning", () => {
    expect(ev({ shift: NIGHT, policy: { ...POLICY, fullDayMinMinutes: 420, halfDayMinMinutes: 210 }, capture: "MANUAL", manual: { kind: "TIMED", id: "m", inTime: "22:00", outTime: "06:00" } })).toMatchObject({ totalMinutes: 480, actualMinutes: 450, status: "P" });
  });
  it("overlapping windows: the nearer shift start wins; an exact tie goes to the earlier date", () => {
    const wide = { ...GEN, windowBeforeMinutes: 720, windowAfterMinutes: 720 };
    const days = ["2026-10-05", "2026-10-06"].map((date) => ({ date, shift: wide }));
    const ps = [
      { id: "late-night", at: at("02:30", "2026-10-06") }, // 16.5 h after Monday's start, 7.5 h before Tuesday's
      { id: "tie", at: at("22:00", "2026-10-05") }, // exactly 12 h from both starts
    ];
    const { byDate } = attributePunches(ps, days);
    expect(byDate.get("2026-10-06")!.map((p) => p.id)).toEqual(["late-night"]);
    expect(byDate.get("2026-10-05")!.map((p) => p.id)).toEqual(["tie"]);
  });
  it("a punch in no window is kept out of every day, and reported", () => {
    const { byDate, outside } = attributePunches([{ id: "3am", at: at("03:00", "2026-10-06") }], ["2026-10-05", "2026-10-06"].map((date) => ({ date, shift: GEN })));
    expect([...byDate.keys()]).toEqual([]);
    expect(outside.map((p) => p.id)).toEqual(["3am"]);
  });
});

describe("determinism", () => {
  it("the same inputs give the same day, every time", () => {
    const input = day({ punches: punches("10:07", "14:10", "14:41", "18:20") });
    expect(evaluateDay(input)).toEqual(evaluateDay(structuredClone(input)));
  });
});
