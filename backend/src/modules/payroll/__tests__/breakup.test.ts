import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BreakupError, annualView, computeBreakup, type RoundingRule } from "../salary/breakup";
import { InvalidSalaryValueError, parseComponentValue, parseItemCode, parseStructureValue, type ComponentValue, type StructureValue } from "../salary/schemas";
import { dec, sum } from "../money";

// The breakup of a salary: from an annual CTC and a structure to the frozen monthly lines. Pure, so every case is exact.

const comp = (over: Partial<ComponentValue> = {}): ComponentValue => ({ name: "x", type: "EARNING", taxable: true, pfApplicable: false, esiApplicable: false, prorates: true, payslipLabel: "x", payslipOrder: 1, ...over });
const pin = (code: string, over: Partial<ComponentValue> = {}) => ({ component: code, componentVersion: 1, componentHash: `hash-for-${code}`, ...over });
const components = (...entries: Array<[string, Partial<ComponentValue>?]>) => new Map(entries.map(([c, o]) => [c, { version: 1, value: comp(o) }]));
const whole: RoundingRule = { mode: "HALF_UP", scale: 0 };

const standard: StructureValue = {
  name: "Standard",
  description: "",
  ctcIncludes: ["EARNING"],
  lines: [
    { ...pin("BASIC"), calc: { method: "PERCENT", of: "CTC", percent: "40" } },
    { ...pin("HRA"), calc: { method: "PERCENT", of: "BASIC", percent: "50" } },
    { ...pin("CONV"), calc: { method: "FIXED_AMOUNT", amount: "1600" } },
    { ...pin("SPECIAL"), calc: { method: "BALANCE" } },
  ],
};
const stdComponents = components(["BASIC"], ["HRA"], ["CONV"], ["SPECIAL"]);
const amountsOf = (b: ReturnType<typeof computeBreakup>) => Object.fromEntries(b.lines.map((l) => [l.component, l.amount.toString()]));

