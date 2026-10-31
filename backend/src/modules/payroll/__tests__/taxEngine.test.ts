import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { computeAnnualTax, monthlyTds, TaxValueNotSetError, type EngineInput, type Regime } from "../tax/engine";
import { missingForTds, parseTaxYearValue, type SectionDef, type TaxYearValue } from "../tax/schema";
import { financialYearOf, monthsLeftInYear, parseFinancialYearLabel } from "@shared/utils/financialYear";

// The tax engine against figures that are MADE UP for these tests (nothing here is a tax rule), by hand, and against an independent exact-fraction model.

const src = { sourceNote: "made-up figure for a test", effectiveFrom: "2026-04-01" };
const leaf = <T>(value: T) => ({ value, ...src });
const SECTIONS: SectionDef[] = [
  { code: "SEC_A", label: "Section A", appliesTo: "OLD", cap: "150000", groupCap: { group: "G1", cap: "150000" }, proofRequired: true },
  { code: "SEC_B", label: "Section B", appliesTo: "OLD", cap: "50000", groupCap: { group: "G1", cap: "150000" }, proofRequired: true },
  { code: "SEC_C", label: "Section C", appliesTo: "BOTH", cap: null, groupCap: null, proofRequired: false },
  { code: "SEC_D", label: "Section D", appliesTo: "NEW", cap: "10000", groupCap: null, proofRequired: false },
];
const year = (over: Partial<TaxYearValue> = {}): TaxYearValue =>
  parseTaxYearValue({
    NEW: { slabs: leaf([{ from: "0", to: "300000", ratePercent: "0" }, { from: "300000", to: "700000", ratePercent: "5" }, { from: "700000", to: "1000000", ratePercent: "10" }, { from: "1000000", to: null, ratePercent: "20" }]), standardDeduction: leaf("50000"), rebate: leaf({ thresholdIncome: "700000", maximum: "25000" }) },
    OLD: { slabs: leaf([{ from: "0", to: "250000", ratePercent: "0" }, { from: "250000", to: "500000", ratePercent: "5" }, { from: "500000", to: null, ratePercent: "30" }]), standardDeduction: leaf("50000"), rebate: leaf({ thresholdIncome: "500000", maximum: "12500" }) },
    surcharge: leaf([{ from: "5000000", to: null, ratePercent: "10" }]),
    cessPercent: leaf("4"),
    defaultRegime: leaf("NEW"),
    rounding: leaf({ mode: "HALF_UP", scale: 0 }),
    minimumMonthlyTds: leaf("0"),
    oneOffs: leaf("MONTH_PAID"),
    sections: leaf(SECTIONS),
    ...over,
  });
const run = (regime: Regime, taxablePay: string, deductions: EngineInput["deductions"] = [], y = year()) => computeAnnualTax({ year: y, regime, taxablePay, deductions });

describe("the financial year", () => {
  it("April to March, decided in one place", () => {
    expect(financialYearOf("2026-04-01").label).toBe("2026-27");
    expect(financialYearOf("2027-03-31")).toMatchObject({ label: "2026-27", start: "2026-04-01", end: "2027-03-31" });
    expect(financialYearOf("2027-04-01").label).toBe("2027-28");
    expect(financialYearOf("2099-12-31").label).toBe("2099-00");
    expect(() => financialYearOf("2026-4-1")).toThrow();
    expect(parseFinancialYearLabel("2026-27").start).toBe("2026-04-01");
    expect(() => parseFinancialYearLabel("2026-28")).toThrow();
  });
  it("counts the pay months left including the current one", () => {
    expect([monthsLeftInYear("2026-04-15"), monthsLeftInYear("2026-12-31"), monthsLeftInYear("2027-01-01"), monthsLeftInYear("2027-03-31")]).toEqual([12, 4, 3, 1]);
  });
});

