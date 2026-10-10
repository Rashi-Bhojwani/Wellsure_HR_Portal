import { describe, expect, it } from "vitest";
import { referenceDay, SIM_DAY, SIM_NIGHT, simMasters, type RefDay, type SimLeaveType } from "@shared/attendance/simulator";

// The reference model against numbers worked out BY HAND from the written rules
// (docs/plans/PHASE_2.md "P2-G build design"). The reference model is what the
// engine's output is compared with, so it must itself be pinned to something
// that isn't code: each case below is arithmetic a person can check with a
// pencil. Shift SIM-DAY is 10:00–19:00, grace 10 min in and out, work 10:00–14:00
// and 14:45–19:00 (lunch 14:00–14:45); SIM-STD needs 420 min for a full day and
// 240 for a half; SIM-STRICT 480 and 300.

const M = simMasters("2026-08");
const STD = M.policies.find((p) => p.code === "SIM-STD")!;
const STRICT = M.policies.find((p) => p.code === "SIM-STRICT")!;
const PL: SimLeaveType = { code: "SIMPL", name: "paid", paid: true };
const LOP: SimLeaveType = { code: "SIMLOP", name: "unpaid", paid: false };
const t = (hhmmss: string) => {
  const [h, m, s] = hhmmss.split(":").map(Number);
  return h! * 3600 + m! * 60 + (s ?? 0);
};

const day = (over: Partial<RefDay>): RefDay => ({
  date: "2026-08-12",
  employed: true,
  holiday: null,
  weekOff: false,
  leave: { first: null, second: null },
  capture: "DEVICE",
  manual: null,
  punches: [],
  flaggedExcluded: 0,
  outsideWindowPunches: 0,
  shift: SIM_DAY,
  policy: STD,
  ...over,
});
const punched = (...times: string[]) => day({ punches: times.map(t) });

