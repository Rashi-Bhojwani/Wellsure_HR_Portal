import { describe, expect, it } from "vitest";
import { evaluateDay } from "../../attendance/engine/engine";
import type { DayInput, DayResult } from "../../attendance/engine/types";
import { allowancesLeft, applyHalfDay, applyMissingPunch, arrivalMinute, bandOf, cutToAdd, DEFAULT_RULE, evaluateMonth, istMinute, minuteOf, type Band, type LateRule, type Outcome } from "../evaluate";
import { penaltyToCharge } from "../penalties";
import { dec } from "../../payroll/money";

// GOLDEN tests of the lateness rule, pure (docs/plans/LATE_CHECKLIST.md §2, §8). Every boundary, every outcome in every band, both edges, the allowance counter,
// waivers and the higher-of rule.

const RULE: LateRule = { ...DEFAULT_RULE, active: true };
const m = (hhmm: string) => minuteOf(hhmm);
const rule = (bands: [Band, Band, Band], edge: "INCLUSIVE" | "EXCLUSIVE" = "INCLUSIVE"): LateRule => ({ ...RULE, cutoffs: RULE.cutoffs.map((c) => ({ ...c, edge })) as LateRule["cutoffs"], bands });
const every = (outcome: Outcome): Band => ({ outcome, applies: { mode: "EVERY_TIME" } });

describe("bands and edges", () => {
  it("GOLDEN inclusive edges (the proposed starting value): 10:09 on time, 10:10 band 1, 10:19 band 1, 10:20 band 2, 10:29 band 2, 10:30 band 3, 10:31 band 3", () => {
    const got = ["10:09", "10:10", "10:19", "10:20", "10:29", "10:30", "10:31"].map((t) => bandOf(m(t), RULE.cutoffs));
    expect(got).toEqual([0, 1, 1, 2, 2, 3, 3]);
  });
  it("GOLDEN exclusive edges: the cutoff minute itself is the band below", () => {
    const ex = rule(RULE.bands, "EXCLUSIVE").cutoffs;
    const got = ["10:09", "10:10", "10:11", "10:19", "10:20", "10:21", "10:29", "10:30", "10:31"].map((t) => bandOf(m(t), ex));
    expect(got).toEqual([0, 0, 1, 1, 1, 2, 2, 2, 3]);
  });
  it("each cutoff has its own edge", () => {
    const mixed = [{ time: "10:10", edge: "EXCLUSIVE" }, { time: "10:20", edge: "INCLUSIVE" }, { time: "10:30", edge: "EXCLUSIVE" }] as LateRule["cutoffs"];
    expect(["10:10", "10:20", "10:30", "10:31"].map((t) => bandOf(m(t), mixed))).toEqual([0, 2, 2, 3]);
  });
  it("seconds are dropped: 10:09:59 IST is 10:09 (on time), 10:10:00 is late", () => {
    const at = (s: string) => Date.parse(`2026-10-05T${s}+05:30`);
    expect(bandOf(istMinute(at("10:09:59")), RULE.cutoffs)).toBe(0);
    expect(bandOf(istMinute(at("10:10:00")), RULE.cutoffs)).toBe(1);
  });
});

describe("the allowance counter (10:20 to 10:30: three free a month, then a 0.5-day cut)", () => {
  const four = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"].map((date) => ({ date, minute: m("10:25") }));
  it("GOLDEN the 3rd arrival uses the last allowance; the 4th and every later one is cut", () => {
    const r = evaluateMonth(RULE, [...four, { date: "2026-10-09", minute: m("10:21") }], new Set());
    expect(r.map((x) => x.consequence)).toEqual([
      { kind: "FREE", allowanceNo: 1, of: 3 },
      { kind: "FREE", allowanceNo: 2, of: 3 },
      { kind: "FREE", allowanceNo: 3, of: 3 },
      { kind: "CUT", days: 0.5 },
      { kind: "CUT", days: 0.5 },
    ]);
    expect(allowancesLeft(RULE, r)[1]).toEqual({ band: 2, free: 3, used: 3, left: 0 });
  });
  it("GOLDEN after 10:30 is cut every time and uses no allowance; 10:10 to 10:20 (Not set) costs nothing", () => {
    const r = evaluateMonth(RULE, [{ date: "2026-10-05", minute: m("10:31") }, { date: "2026-10-06", minute: m("10:12") }, { date: "2026-10-07", minute: m("10:22") }], new Set());
    expect(r.map((x) => [x.band, x.consequence.kind])).toEqual([[3, "CUT"], [1, "NOT_SET"], [2, "FREE"]]);
    expect(allowancesLeft(RULE, r)[1]!.left).toBe(2);
  });
  it("GOLDEN a waiver returns the allowance: waiving the 2nd arrival makes the 4th free and only the 5th is cut", () => {
    const five = [...four, { date: "2026-10-09", minute: m("10:25") }];
    const r = evaluateMonth(RULE, five, new Set(["2026-10-06"]));
    expect(r.map((x) => x.consequence.kind)).toEqual(["FREE", "WAIVED", "FREE", "FREE", "CUT"]);
    expect(allowancesLeft(RULE, r)[1]!.left).toBe(0);
    expect(allowancesLeft(RULE, evaluateMonth(RULE, four.slice(0, 2), new Set(["2026-10-06"])))[1]!.left).toBe(2);
  });
  it("arrivals are numbered in date order whatever order they are given in; on-time days do not count", () => {
    const r = evaluateMonth(RULE, [...four].reverse().concat({ date: "2026-10-01", minute: m("10:00") }), new Set());
    expect(r.map((x) => x.date)).toEqual(four.map((x) => x.date));
    expect(r.at(-1)!.consequence.kind).toBe("CUT");
  });
});