describe("a tax year is entered, never shipped", () => {
  it("is Not set until entered: an empty year lacks everything, and each missing value is named", () => {
    expect(missingForTds(null)).toEqual(["the tax year has no values at all"]);
    const empty = parseTaxYearValue({});
    expect(missingForTds(empty)).toContain("the new regime's slabs");
    expect(missingForTds(empty)).toContain("the section catalogue");
    expect(missingForTds(year())).toEqual([]);
    expect(missingForTds(year(), ["NEW"])).toEqual([]);
  });
  it("refuses a value without its source note or its effective date, and slabs with a gap or an end", () => {
    expect(() => parseTaxYearValue({ cessPercent: { value: "4", effectiveFrom: "2026-04-01" } })).toThrow(/sourceNote/);
    expect(() => parseTaxYearValue({ cessPercent: { value: "4", sourceNote: "x", effectiveFrom: "2026-04-01" } })).toThrow(/a few words/);
    expect(() => parseTaxYearValue({ cessPercent: { value: "4", sourceNote: "from a notice", effectiveFrom: "1 April" } })).toThrow(/year-month-day/);
    const gap = { NEW: { slabs: leaf([{ from: "0", to: "100", ratePercent: "0" }, { from: "200", to: null, ratePercent: "5" }]) } };
    expect(() => parseTaxYearValue(gap)).toThrow(/must start where slab 1 ends/);
    expect(() => parseTaxYearValue({ NEW: { slabs: leaf([{ from: "0", to: "100", ratePercent: "0" }]) } })).toThrow(/no end/);
    expect(() => parseTaxYearValue({ cessPercent: leaf("101") })).toThrow(/more than 100/);
    expect(() => parseTaxYearValue({ extra: 1 })).toThrow();
  });
  it("stops, naming the value, when something needed is Not set", () => {
    const y = year();
    delete (y as { cessPercent?: unknown }).cessPercent;
    expect(() => run("NEW", "100", [], y)).toThrow(TaxValueNotSetError);
    expect(() => run("NEW", "100", [], y)).toThrow(/the cess percentage has not been entered/);
    const noOld = year({ OLD: undefined });
    expect(() => run("OLD", "100", [], noOld)).toThrow(/the old regime has not been entered/);
    expect(run("NEW", "100", [], noOld).annualTax).toBe("0");
  });
});