describe("computeBreakup", () => {
  it("splits CTC by percentage, fixed amount and balance, and the lines add up to monthly CTC exactly", () => {
    const b = computeBreakup({ annualCtc: dec("1200000"), structure: standard, components: stdComponents, rounding: whole });
    expect(b.monthlyCtc.toString()).toBe("100000");
    expect(amountsOf(b)).toEqual({ BASIC: "40000", HRA: "20000", CONV: "1600", SPECIAL: "38400" });
    expect(sum(b.lines.map((l) => l.amount)).equals(b.monthlyCtc)).toBe(true);
  });

  it("rounds monthly CTC and each line by the rule, later lines see earlier lines as rounded, and the balance absorbs the difference", () => {
    // 1,000,000 / 12 = 83,333.33...; whole rupees: 83,333. Basic 40% = 33,333.2 -> 33,333. HRA 50% of the ROUNDED basic = 16,666.5 -> 16,667 (half up).
    const b = computeBreakup({ annualCtc: dec("1000000"), structure: standard, components: stdComponents, rounding: whole });
    expect(b.monthlyCtc.toString()).toBe("83333");
    expect(amountsOf(b)).toEqual({ BASIC: "33333", HRA: "16667", CONV: "1600", SPECIAL: "31733" });
    expect(sum(b.lines.map((l) => l.amount)).toString()).toBe("83333");
    // The same CTC to the paisa.
    const p = computeBreakup({ annualCtc: dec("1000000"), structure: standard, components: stdComponents, rounding: { mode: "HALF_UP", scale: 2 } });
    expect(p.monthlyCtc.toString()).toBe("83333.33");
    expect(amountsOf(p).BASIC).toBe("33333.33");
    expect(sum(p.lines.map((l) => l.amount)).toString()).toBe("83333.33");
  });

  it("does not round an amount a person typed (a fixed amount, or a per-person amount)", () => {
    const s: StructureValue = { ...standard, lines: [...standard.lines.slice(0, 2), { ...pin("NEGOTIATED"), calc: { method: "PER_PERSON" } }, standard.lines[3]!] };
    const b = computeBreakup({ annualCtc: dec("1200000"), structure: s, components: components(["BASIC"], ["HRA"], ["NEGOTIATED"], ["SPECIAL"]), perPerson: { NEGOTIATED: dec("1234.56") }, rounding: whole });
    expect(amountsOf(b).NEGOTIATED).toBe("1234.56");
    expect(amountsOf(b).SPECIAL).toBe("38765.44"); // the balance carries the paise
  });

  it("evaluates a formula over CTC and earlier lines, rounded by the rule", () => {
    const s: StructureValue = {
      ...standard,
      lines: [standard.lines[0]!, { ...pin("CAPPED"), calc: { method: "FORMULA", formula: "MIN(BASIC * 0.5, 15000)" } }, { ...pin("SPECIAL"), calc: { method: "BALANCE" } }],
    };
    const b = computeBreakup({ annualCtc: dec("1200000"), structure: s, components: components(["BASIC"], ["CAPPED"], ["SPECIAL"]), rounding: whole });
    expect(amountsOf(b)).toEqual({ BASIC: "40000", CAPPED: "15000", SPECIAL: "45000" });
  });

  it("only counts the kinds ctcIncludes names toward CTC: a deduction line does not eat into the balance", () => {
    const s: StructureValue = {
      ...standard,
      lines: [standard.lines[0]!, { ...pin("CANTEEN"), calc: { method: "FIXED_AMOUNT", amount: "500" } }, { ...pin("SPECIAL"), calc: { method: "BALANCE" } }],
    };
    const b = computeBreakup({ annualCtc: dec("1200000"), structure: s, components: components(["BASIC"], ["CANTEEN", { type: "DEDUCTION" }], ["SPECIAL"]), rounding: whole });
    expect(amountsOf(b)).toEqual({ BASIC: "40000", CANTEEN: "500", SPECIAL: "60000" });
    const withEmployer = computeBreakup({ annualCtc: dec("1200000"), structure: { ...s, ctcIncludes: ["EARNING", "EMPLOYER_CONTRIBUTION"] }, components: components(["BASIC"], ["CANTEEN", { type: "EMPLOYER_CONTRIBUTION" }], ["SPECIAL"]), rounding: whole });
    expect(amountsOf(withEmployer).SPECIAL).toBe("59500");
  });

  it("refuses, and says by how much, when the balance would be negative", () => {
    const s: StructureValue = { ...standard, lines: [standard.lines[0]!, { ...pin("HUGE"), calc: { method: "FIXED_AMOUNT", amount: "70000" } }, { ...pin("SPECIAL"), calc: { method: "BALANCE" } }] };
    const run = () => computeBreakup({ annualCtc: dec("1200000"), structure: s, components: components(["BASIC"], ["HUGE"], ["SPECIAL"]), rounding: whole });
    expect(run).toThrow(BreakupError);
    expect(run).toThrow(/10000 more than the monthly CTC of 100000/);
    try {
      run();
    } catch (e) {
      expect((e as BreakupError).code).toBe("BALANCE_NEGATIVE");
    }
  });

  it("a structure with no balance line must add up on its own, and is refused with the difference if not", () => {
    const s: StructureValue = { ...standard, lines: [standard.lines[0]!, { ...pin("HRA"), calc: { method: "PERCENT", of: "CTC", percent: "50" } }] };
    expect(() => computeBreakup({ annualCtc: dec("1200000"), structure: s, components: components(["BASIC"], ["HRA"]), rounding: whole })).toThrow(/10000 less than the monthly CTC of 100000/);
    const ok: StructureValue = { ...s, lines: [standard.lines[0]!, { ...pin("HRA"), calc: { method: "PERCENT", of: "CTC", percent: "60" } }] };
    expect(computeBreakup({ annualCtc: dec("1200000"), structure: ok, components: components(["BASIC"], ["HRA"]), rounding: whole }).lines).toHaveLength(2);
  });

  it("asks for every per-person amount that is missing, by name", () => {
    const s: StructureValue = { ...standard, lines: [{ ...pin("AA"), calc: { method: "PER_PERSON" } }, { ...pin("BB"), calc: { method: "PER_PERSON" } }, { ...pin("SPECIAL"), calc: { method: "BALANCE" } }] };
    try {
      computeBreakup({ annualCtc: dec("1200000"), structure: s, components: components(["AA"], ["BB"], ["SPECIAL"]), rounding: whole });
      expect.unreachable();
    } catch (e) {
      expect((e as BreakupError).code).toBe("PER_PERSON_MISSING");
      expect((e as BreakupError).message).toMatch(/AA, BB/);
    }
  });

  it("will not break a CTC up under 'no rounding', because a twelfth of a year is not a finite number", () => {
    expect(() => computeBreakup({ annualCtc: dec("1000000"), structure: standard, components: stdComponents, rounding: { mode: "NONE", scale: 0 } })).toThrow(/not a finite number/);
  });

  it("a formula that goes negative or divides by zero is refused, not stored", () => {
    const s = (formula: string): StructureValue => ({ ...standard, lines: [standard.lines[0]!, { ...pin("FF"), calc: { method: "FORMULA", formula } }, { ...pin("SPECIAL"), calc: { method: "BALANCE" } }] });
    expect(() => computeBreakup({ annualCtc: dec("1200000"), structure: s("BASIC - 50000"), components: components(["BASIC"], ["FF"], ["SPECIAL"]), rounding: whole })).toThrow(/negative/);
    expect(() => computeBreakup({ annualCtc: dec("1200000"), structure: s("BASIC / (CTC - CTC)"), components: components(["BASIC"], ["FF"], ["SPECIAL"]), rounding: whole })).toThrow(/divides by zero/);
  });

  it("property: with a balance line, the lines always add up to monthly CTC, to the cent, for any CTC and rounding", () => {
    const modes = ["HALF_UP", "HALF_EVEN", "UP", "DOWN", "CEIL", "FLOOR"] as const;
    fc.assert(
      fc.property(fc.integer({ min: 120_000, max: 90_000_000 }), fc.integer({ min: 0, max: 99 }), fc.constantFrom(...modes), fc.integer({ min: 0, max: 2 }), (rupees, paise, mode, scale) => {
        const annual = dec(`${rupees}.${String(paise).padStart(2, "0")}`);
        const b = computeBreakup({ annualCtc: annual, structure: standard, components: stdComponents, rounding: { mode, scale } });
        expect(sum(b.lines.map((l) => l.amount)).equals(b.monthlyCtc)).toBe(true);
        expect(b.lines.every((l) => !l.amount.isNegative())).toBe(true);
        // Same input, same output: a breakup is a pure function of its inputs.
        const again = computeBreakup({ annualCtc: annual, structure: standard, components: stdComponents, rounding: { mode, scale } });
        expect(amountsOf(again)).toEqual(amountsOf(b));
      }),
      { numRuns: 150 },
    );
  });
});