describe("every outcome in every band", () => {
  const outcomes: Outcome[] = [{ kind: "NOT_SET" }, { kind: "NONE" }, { kind: "MARK" }, { kind: "CUT", days: "0.5" }, { kind: "PENALTY", amount: "200" }];
  const times = ["10:15", "10:25", "10:45"];
  for (let band = 0; band < 3; band++) {
    for (const o of outcomes) {
      it(`GOLDEN band ${band + 1}, ${o.kind}: the consequence is exactly that, and only in that band`, () => {
        const bands: [Band, Band, Band] = [every({ kind: "NONE" }), every({ kind: "NONE" }), every({ kind: "NONE" })];
        bands[band] = every(o);
        const r = evaluateMonth(rule(bands), times.map((t, i) => ({ date: `2026-10-0${i + 5}`, minute: m(t) })), new Set());
        const expected = o.kind === "CUT" ? { kind: "CUT", days: 0.5 } : o.kind === "PENALTY" ? { kind: "PENALTY", amount: "200" } : { kind: o.kind };
        expect(r[band]!.consequence).toEqual(expected);
        for (let other = 0; other < 3; other++) if (other !== band) expect(r[other]!.consequence).toEqual({ kind: "NONE" });
      });
    }
  }
  it("'no consequence', 'late mark only' and 'Not set' never add loss of pay", () => {
    const r = evaluateMonth(rule([every({ kind: "NONE" }), every({ kind: "MARK" }), every({ kind: "NOT_SET" })]), times.map((t, i) => ({ date: `2026-10-0${i + 5}`, minute: m(t) })), new Set());
    expect(r.every((x) => x.consequence.kind !== "CUT" && x.consequence.kind !== "PENALTY")).toBe(true);
  });
  it("one band has one outcome: an arrival is never both a penalty and a salary cut", () => {
    const r = evaluateMonth(rule([every({ kind: "CUT", days: "0.5" }), every({ kind: "PENALTY", amount: "100" }), every({ kind: "CUT", days: "1" })]), times.map((t, i) => ({ date: `2026-10-0${i + 5}`, minute: m(t) })), new Set());
    expect(r.map((x) => x.consequence.kind)).toEqual(["CUT", "PENALTY", "CUT"]);
  });
});

describe("the higher-of rule", () => {
  it("GOLDEN salary cut vs short hours: the day loses the higher, never both", () => {
    expect(cutToAdd(0.5, 0)).toBe(0.5); // a full day worked, late: 0.5
    expect(cutToAdd(0.5, 0.5)).toBe(0); // a half day (0.5) and late (0.5): 0.5 in all
    expect(cutToAdd(0.5, 1)).toBe(0); // half-day minimum not met (1) and late: 1 in all
    expect(cutToAdd(1, 0.5)).toBe(0.5); // a 1-day cut on a half day: 1 in all
  });
  it("GOLDEN penalty vs short hours (rupees): the line is what the penalty exceeds the day's lost pay by, never both added", () => {
    expect(penaltyToCharge(dec("200"), dec("0")).toString()).toBe("200");
    expect(penaltyToCharge(dec("200"), dec("806.45")).toString()).toBe("0");
    expect(penaltyToCharge(dec("1000"), dec("806.45")).toString()).toBe("193.55");
  });
});