describe("annual tax, worked by hand on made-up figures", () => {
  it("new regime, above the rebate: slabs, then cess", () => {
    // 800000 less 50000 = 750000. Slabs: 400000 x 5% = 20000, 50000 x 10% = 5000, so 25000. No rebate (750000 is over 700000). Cess 4% = 1000. Total 26000.
    const r = run("NEW", "800000");
    expect([r.taxableIncome, r.slabTax, r.rebate, r.surcharge, r.cess, r.annualTax]).toEqual(["750000", "25000", "0", "0", "1000", "26000"]);
  });
  it("new regime, at or below the rebate threshold: the rebate cancels the tax", () => {
    expect(run("NEW", "740000")).toMatchObject({ taxableIncome: "690000", slabTax: "19500", rebate: "19500", annualTax: "0" });
    expect(run("NEW", "750000")).toMatchObject({ taxableIncome: "700000", slabTax: "20000", rebate: "20000", annualTax: "0" }); // exactly at the threshold
    expect(run("NEW", "750001")).toMatchObject({ taxableIncome: "700001", rebate: "0" }); // one rupee over: no rebate at all (marginal relief is not modelled)
  });
  it("the rebate is no more than its maximum", () => {
    const y = year({ NEW: { ...year().NEW, rebate: leaf({ thresholdIncome: "700000", maximum: "10000" }) } });
    expect(run("NEW", "740000", [], y)).toMatchObject({ slabTax: "19500", rebate: "10000", cess: "380", annualTax: "9880" });
  });
  it("surcharge on the tax after the rebate, then cess on both", () => {
    // 5100000 less 50000 = 5050000. Slabs: 20000 + 30000 + 4050000 x 20% = 810000, so 860000. Surcharge 10% = 86000. Cess 4% of 946000 = 37840. Total 983840.
    const r = run("NEW", "5100000");
    expect([r.slabTax, r.surchargeRate, r.surcharge, r.cess, r.annualTax]).toEqual(["860000", "10", "86000", "37840", "983840"]);
  });
  it("the surcharge starts exactly at its lower edge and not a rupee before", () => {
    // Income 5000000 exactly: pay 5050000 less the 50000. Slabs: 20000 + 30000 + 4000000 x 20% = 850000. Surcharge 10% = 85000. Cess 4% of 935000 = 37400. Total 972400.
    expect(run("NEW", "5050000")).toMatchObject({ taxableIncome: "5000000", surchargeRate: "10", surcharge: "85000", annualTax: "972400" });
    // One rupee less: no surcharge.
    const below = run("NEW", "5049999");
    expect([below.taxableIncome, below.surchargeRate, below.surcharge]).toEqual(["4999999", "0", "0"]);
  });
  it("between two surcharge bands the upper edge belongs to the higher band", () => {
    const y = year({ surcharge: leaf([{ from: "5000000", to: "10000000", ratePercent: "10" }, { from: "10000000", to: null, ratePercent: "15" }]) });
    expect(run("NEW", "10050000", [], y).surchargeRate).toBe("15"); // income exactly 10000000
    expect(run("NEW", "10049999", [], y).surchargeRate).toBe("10");
  });
  it("old regime: sections count to their own cap and to the cap their group shares; a section of the other regime counts for nothing", () => {
    // Pay 1000000, standard deduction 50000. SEC_A asked 200000 (own cap 150000), SEC_B asked 40000 (own cap 50000; the group has nothing left), SEC_C 30000 in full, SEC_D is new-regime only.
    const r = run("OLD", "1000000", [{ section: "SEC_A", amount: "200000" }, { section: "SEC_B", amount: "40000" }, { section: "SEC_C", amount: "30000" }, { section: "SEC_D", amount: "10000" }]);
    expect(r.sections.map((s) => [s.code, s.counted])).toEqual([["SEC_A", "150000"], ["SEC_B", "0"], ["SEC_C", "30000"], ["SEC_D", "0"]]);
    expect(r.sections[3]!.why).toMatch(/not allowed under the old regime/);
    // Income 1000000 - 50000 - 180000 = 770000. Slabs: 250000 x 5% = 12500, 270000 x 30% = 81000, so 93500. Cess 4% = 3740. Total 97240.
    expect([r.sectionsTotal, r.taxableIncome, r.slabTax, r.annualTax]).toEqual(["180000", "770000", "93500", "97240"]);
  });
  it("new regime ignores old-regime sections and caps a new-regime one", () => {
    const r = run("NEW", "800000", [{ section: "SEC_A", amount: "100000" }, { section: "SEC_D", amount: "25000" }]);
    expect(r.sections.map((s) => [s.code, s.counted])).toEqual([["SEC_A", "0"], ["SEC_D", "10000"]]);
    expect(r.taxableIncome).toBe("740000");
  });
  it("two lines of one section add up before the cap; pay below the deductions leaves no negative income", () => {
    const r = run("OLD", "100000", [{ section: "SEC_C", amount: "40000" }, { section: "SEC_C", amount: "60000" }]);
    expect([r.sections[0]!.counted, r.taxableIncome, r.annualTax]).toEqual(["100000", "0", "0"]);
  });
  it("rounds the annual tax by the year's own rule and says what it did not model", () => {
    const y = year({ rounding: leaf({ mode: "UP", scale: 0 }), cessPercent: leaf("3.5") });
    const r = run("NEW", "800000", [], y); // 25000 + 3.5% = 25875
    expect(r.annualTax).toBe("25875");
    const r2 = run("NEW", "800010", [], y); // slab tax 25001, cess 875.035, total 25876.035 rounded up
    expect([r2.beforeRounding, r2.annualTax]).toEqual(["25876.035", "25877"]);
    expect(r2.notModelled).toEqual(["marginal relief on the rebate", "marginal relief on the surcharge"]);
  });
});

