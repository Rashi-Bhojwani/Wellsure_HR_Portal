import { describe, expect, it } from "vitest";
import { RULE_CATALOG } from "@shared/constants/payrollRules";
import { RuleContext } from "../rules/context";
import { InvalidRuleValueError, parseRuleValue } from "../rules/schemas";
import { loadRunRules, missingRulesFor, RulesMissingError } from "../run/rules";
import { COMPANY_RULES } from "./runTestHelpers";

// Stage 3.2: every salary rule is Not set until a director enters it, the new rules validate, and a run refuses to start while a rule it needs is Not set,
// naming each one. The values below are made up for the tests; the product ships none.

const FULL: Record<string, unknown> = { ...COMPANY_RULES };
const without = (...keys: string[]) => Object.fromEntries(Object.entries(FULL).filter(([k]) => !keys.includes(k)));
const missing = (values: Record<string, unknown>, needs = { arrears: false, encashment: false, reversals: false }) => missingRulesFor(RuleContext.fromValuesForTests(values), needs).map((m) => m.key);

describe("the salary rules ship empty", () => {
  it("the catalog carries no value for any rule", () => {
    expect(RULE_CATALOG.filter((r) => r.placeholder !== undefined)).toEqual([]);
  });

  it("with nothing entered, a run is refused and every required statutory figure is named", () => {
    const keys = missing({});
    for (const k of ["PF_EMPLOYEE_RATE", "PF_EPS_RATE", "PF_EPF_ER_RATE", "PF_EDLI_RATE", "PF_ADMIN_RATE", "PF_WAGE_CEILING", "ESI_EMPLOYEE_RATE", "ESI_EMPLOYER_RATE", "ESI_WAGE_CEILING", "PF_ROUNDING", "ESI_ROUNDING", "PAY_DAYS_BASIS", "LINE_ROUNDING"]) expect(keys, k).toContain(k);
    expect(() => loadRunRules(RuleContext.fromValuesForTests({}), { arrears: false, encashment: false })).toThrow(RulesMissingError);
  });

  it("each required rule, taken away from an otherwise complete set, is what stops the run", () => {
    expect(missing(FULL)).toEqual([]);
    const required = ["PF_EMPLOYEE_RATE", "PF_EPS_RATE", "PF_EPF_ER_RATE", "PF_EDLI_RATE", "PF_ADMIN_RATE", "PF_WAGE_CEILING", "ESI_EMPLOYEE_RATE", "ESI_EMPLOYER_RATE", "ESI_WAGE_CEILING", "PF_ROUNDING", "ESI_ROUNDING", "LINE_ROUNDING", "PAY_DAYS_BASIS"];
    for (const key of required) expect(missing(without(key)), key).toEqual([key]);
  });
});

describe("arrear-on-arrear, the loss-of-pay look-back and its override, per-head rounding", () => {
  it("are company rules with no value shipped, and not required unless the run needs them", () => {
    for (const key of ["ARREAR_ON_ARREAR", "LOP_REVERSAL_LOOKBACK_MONTHS", "LOP_REVERSAL_OVERRIDE_ALLOWED", "HEAD_ROUNDING"]) {
      const def = RULE_CATALOG.find((r) => r.key === key)!;
      expect(def.origin, key).toBe("COMPANY");
      expect(def.placeholder, key).toBeUndefined();
    }
    expect(missing(without("ARREAR_ON_ARREAR", "LOP_REVERSAL_LOOKBACK_MONTHS", "LOP_REVERSAL_OVERRIDE_ALLOWED"))).toEqual([]);
  });

  it("a run that pays arrears is refused while arrear-on-arrear is Not set; one that pays loss of pay back, while the look-back or the override is", () => {
    expect(missing(without("ARREAR_ON_ARREAR"), { arrears: true, encashment: false, reversals: false })).toContain("ARREAR_ON_ARREAR");
    expect(missing(FULL, { arrears: true, encashment: false, reversals: false })).not.toContain("ARREAR_ON_ARREAR");
    const needs = { arrears: false, encashment: false, reversals: true };
    expect(missing(without("LOP_REVERSAL_LOOKBACK_MONTHS"), needs)).toEqual(["LOP_REVERSAL_LOOKBACK_MONTHS"]);
    expect(missing(without("LOP_REVERSAL_OVERRIDE_ALLOWED"), needs)).toEqual(["LOP_REVERSAL_OVERRIDE_ALLOWED"]);
    expect(missing(FULL, needs)).toEqual([]);
  });

  it("their values are checked", () => {
    expect(parseRuleValue("LOP_REVERSAL_LOOKBACK_MONTHS", 0)).toBe(0);
    expect(parseRuleValue("LOP_REVERSAL_LOOKBACK_MONTHS", 6)).toBe(6);
    for (const bad of [-1, 37, 1.5, "3"]) expect(() => parseRuleValue("LOP_REVERSAL_LOOKBACK_MONTHS", bad), String(bad)).toThrow(InvalidRuleValueError);
    expect(() => parseRuleValue("ARREAR_ON_ARREAR", "yes")).toThrow(InvalidRuleValueError);
    expect(parseRuleValue("HEAD_ROUNDING", { BASIC: { mode: "DOWN", scale: 0 } })).toEqual({ BASIC: { mode: "DOWN", scale: 0 } });
    expect(() => parseRuleValue("HEAD_ROUNDING", { basic: { mode: "DOWN", scale: 0 } })).toThrow(InvalidRuleValueError);
    expect(() => parseRuleValue("HEAD_ROUNDING", { BASIC: { mode: "NONE", scale: 0 } })).toThrow(InvalidRuleValueError);
    expect(() => parseRuleValue("HEAD_ROUNDING", { BASIC: { mode: "SOMETIMES", scale: 0 } })).toThrow(InvalidRuleValueError);
  });

  it("per-head rounding is optional: with nothing set it pins nothing and the run is not turned into a test", () => {
    const ctx = RuleContext.fromValuesForTests(FULL);
    const rules = loadRunRules(ctx, { arrears: false, encashment: false });
    expect(rules.headRounding).toEqual({});
    expect(ctx.pins().map((p) => p.key)).not.toContain("HEAD_ROUNDING");
  });

  it("per-head rounding, once set, is read and pinned", () => {
    const ctx = RuleContext.fromValuesForTests({ ...FULL, HEAD_ROUNDING: { BASIC: { mode: "DOWN", scale: 0 } } });
    expect(loadRunRules(ctx, { arrears: false, encashment: false }).headRounding).toEqual({ BASIC: { mode: "DOWN", scale: 0 } });
    expect(ctx.pins().map((p) => p.key)).toContain("HEAD_ROUNDING");
  });
});