describe("component and structure values", () => {
  it("accepts a component and refuses an unknown field, a missing label, and reserved codes", () => {
    expect(parseComponentValue(comp({ name: "Basic", payslipLabel: "Basic" })).name).toBe("Basic");
    expect(() => parseComponentValue({ ...comp(), extra: 1 })).toThrow(InvalidSalaryValueError);
    expect(() => parseComponentValue(comp({ payslipLabel: "" }))).toThrow(/payslip/i);
    for (const reserved of ["PF_EMPLOYEE", "ESI_EMPLOYER", "PT", "LWF", "TDS", "ARREARS", "CTC"]) expect(() => parseItemCode(reserved), reserved).toThrow(/reserved/);
    expect(() => parseItemCode("basic")).toThrow(/capital letters/);
    expect(parseItemCode("SPECIAL_ALLOWANCE")).toBe("SPECIAL_ALLOWANCE");
  });

  const typeOf = () => undefined;
  const bad = (lines: StructureValue["lines"], over: Partial<StructureValue> = {}) => () => parseStructureValue({ ...standard, lines, ...over }, typeOf);

  it("a line may refer only to CTC or a line above it", () => {
    expect(bad([{ ...pin("HRA"), calc: { method: "PERCENT", of: "BASIC", percent: "50" } }, { ...pin("BASIC"), calc: { method: "PERCENT", of: "CTC", percent: "40" } }])).toThrow(/neither/);
    expect(bad([{ ...pin("FF"), calc: { method: "FORMULA", formula: "LATER * 2" } }, { ...pin("LATER"), calc: { method: "FIXED_AMOUNT", amount: "1" } }])).toThrow(/neither CTC nor a line above/);
    expect(() => parseStructureValue(standard, typeOf)).not.toThrow();
  });

  it("at most one balance line, and nothing may be worked out from it", () => {
    const two = [{ ...pin("AA"), calc: { method: "BALANCE" as const } }, { ...pin("BB"), calc: { method: "BALANCE" as const } }];
    expect(bad(two)).toThrow(/only one line can be the balance/);
    const fromBalance = [{ ...pin("SPECIAL"), calc: { method: "BALANCE" as const } }, { ...pin("XX"), calc: { method: "PERCENT" as const, of: "SPECIAL", percent: "10" } }];
    expect(bad(fromBalance)).toThrow(/nothing can be worked out from the balance/);
  });

  it("the same component twice, a formula that does not parse, unknown names and a balance of a kind that is not in CTC are all refused with the reason", () => {
    expect(bad([{ ...pin("AA"), calc: { method: "FIXED_AMOUNT", amount: "1" } }, { ...pin("AA"), calc: { method: "FIXED_AMOUNT", amount: "2" } }])).toThrow(/already in the structure/);
    expect(bad([{ ...pin("AA"), calc: { method: "FORMULA", formula: "CTC +" } }])).toThrow(/line 1/);
    expect(bad([{ ...pin("AA"), calc: { method: "FORMULA", formula: "BONUS * 2" } }])).toThrow(/neither CTC nor a line above/);
    expect(() => parseStructureValue({ ...standard, lines: [{ ...pin("SS"), calc: { method: "BALANCE" } }] }, () => "DEDUCTION")).toThrow(/counts toward CTC/);
    expect(bad([], {})).toThrow(/at least one line/);
    expect(bad(standard.lines, { ctcIncludes: [] })).toThrow(/count toward CTC/);
    expect(bad(standard.lines, { ctcIncludes: ["EARNING", "EARNING"] })).toThrow(/each kind once/);
  });

  it("canonicalises decimals so the same value always has the same hash", () => {
    const v = parseStructureValue({ ...standard, lines: [{ ...pin("AA"), calc: { method: "PERCENT", of: "CTC", percent: "40.00" } }, { ...pin("BB"), calc: { method: "FIXED_AMOUNT", amount: "1600.0" } }] }, typeOf);
    expect(v.lines[0]!.calc).toMatchObject({ percent: "40" });
    expect(v.lines[1]!.calc).toMatchObject({ amount: "1600" });
  });
});