describe("a month's TDS", () => {
  const y = year({ rounding: leaf({ mode: "HALF_UP", scale: 0 }), minimumMonthlyTds: leaf("100") });
  it("spreads what is left over the months left, rounded by the rule", () => {
    expect(monthlyTds({ year: y, annualTax: "26000", deductedSoFar: "0", monthsLeft: 12 })).toMatchObject({ remaining: "26000", share: "2167", tds: "2167" });
    expect(monthlyTds({ year: y, annualTax: "26000", deductedSoFar: "21667", monthsLeft: 2 })).toMatchObject({ remaining: "4333", share: "2167", tds: "2167" });
  });
  it("is never below the minimum, never more than what is left, and never negative", () => {
    expect(monthlyTds({ year: y, annualTax: "600", deductedSoFar: "0", monthsLeft: 12 }).tds).toBe("100"); // the share is 50; the minimum is 100
    expect(monthlyTds({ year: y, annualTax: "600", deductedSoFar: "550", monthsLeft: 6 }).tds).toBe("50"); // only 50 is left
    expect(monthlyTds({ year: y, annualTax: "600", deductedSoFar: "600", monthsLeft: 3 }).tds).toBe("0");
    expect(monthlyTds({ year: y, annualTax: "600", deductedSoFar: "900", monthsLeft: 3 })).toMatchObject({ remaining: "0", tds: "0" }); // paid too much: nothing is refunded through payroll
  });
  it("needs the year's rounding and minimum to be entered", () => {
    expect(() => monthlyTds({ year: parseTaxYearValue({}), annualTax: "1", deductedSoFar: "0", monthsLeft: 1 })).toThrow(/rounding of tax/);
    expect(() => monthlyTds({ year: y, annualTax: "1", deductedSoFar: "0", monthsLeft: 0 })).toThrow();
  });
});

// ── An independent model: exact fractions in BigInt, written without the engine's helpers ──

type Q = { n: bigint; d: bigint };
const gcd = (a: bigint, b: bigint): bigint => { while (b !== 0n) [a, b] = [b, a % b]; return a < 0n ? -a : a; };
const q = (n: bigint, d: bigint = 1n): Q => { const g = gcd(n, d) || 1n; return d < 0n ? { n: -n / g, d: -d / g } : { n: n / g, d: d / g }; };
const add = (a: Q, b: Q): Q => q(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Q, b: Q): Q => q(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Q, b: Q): Q => q(a.n * b.n, a.d * b.d);
const div = (a: Q, b: Q): Q => q(a.n * b.d, a.d * b.n);
const lt = (a: Q, b: Q) => a.n * b.d < b.n * a.d;
const le = (a: Q, b: Q) => a.n * b.d <= b.n * a.d;
const qmin = (a: Q, b: Q) => (lt(a, b) ? a : b);
const qmax = (a: Q, b: Q) => (lt(a, b) ? b : a);
const ZERO_Q = q(0n);
function parseQ(text: string): Q {
  const [whole, frac = ""] = text.split(".");
  return q(BigInt(whole! + frac), 10n ** BigInt(frac.length));
}
function roundQ(x: Q, scale: number, mode: string): Q {
  const unit = 10n ** BigInt(scale);
  const scaled = mul(x, q(unit)); // x is never negative here
  const whole = scaled.n / scaled.d;
  const rem = q(scaled.n - whole * scaled.d, scaled.d);
  const half = q(1n, 2n);
  let up: boolean;
  if (rem.n === 0n) up = false;
  else if (mode === "UP" || mode === "CEIL") up = true;
  else if (mode === "DOWN" || mode === "FLOOR") up = false;
  else if (mode === "HALF_UP") up = le(half, rem);
  else up = lt(half, rem) || (rem.n * 2n === rem.d && whole % 2n === 1n);
  return q((whole + (up ? 1n : 0n)), unit);
}
function reference(y: TaxYearValue, regime: Regime, pay: string, declared: Array<{ section: string; amount: string }>): { income: Q; tax: Q } {
  const r = y[regime]!;
  const catalogue = y.sections!.value;
  const std = parseQ(r.standardDeduction!.value);
  const byCode = new Map<string, Q>();
  for (const d of declared) byCode.set(d.section, add(byCode.get(d.section) ?? ZERO_Q, parseQ(d.amount)));
  const group = new Map<string, Q>();
  let total = ZERO_Q;
  for (const s of catalogue) {
    const asked = byCode.get(s.code);
    if (!asked || (s.appliesTo !== "BOTH" && s.appliesTo !== regime)) continue;
    let c = s.cap === null ? asked : qmin(asked, parseQ(s.cap));
    if (s.groupCap) {
      const used = group.get(s.groupCap.group) ?? ZERO_Q;
      c = qmin(c, qmax(ZERO_Q, sub(parseQ(s.groupCap.cap), used)));
      group.set(s.groupCap.group, add(used, c));
    }
    total = add(total, c);
  }
  const income = qmax(ZERO_Q, sub(sub(parseQ(pay), std), total));
  let slab = ZERO_Q;
  for (const s of r.slabs!.value) {
    const top = s.to === null ? income : qmin(income, parseQ(s.to));
    const width = sub(top, parseQ(s.from));
    if (lt(ZERO_Q, width)) slab = add(slab, mul(width, div(parseQ(s.ratePercent), q(100n))));
  }
  const rb = r.rebate!.value;
  const rebate = le(income, parseQ(rb.thresholdIncome)) ? qmin(slab, parseQ(rb.maximum)) : ZERO_Q;
  const net = sub(slab, rebate);
  const band = y.surcharge!.value.find((s) => le(parseQ(s.from), income) && (s.to === null || lt(income, parseQ(s.to))));
  const sur = band ? mul(net, div(parseQ(band.ratePercent), q(100n))) : ZERO_Q;
  const cess = mul(add(net, sur), div(parseQ(y.cessPercent!.value), q(100n)));
  const rounding = y.rounding!.value;
  return { income, tax: roundQ(add(add(net, sur), cess), rounding.scale, rounding.mode) };
}
const qText = (x: Q): string => {
  // Exact decimal text of a fraction whose denominator divides a power of ten (everything here does).
  let k = 0;
  while ((10n ** BigInt(k)) % x.d !== 0n) k += 1;
  const scaled = (x.n * 10n ** BigInt(k)) / x.d;
  const s = scaled.toString().padStart(k + 1, "0");
  return k === 0 ? s : `${s.slice(0, -k)}.${s.slice(-k)}`.replace(/\.?0+$/, "") || "0";
};

