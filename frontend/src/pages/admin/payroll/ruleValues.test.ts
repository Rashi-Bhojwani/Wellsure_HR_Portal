import { describe, expect, it } from "vitest";
import { formatRuleValue, initialInputState, toSubmitValue } from "./ruleValues";

// What the Rules screen shows and what it sends. The server validates everything again; these keep the screen honest.
describe("rule values on the Rules screen", () => {
  it("shows each shape plainly", () => {
    expect(formatRuleValue({ kind: "percent" }, "12")).toBe("12%");
    expect(formatRuleValue({ kind: "money" }, "15000")).toBe("₹15,000");
    expect(formatRuleValue({ kind: "money" }, "1500000")).toBe("₹15,00,000"); // Indian grouping
    expect(formatRuleValue({ kind: "boolean" }, true)).toBe("Yes");
    expect(formatRuleValue({ kind: "rounding" }, { mode: "UP", scale: 0 })).toBe("Always up (to the next higher), to 0 decimal places");
    expect(formatRuleValue({ kind: "rounding" }, { mode: "NONE", scale: 0 })).toBe("No rounding");
    expect(formatRuleValue({ kind: "paymentDate" }, { monthOffset: 1, day: "LAST" })).toBe("Last day of the next month");
    expect(formatRuleValue({ kind: "employmentTypes" }, ["PERMANENT", "CONTRACT"])).toBe("Permanent, Contract");
    expect(formatRuleValue({ kind: "money" }, null)).toBe("Not set");
  });

  it("starts the Confirm retype box BLANK, never filled in with the value", () => {
    const shapes = [{ kind: "percent" }, { kind: "money" }, { kind: "rounding" }, { kind: "json", example: "{}" }] as const;
    for (const s of shapes) {
      const blank = initialInputState(s, s.kind === "rounding" ? { mode: "UP", scale: 0 } : "12", true);
      expect(toSubmitValue(s, blank).ok, s.kind).toBe(false);
    }
    expect(initialInputState({ kind: "percent" }, "12", false)).toBe("12"); // editing starts from the current value
  });

  it("turns what was typed into the value to send, and says what is missing", () => {
    expect(toSubmitValue({ kind: "percent" }, " 12.5 ")).toEqual({ ok: true, value: "12.5" });
    expect(toSubmitValue({ kind: "percent" }, "")).toMatchObject({ ok: false });
    expect(toSubmitValue({ kind: "integer", min: 1, max: 31 }, null)).toMatchObject({ ok: false });
    expect(toSubmitValue({ kind: "boolean" }, null)).toMatchObject({ ok: false, problem: "Choose Yes or No." });
    expect(toSubmitValue({ kind: "rounding" }, { mode: "", scale: 0 })).toMatchObject({ ok: false });
    expect(toSubmitValue({ kind: "json", example: "{}" }, '{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(toSubmitValue({ kind: "json", example: "{}" }, "{oops")).toMatchObject({ ok: false });
    expect(toSubmitValue({ kind: "employmentTypes" }, [])).toMatchObject({ ok: false });
  });
});