describe("what counts as an arrival", () => {
  const base = { firstIn: Date.parse("2026-10-05T10:25:00+05:30"), inKnown: true, status: "P", firstHalfStatus: "P", source: "DEVICE", shiftStart: "10:00" };
  it("a closed day with a lone punch, a holiday, a week-off, full leave, a first-half leave and a shift starting at or after the first cutoff are not arrivals", () => {
    expect(arrivalMinute(RULE, base)).toBe(m("10:25"));
    expect(arrivalMinute(RULE, { ...base, inKnown: false })).toBeNull();
    expect(arrivalMinute(RULE, { ...base, source: "HOLIDAY" })).toBeNull();
    expect(arrivalMinute(RULE, { ...base, source: "WEEK_OFF" })).toBeNull();
    expect(arrivalMinute(RULE, { ...base, source: "LEAVE" })).toBeNull();
    expect(arrivalMinute(RULE, { ...base, firstHalfStatus: "PL" })).toBeNull();
    expect(arrivalMinute(RULE, { ...base, shiftStart: "10:10" })).toBeNull();
    expect(arrivalMinute(RULE, { ...base, shiftStart: "21:00" })).toBeNull();
    expect(arrivalMinute(RULE, { ...base, firstHalfStatus: null, status: "HD" })).toBe(m("10:25"));
  });
});

describe("missing punch and half-day thresholds: today's behaviour is the default", () => {
  const shift = { id: "s", code: "GEN", name: "General", startTime: "10:00", endTime: "19:00", graceInMinutes: 0, graceOutMinutes: 0, windowBeforeMinutes: 120, windowAfterMinutes: 240, sessions: [{ kind: "WORK" as const, label: "1", startTime: "10:00", endTime: "14:00" }, { kind: "BREAK" as const, label: "L", startTime: "14:00", endTime: "14:45" }, { kind: "WORK" as const, label: "2", startTime: "14:45", endTime: "19:00" }] };
  const input = (times: string[]): DayInput => ({
    date: "2026-10-05",
    employed: true,
    holiday: null,
    shift,
    weekOff: false,
    leave: { first: null, second: null },
    capture: "DEVICE",
    manual: null,
    override: null,
    punches: times.map((t, i) => ({ id: `p${i}`, at: Date.parse(`2026-10-05T${t}:00+05:30`) })),
    flaggedExcluded: 0,
    policy: { id: "p", fullDayMinMinutes: 480, halfDayMinMinutes: 240, halfDayMinNotMetLopDays: 1, nearDuplicateSeconds: 120, inferBreakPairing: false },
    now: Date.parse("2026-10-07T00:00:00+05:30"),
  });
  it("GOLDEN missing punch: ABSENT_FULL_DAY leaves the engine's result as it is (absent, 1 day lost); HALF_DAY loses 0.5; PRESENT_FLAGGED loses nothing and keeps the flag", () => {
    const r = evaluateDay(input(["10:05"]))!;
    expect([r.status, r.lopDays, r.flags]).toEqual(["A", 1, ["MISSING_PUNCH"]]);
    expect(applyMissingPunch(r, "ABSENT_FULL_DAY", input([]))).toBe(r);
    expect(applyMissingPunch(r, "HALF_DAY", input([]))).toMatchObject({ status: "HD", lopDays: 0.5 });
    expect(applyMissingPunch(r, "PRESENT_FLAGGED", input([]))).toMatchObject({ status: "P", lopDays: 0, flags: ["MISSING_PUNCH"] });
    const ok = evaluateDay(input(["10:05", "19:00"]))! as DayResult;
    expect(applyMissingPunch(ok, "PRESENT_FLAGGED", input([]))).toBe(ok);
  });
  it("GOLDEN half-day thresholds replace the policy's figures only when chosen", () => {
    const sixHours = input(["10:00", "16:45"]); // 6 h worked (break excluded)
    expect(evaluateDay(sixHours)!.lopDays).toBe(0.5);
    expect(evaluateDay(applyHalfDay(sixHours, { effectiveFrom: "2026-10-01", fullDayMinMinutes: 360, halfDayMinMinutes: 180, halfDayMinNotMetLopDays: "1" }))!.lopDays).toBe(0);
    const twoHours = input(["10:00", "12:00"]);
    expect(evaluateDay(twoHours)!.lopDays).toBe(1);
    expect(evaluateDay(applyHalfDay(twoHours, { effectiveFrom: "2026-10-01", fullDayMinMinutes: 480, halfDayMinMinutes: 240, halfDayMinNotMetLopDays: "0.5" }))!.lopDays).toBe(0.5);
  });
});