const money = fc.integer({ min: 0, max: 20_000_000 }).map((n) => `${Math.floor(n / 100)}.${String(n % 100).padStart(2, "0")}`);
const rate = fc.integer({ min: 0, max: 6000 }).map((n) => `${Math.floor(n / 100)}.${String(n % 100).padStart(2, "0")}`);
const bounds = fc.uniqueArray(fc.integer({ min: 1, max: 5_000_000 }), { minLength: 1, maxLength: 5 }).map((a) => a.sort((x, y) => x - y));
const slabsOf = (cut: number[], rates: string[], first = 0) => [{ from: String(first), to: String(cut[0]), ratePercent: rates[0]! }, ...cut.map((c, i) => ({ from: String(c), to: i + 1 < cut.length ? String(cut[i + 1]) : null, ratePercent: rates[i + 1] ?? "30" }))];
const yearArb = fc.record({
  newCuts: bounds, newRates: fc.array(rate, { minLength: 6, maxLength: 6 }), oldCuts: bounds, oldRates: fc.array(rate, { minLength: 6, maxLength: 6 }),
  stdNew: fc.integer({ min: 0, max: 100000 }), stdOld: fc.integer({ min: 0, max: 100000 }),
  rebNew: fc.tuple(money, money), rebOld: fc.tuple(money, money),
  sur: fc.array(fc.tuple(fc.integer({ min: 100000, max: 9_000_000 }), rate), { maxLength: 3 }),
  cess: rate, mode: fc.constantFrom("HALF_UP", "HALF_EVEN", "UP", "DOWN", "CEIL", "FLOOR"), scale: fc.integer({ min: 0, max: 2 }),
  cap1: fc.option(money, { nil: null }), cap2: fc.option(money, { nil: null }), groupCap: fc.option(money, { nil: null }),
});
const surchargeSlabs = (s: Array<[number, string]>) => {
  const cuts = [...new Map(s.map(([a, r]) => [a, r])).entries()].sort((a, b) => a[0] - b[0]);
  return cuts.map(([from, ratePercent], i) => ({ from: String(from), to: i + 1 < cuts.length ? String(cuts[i + 1]![0]) : null, ratePercent }));
};