describe("the reference model, against arithmetic worked out by hand", () => {
  it("a normal day: 10:05 to 19:00 is 535 min on the premises, less the 45 min lunch = 490 min of work", () => {
    const r = referenceDay(punched("10:05:00", "19:00:00"))!;
    expect(r).toMatchObject({ status: "P", firstHalf: "P", secondHalf: "P", lopDays: 0, flags: [], totalMinutes: 535, breakMinutes: 45, actualMinutes: 490, inShiftMinutes: 490, lateInMinutes: 0, earlyOutMinutes: 0, shortfallMinutes: 5, excessMinutes: 0, punchCount: 2 });
    expect(r.firstIn).toBe("2026-08-12 10:05:00");
    expect(r.lastOut).toBe("2026-08-12 19:00:00");
  });

  it("late: the 10-minute grace ends at 10:10:00; one second after is a minute late (rounded up), 10:11:00 is also one", () => {
    expect(referenceDay(punched("10:10:00", "19:00:00"))).toMatchObject({ lateInMinutes: 0, flags: [] });
    expect(referenceDay(punched("10:10:01", "19:00:00"))).toMatchObject({ lateInMinutes: 1, flags: ["LATE_IN"] });
    expect(referenceDay(punched("10:11:00", "19:00:00"))).toMatchObject({ lateInMinutes: 1, flags: ["LATE_IN"] });
    expect(referenceDay(punched("10:11:01", "19:00:00"))).toMatchObject({ lateInMinutes: 2 });
    expect(referenceDay(punched("10:35:00", "19:30:00"))).toMatchObject({ status: "P", lateInMinutes: 25, flags: ["LATE_IN"] });
  });

  it("early: the earliest an out is on time is 18:50:00 (the end less 10 minutes grace)", () => {
    expect(referenceDay(punched("09:55:00", "18:50:00"))).toMatchObject({ earlyOutMinutes: 0, flags: [] });
    expect(referenceDay(punched("09:55:00", "18:49:59"))).toMatchObject({ earlyOutMinutes: 1, flags: ["EARLY_OUT"] });
    expect(referenceDay(punched("09:55:00", "18:30:00"))).toMatchObject({ status: "P", earlyOutMinutes: 20, flags: ["EARLY_OUT"] });
  });

  it("the half-day minimum (240 min under SIM-STD): 10:00 to 14:00 is exactly 240, so it is met; one second less is not", () => {
    const met = referenceDay(punched("10:00:00", "14:00:00"))!;
    // 240 min of work, all in the first half: first half present, second absent, half a day's loss, short of a full day
    expect(met).toMatchObject({ status: "P:A", firstHalf: "P", secondHalf: "A", lopDays: 0.5, actualMinutes: 240 });
    expect(met.flags).toEqual(["EARLY_OUT", "SHORTFALL"]);
    const under = referenceDay(punched("10:00:00", "13:59:59"))!;
    // 239 min 59 s: under the half-day minimum: absent, the policy's not-met loss (1 day under SIM-STD)
    expect(under).toMatchObject({ status: "A", firstHalf: "A", secondHalf: "A", lopDays: 1, actualMinutes: 239 });
    expect(under.flags).toEqual(["EARLY_OUT", "HALF_DAY_MIN_NOT_MET"]);
  });

  it("the full-day minimum (420 min under SIM-STD): 10:00 to 17:45 is 465 − 45 = exactly 420, so it is met; one second less is a half day", () => {
    expect(referenceDay(punched("10:00:00", "17:45:00"))).toMatchObject({ status: "P", lopDays: 0, actualMinutes: 420 });
    const under = referenceDay(punched("10:00:00", "17:44:59"))!;
    // 419 min 59 s: a half day, and the person covered all of the first half and part of the second
    expect(under).toMatchObject({ status: "P:A", lopDays: 0.5, actualMinutes: 419 });
    expect(under.flags).toContain("SHORTFALL");
  });

  it("a half day starting late covers more of the SECOND half: 12:00 to 19:00 is 420 − 45 = 375 min", () => {
    // first half covered 12:00–14:00 = 2 h of 4 h (0.5); second half all of 14:45–19:00 (1.0): the second half is present
    expect(referenceDay(punched("12:00:00", "19:00:00"))).toMatchObject({ status: "A:P", firstHalf: "A", secondHalf: "P", lopDays: 0.5, actualMinutes: 375, lateInMinutes: 110 });
  });

  it("a tie between the halves is a plain half day (`HD`, no half named): 12:00 to 16:52:30 covers half of each", () => {
    // first half 12:00–14:00 = 120 of 240 min; second 14:45–16:52:30 = 127.5 of 255 min: both exactly 0.5; work 120 + 127.5 = 247.5 min
    const r = referenceDay(punched("12:00:00", "16:52:30"))!;
    expect(r).toMatchObject({ status: "HD", firstHalf: null, secondHalf: null, lopDays: 0.5, actualMinutes: 247 });
  });

  it("the stricter policy changes outcomes: 10:00 to 17:45 (420 min) is a full day under SIM-STD but a half day under SIM-STRICT (480 / 300)", () => {
    expect(referenceDay(day({ punches: [t("10:00:00"), t("17:45:00")], policy: STRICT }))).toMatchObject({ status: "P:A", lopDays: 0.5 });
    // and under SIM-STRICT, 10:00 to 14:59 is 299 min of work: below its 300 min half-day minimum, with its not-met loss of half a day
    expect(referenceDay(day({ punches: [t("10:00:00"), t("14:59:00")], policy: STRICT }))).toMatchObject({ status: "A", lopDays: 0.5, flags: expect.arrayContaining(["HALF_DAY_MIN_NOT_MET"]) });
  });

  it("one punch is absent with MISSING_PUNCH and a day's loss, and is never called late; no punches is absent with a day's loss", () => {
    expect(referenceDay(punched("10:03:00"))).toMatchObject({ status: "A", lopDays: 1, flags: ["MISSING_PUNCH"], lateInMinutes: null, earlyOutMinutes: null, actualMinutes: null, punchCount: 1, firstIn: "2026-08-12 10:03:00", lastOut: null });
    expect(referenceDay(punched("11:45:00"))).toMatchObject({ lateInMinutes: null, flags: ["MISSING_PUNCH"] });
    expect(referenceDay(punched())).toMatchObject({ status: "A", lopDays: 1, flags: [], punchCount: 0, firstIn: null });
  });

  it("duplicates seconds apart count once (the sample's user 113: 10:00:00 and 10:00:03, 19:02:25 and 19:02:28)", () => {
    expect(referenceDay(punched("10:00:00", "10:00:03", "19:02:25", "19:02:28"))).toMatchObject({ status: "P", punchCount: 2, collapsedPunches: 2, lastOut: "2026-08-12 19:02:25" });
    // exactly the 120 s window apart is the same punch; 121 s apart is a separate one
    expect(referenceDay(punched("10:00:00", "10:02:00", "19:00:00"))).toMatchObject({ punchCount: 2, collapsedPunches: 1 });
    expect(referenceDay(punched("10:00:00", "10:02:01", "19:00:00"))).toMatchObject({ punchCount: 3, collapsedPunches: 0 });
  });

  it("a holiday or week-off stays H or O however much was worked, and records that they worked", () => {
    expect(referenceDay(day({ holiday: "Simulator holiday 1", punches: [t("11:00:00"), t("15:00:00")] }))).toMatchObject({ status: "H", source: "HOLIDAY", workedOnOffDay: true, flags: [], lopDays: 0, holidayName: "Simulator holiday 1", actualMinutes: 195 });
    expect(referenceDay(day({ weekOff: true }))).toMatchObject({ status: "O", source: "WEEK_OFF", workedOnOffDay: false });
    // a holiday beats a week-off
    expect(referenceDay(day({ holiday: "H", weekOff: true }))).toMatchObject({ status: "H" });
  });

  it("a night shift belongs to its START date: 21:55 to 06:05 next morning is 490 min on the premises, less the 30 min break = 460", () => {
    const r = referenceDay(day({ shift: SIM_NIGHT, punches: [t("21:55:00"), t("30:05:00")] }))!;
    expect(r).toMatchObject({ status: "P", totalMinutes: 490, breakMinutes: 30, actualMinutes: 460, lateInMinutes: 0, earlyOutMinutes: 0, flags: [] });
    expect(r.firstIn).toBe("2026-08-12 21:55:00");
    expect(r.lastOut).toBe("2026-08-13 06:05:00");
  });

  it("half-day leave: the leave half is the leave code, the other half is judged on its own (first half on PL, in 14:50 out 19:00 = 250 min)", () => {
    expect(referenceDay(day({ leave: { first: PL, second: null }, punches: [t("14:50:00"), t("19:00:00")] }))).toMatchObject({ status: "SIMPL:P", firstHalf: "SIMPL", secondHalf: "P", lopDays: 0, flags: [], lateInMinutes: 0, actualMinutes: 250, leaveTypeCode: "SIMPL" });
    // an unpaid half adds half a day of loss; absent in the other half adds another half
    expect(referenceDay(day({ leave: { first: LOP, second: null } }))).toMatchObject({ status: "SIMLOP:A", lopDays: 1 });
    // the working half still has to meet the half-day minimum: 150 min in the second half is under 240
    expect(referenceDay(day({ leave: { first: PL, second: null }, punches: [t("15:00:00"), t("17:30:00")] }))).toMatchObject({ status: "SIMPL:A", flags: expect.arrayContaining(["HALF_DAY_MIN_NOT_MET"]) });
  });

  it("full-day leave is the code (and a day's loss only if unpaid); a split of two codes is joined", () => {
    expect(referenceDay(day({ leave: { first: PL, second: PL } }))).toMatchObject({ status: "SIMPL", lopDays: 0, source: "LEAVE" });
    expect(referenceDay(day({ leave: { first: LOP, second: LOP } }))).toMatchObject({ status: "SIMLOP", lopDays: 1 });
    expect(referenceDay(day({ leave: { first: PL, second: LOP } }))).toMatchObject({ status: "SIMPL:SIMLOP", lopDays: 0.5 });
  });

  it("manual capture: nothing entered is NM (never absent, no loss); a timed entry follows the punch rules (10:45 in = 35 min late)", () => {
    expect(referenceDay(day({ capture: "MANUAL" }))).toMatchObject({ status: "NM", firstHalf: "NM", secondHalf: "NM", lopDays: 0, flags: [], source: "MANUAL" });
    expect(referenceDay(day({ capture: "MANUAL", manual: { kind: "TIMED", inTime: "10:45", outTime: "19:00" } }))).toMatchObject({ status: "P", lateInMinutes: 35, flags: ["LATE_IN"], actualMinutes: 450, punchCount: 2 });
    expect(referenceDay(day({ capture: "MANUAL", manual: { kind: "TIMED", inTime: "10:05", outTime: null } }))).toMatchObject({ status: "A", flags: ["MISSING_PUNCH"], punchCount: 1 });
    expect(referenceDay(day({ capture: "MANUAL", manual: { kind: "STATUS_ONLY", status: "HD_FIRST" } }))).toMatchObject({ status: "P:A", lopDays: 0.5 });
    expect(referenceDay(day({ capture: "MANUAL", manual: { kind: "STATUS_ONLY", status: "A" } }))).toMatchObject({ status: "A", lopDays: 1 });
  });

  it("not employed: no record at all", () => {
    expect(referenceDay(day({ employed: false, punches: [t("10:00:00"), t("19:00:00")] }))).toBeNull();
  });

  it("a punch that arrived flagged is left out and the day carries CLOCK_FLAGGED (a normal day plus one stray stays a normal day)", () => {
    expect(referenceDay(day({ punches: [t("10:00:00"), t("19:00:00")], flaggedExcluded: 1 }))).toMatchObject({ status: "P", flags: ["CLOCK_FLAGGED"], punchCount: 2 });
    // every punch flagged: nothing counted, absent
    expect(referenceDay(day({ punches: [], flaggedExcluded: 2 }))).toMatchObject({ status: "A", lopDays: 1, flags: ["CLOCK_FLAGGED"], punchCount: 0 });
  });
});
