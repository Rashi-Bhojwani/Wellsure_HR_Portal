import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { dayStateOf, hoursText, minutesBetween, outcomeFor, reminderDue, remoteOn, timeOnly, whoMayDecide, type Decision } from "../remote/rules";

// Stage 5a: the pure rules of remote attendance. No database.

describe("the outcome mapping: a director's decision becomes what attendance records", () => {
  it("a full day is present; a half day is present for the half named; a rejection is absent", () => {
    expect(outcomeFor({ kind: "FULL" }).status).toBe("P");
    expect(outcomeFor({ kind: "HALF", half: "FIRST", reason: "worked the first half" }).status).toBe("HD_FIRST");
    expect(outcomeFor({ kind: "HALF", half: "SECOND", reason: "worked the second half" }).status).toBe("HD_SECOND");
    expect(outcomeFor({ kind: "REJECT", reason: "no work shown", outcome: "ABSENT" }).status).toBe("A");
    expect(outcomeFor({ kind: "REJECT", reason: "no work shown", outcome: "LOSS_OF_PAY" }).status).toBe("A");
  });
  it("the label says which was chosen, so the muster note and the audit never lose the choice", () => {
    expect(outcomeFor({ kind: "REJECT", reason: "x y z", outcome: "ABSENT" }).label).toMatch(/absent/);
    expect(outcomeFor({ kind: "REJECT", reason: "x y z", outcome: "LOSS_OF_PAY" }).label).toMatch(/loss of pay/);
    expect(outcomeFor({ kind: "HALF", half: "SECOND", reason: "worked the second half" }).label).toMatch(/second half/);
  });
  it("every decision maps to one of the four engine statuses, and only an approval is ever present (property)", () => {
    const decision: fc.Arbitrary<Decision> = fc.oneof(
      fc.constant<Decision>({ kind: "FULL" }),
      fc.constantFrom("FIRST" as const, "SECOND" as const).map((half): Decision => ({ kind: "HALF", half, reason: "a reason" })),
      fc.tuple(fc.string({ minLength: 3 }), fc.constantFrom("ABSENT" as const, "LOSS_OF_PAY" as const)).map(([reason, outcome]): Decision => ({ kind: "REJECT", reason, outcome })),
    );
    fc.assert(fc.property(decision, (d) => {
      const s = outcomeFor(d).status;
      return ["P", "HD_FIRST", "HD_SECOND", "A"].includes(s) && (d.kind === "REJECT") === (s === "A");
    }));
  });
});

describe("who may decide", () => {
  it("only a director, and never their own record", () => {
    expect(whoMayDecide({ actorUserId: "d1", ownerUserId: "e1", actorIsDirector: true })).toEqual({ ok: true });
    expect(whoMayDecide({ actorUserId: "h1", ownerUserId: "e1", actorIsDirector: false })).toMatchObject({ ok: false, code: "NOT_A_DIRECTOR" });
    expect(whoMayDecide({ actorUserId: "d1", ownerUserId: "d1", actorIsDirector: true })).toMatchObject({ ok: false, code: "OWN_RECORD" });
    expect(whoMayDecide({ actorUserId: "d1", ownerUserId: null, actorIsDirector: true })).toEqual({ ok: true });
  });
});

describe("who is remote on a day", () => {
  const m = (effectiveFrom: string, remote: boolean, createdAt = "2026-01-01T00:00:00Z") => ({ effectiveFrom, remote, createdAt });
  it("nobody is remote by default", () => expect(remoteOn([], "2026-09-30")).toBe(false));
  it("from the date a mark is effective, until a later mark says otherwise", () => {
    const marks = [m("2026-09-10", true), m("2026-09-20", false)];
    expect([remoteOn(marks, "2026-09-09"), remoteOn(marks, "2026-09-10"), remoteOn(marks, "2026-09-19"), remoteOn(marks, "2026-09-20")]).toEqual([false, true, true, false]);
  });
  it("on the same date the later-written mark wins, whatever order they arrive in", () => {
    const a = m("2026-09-10", true, "2026-09-01T00:00:00Z");
    const b = m("2026-09-10", false, "2026-09-02T00:00:00Z");
    expect(remoteOn([a, b], "2026-09-10")).toBe(false);
    expect(remoteOn([b, a], "2026-09-10")).toBe(false);
  });
  it("a mark in the future changes nothing today", () => expect(remoteOn([m("2026-10-05", true)], "2026-10-01")).toBe(false));
});

describe("time only", () => {
  it("shows the time of day in Asia/Kolkata and nothing else", () => {
    expect(timeOnly(new Date("2026-09-30T04:05:00Z"))).toBe("09:35");
    expect(timeOnly(new Date("2026-09-30T18:30:00Z"))).toBe("00:00");
    expect(timeOnly(new Date("2026-09-30T04:05:00Z"))).toMatch(/^\d{2}:\d{2}$/);
  });
  it("counts whole minutes", () => expect(minutesBetween(new Date("2026-09-30T04:00:00Z"), new Date("2026-09-30T04:00:59Z"))).toBe(0));
});

describe("the reminder threshold", () => {
  const since = new Date("2026-09-30T10:00:00Z");
  it("with the threshold Not set, nothing is ever due", () => expect(reminderDue(since, new Date("2027-01-01T00:00:00Z"), null, null)).toBe(false));
  it("is due once the record has waited that many hours, and only once", () => {
    expect(reminderDue(since, new Date("2026-09-30T11:59:00Z"), 2, null)).toBe(false);
    expect(reminderDue(since, new Date("2026-09-30T12:00:00Z"), 2, null)).toBe(true);
    expect(reminderDue(since, new Date("2026-09-30T12:00:00Z"), 2, new Date("2026-09-30T12:00:00Z"))).toBe(false);
  });
});

describe("today's state, as the person sees it", () => {
  const rec = (status: "OPEN" | "PENDING" | "APPROVED_FULL" | "APPROVED_HALF" | "REJECTED", checkOut = false) => ({ status, checkIn: true, checkOut });
  it("walks from not started to a decision", () => {
    expect(dayStateOf(null)).toBe("NOT_STARTED");
    expect(dayStateOf({ status: "OPEN", checkIn: false, checkOut: false })).toBe("NOT_STARTED");
    expect(dayStateOf(rec("OPEN"))).toBe("CHECKED_IN");
    expect(dayStateOf(rec("OPEN", true))).toBe("CHECKED_OUT");
    expect(dayStateOf(rec("PENDING", true))).toBe("PENDING_APPROVAL");
    expect(dayStateOf(rec("APPROVED_FULL", true))).toBe("APPROVED");
    expect(dayStateOf(rec("APPROVED_HALF", true))).toBe("HALF_DAY");
    expect(dayStateOf(rec("REJECTED", true))).toBe("REJECTED");
  });
  it("hours are H:MM from the two times, and nothing without both", () => {
    expect(hoursText(new Date("2026-09-30T04:00:00Z"), new Date("2026-09-30T12:45:30Z"))).toBe("8:45");
    expect(hoursText(new Date("2026-09-30T04:00:00Z"), null)).toBeNull();
    expect(hoursText(null, null)).toBeNull();
  });
});