describe("annualView: the monthly figure and the yearly total side by side", () => {
  it("a CTC that divides evenly shows twelve months equal to the year", () => {
    const b = computeBreakup({ annualCtc: dec("1200000"), structure: standard, components: stdComponents, rounding: whole });
    const a = annualView(b, dec("1200000"), standard.ctcIncludes);
    expect(a.lines.map((l) => [l.component, l.annual])).toEqual([["BASIC", "480000"], ["HRA", "240000"], ["CONV", "19200"], ["SPECIAL", "460800"]]);
    expect([a.annualCtc, a.total, a.difference]).toEqual(["1200000", "1200000", "0"]);
  });

  it("a CTC that does not divide by twelve shows the few paise the rounding moves, named as a difference rather than hidden", () => {
    // 1,000,000 / 12 = 83,333.33...: twelve months of 83,333 come to 999,996, which is 4 less than the yearly CTC.
    const b = computeBreakup({ annualCtc: dec("1000000"), structure: standard, components: stdComponents, rounding: whole });
    const a = annualView(b, dec("1000000"), standard.ctcIncludes);
    expect([a.total, a.difference]).toEqual(["999996", "-4"]);
    const paise = computeBreakup({ annualCtc: dec("1000000"), structure: standard, components: stdComponents, rounding: { mode: "HALF_UP", scale: 2 } });
    expect(annualView(paise, dec("1000000"), standard.ctcIncludes).difference).toBe("-0.04");
  });

  it("counts only the kinds of line the structure says count toward CTC", () => {
    const withDeduction: StructureValue = { ...standard, lines: [...standard.lines, { ...pin("RECOVERY", { type: "DEDUCTION" }), calc: { method: "FIXED_AMOUNT", amount: "500" } }] };
    const b = computeBreakup({ annualCtc: dec("1200000"), structure: withDeduction, components: components(["BASIC"], ["HRA"], ["CONV"], ["SPECIAL"], ["RECOVERY", { type: "DEDUCTION" }]), rounding: whole });
    const a = annualView(b, dec("1200000"), withDeduction.ctcIncludes);
    expect(a.lines.find((l) => l.component === "RECOVERY")!.annual).toBe("6000"); // shown over the year...
    expect(a.total).toBe("1200000"); // ...but not part of the CTC total
  });
});

describe("per-head rounding in a breakup", () => {
  it("a head listed in 'Rounding of particular heads' is rounded by its own rule; the others, and monthly CTC, by the general one", () => {
    // 1,000,000 a year: monthly 83,333 (half up). Basic 40% = 33,333.2; HRA 50% of the rounded basic = 16,666.5.
    const general = computeBreakup({ annualCtc: dec("1000000"), structure: standard, components: stdComponents, rounding: whole });
    const own = computeBreakup({ annualCtc: dec("1000000"), structure: standard, components: stdComponents, rounding: { ...whole, perHead: { HRA: { mode: "DOWN", scale: 0 } } } });
    expect(amountsOf(general).HRA).toBe("16667");
    expect(amountsOf(own).HRA).toBe("16666");
    expect(own.monthlyCtc.toString()).toBe("83333");
    expect(amountsOf(own).BASIC).toBe(amountsOf(general).BASIC);
    expect(sum(own.lines.map((l) => l.amount)).equals(own.monthlyCtc)).toBe(true); // the balance absorbs the difference
  });
});
