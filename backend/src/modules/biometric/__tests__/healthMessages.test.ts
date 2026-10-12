import { describe, expect, it } from "vitest";
import { humanDuration, openedMessage, recoveredMessage, type IncidentFacts } from "../health/messages";

const at = (hhmm: string) => new Date(`2026-10-07T${hhmm}:00+05:30`);
const facts = (over: Partial<IncidentFacts> = {}): IncidentFacts => ({ kind: "DEVICE_SILENT", subject: "C-10 entrance", branch: "Panchsheel C-10", openedAt: at("10:36"), lastContactAt: at("10:05"), details: { silentMinutes: 31 }, ...over });

describe("the words of the device alerts", () => {
  it("durations read like a person would say them", () => {
    expect(humanDuration(35 * 60_000)).toBe("35 min");
    expect(humanDuration(60 * 60_000)).toBe("1 h");
    expect(humanDuration(250 * 60_000)).toBe("4 h 10 min");
    expect(humanDuration((2 * 24 + 3) * 3_600_000)).toBe("2 days 3 h");
  });

  it("an opened alert says what is wrong, since when, and what to do", () => {
    const m = openedMessage(facts());
    expect(m.title).toBe("C-10 entrance (Panchsheel C-10) has gone quiet");
    expect(m.body).toMatch(/31 min during working hours\. Last heard from at 10:05/);
    expect(m.body).toMatch(/check the device is on and on the network/);
  });

  it("the recovery says how long, how many punches arrived, who is still missing, and what to check", () => {
    const m = recoveredMessage(facts({ lastContactAt: at("10:42") }), at("14:52"), { arrivedPunches: 37, expectedWithoutPunch: 3, firstPunchAt: null });
    expect(m.title).toBe("C-10 entrance (Panchsheel C-10) is back after 4 h 10 min");
    expect(m.body).toContain("back online after 4 h 10 min (10:42–14:52)");
    expect(m.body).toContain("37 punches made during that time have now arrived");
    expect(m.body).toContain("3 people are expected at Panchsheel C-10 with no punch yet today: check whether anyone's attendance needs correcting");
  });

  it("is honest when nothing arrived, and singular when it is one", () => {
    expect(recoveredMessage(facts(), at("12:00"), { arrivedPunches: 0, expectedWithoutPunch: 0, firstPunchAt: null }).body).toMatch(/No punches made during that time have arrived\. If people punched meanwhile they may still be on the device, or lost if its log wrapped/);
    expect(recoveredMessage(facts(), at("12:00"), { arrivedPunches: 1, expectedWithoutPunch: 1, firstPunchAt: null }).body).toMatch(/1 punch made during that time has now arrived.*1 person is expected/);
    expect(recoveredMessage(facts(), at("12:00"), { arrivedPunches: 5, expectedWithoutPunch: 0, firstPunchAt: null }).body).toMatch(/Everyone expected today has a punch/);
  });
});