describe("against an independent exact-fraction model (property)", () => {
  it("every step of the annual tax agrees to the last decimal, for random years, regimes, pay and declarations", () => {
    fc.assert(
      fc.property(yearArb, fc.constantFrom<Regime>("NEW", "OLD"), money, fc.array(fc.tuple(fc.constantFrom("SEC_A", "SEC_B", "SEC_C", "SEC_D"), money), { maxLength: 5 }), (p, regime, pay, decl) => {
        const sections: SectionDef[] = [
          { code: "SEC_A", label: "Sec A", appliesTo: "OLD", cap: p.cap1, groupCap: p.groupCap ? { group: "G", cap: p.groupCap } : null, proofRequired: true },
          { code: "SEC_B", label: "Sec B", appliesTo: "BOTH", cap: p.cap2, groupCap: p.groupCap ? { group: "G", cap: p.groupCap } : null, proofRequired: false },
          { code: "SEC_C", label: "Sec C", appliesTo: "BOTH", cap: null, groupCap: null, proofRequired: false },
          { code: "SEC_D", label: "Sec D", appliesTo: "NEW", cap: p.cap1, groupCap: null, proofRequired: false },
        ];
        const y = parseTaxYearValue({
          NEW: { slabs: leaf(slabsOf(p.newCuts, p.newRates)), standardDeduction: leaf(String(p.stdNew)), rebate: leaf({ thresholdIncome: p.rebNew[0], maximum: p.rebNew[1] }) },
          OLD: { slabs: leaf(slabsOf(p.oldCuts, p.oldRates)), standardDeduction: leaf(String(p.stdOld)), rebate: leaf({ thresholdIncome: p.rebOld[0], maximum: p.rebOld[1] }) },
          surcharge: leaf(surchargeSlabs(p.sur)), cessPercent: leaf(p.cess), rounding: leaf({ mode: p.mode, scale: p.scale }), sections: leaf(sections),
        });
        const declared = decl.map(([section, amount]) => ({ section, amount }));
        const got = computeAnnualTax({ year: y, regime, taxablePay: pay, deductions: declared });
        const want = reference(y, regime, pay, declared);
        expect(got.taxableIncome).toBe(qText(want.income));
        expect(got.annualTax).toBe(qText(want.tax));
      }),
      { numRuns: 400 },
    );
  });

  it("a month's TDS agrees with the model for random remaining tax, months left, minimum and rounding", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 50_000_000 }), fc.integer({ min: 0, max: 60_000_000 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 0, max: 500_000 }), fc.constantFrom("HALF_UP", "HALF_EVEN", "UP", "DOWN", "CEIL", "FLOOR"), fc.integer({ min: 0, max: 2 }), (annualPaise, soFarPaise, months, minPaise, mode, scale) => {
        const y = year({ rounding: leaf({ mode, scale }), minimumMonthlyTds: leaf(qText(q(BigInt(minPaise), 100n))) });
        const annual = qText(q(BigInt(annualPaise), 100n));
        const soFar = qText(q(BigInt(soFarPaise), 100n));
        const got = monthlyTds({ year: y, annualTax: annual, deductedSoFar: soFar, monthsLeft: months });
        const remaining = sub(q(BigInt(annualPaise), 100n), q(BigInt(soFarPaise), 100n));
        const want = le(remaining, ZERO_Q) ? ZERO_Q : qmin(remaining, qmax(roundQ(div(remaining, q(BigInt(months))), scale, mode), q(BigInt(minPaise), 100n)));
        expect(got.tds).toBe(qText(want));
      }),
      { numRuns: 500 },
    );
  });
});
