import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { dec } from "../money";
import { computeAnnualTax, type Regime } from "../tax/engine";
import { hraExemptionOf } from "../tax/hra";
import { parseTaxYearValue, type SectionDef, type TaxYearValue } from "../tax/schema";
import { Frac } from "./rational";

// Part 4 (ST-15, ST-18; docs/plans/A_PART4.md): the HRA exemption and the rebate's marginal relief. Every figure here is MADE UP and labelled TEST; nothing is a tax rule.
const src = { sourceNote: "TEST figure for a test", effectiveFrom: "2026-04-01" };
const leaf = <T>(value: T) => ({ value, ...src });
const SECTIONS: SectionDef[] = [
  { code: "TEST_RENT", label: "Rent paid (TEST)", appliesTo: "OLD", cap: null, groupCap: null, proofRequired: true },
  { code: "TEST_SEC", label: "A deduction (TEST)", appliesTo: "OLD", cap: "150000", groupCap: null, proofRequired: true },
];
const base = (over: Partial<TaxYearValue> = {}): TaxYearValue =>
  parseTaxYearValue({
    NEW: { slabs: leaf([{ from: "0", to: "300000", ratePercent: "0" }, { from: "300000", to: null, ratePercent: "10" }]), standardDeduction: leaf("50000"), rebate: leaf({ thresholdIncome: "700000", maximum: "25000" }) },
    OLD: { slabs: leaf([{ from: "0", to: "250000", ratePercent: "0" }, { from: "250000", to: "500000", ratePercent: "5" }, { from: "500000", to: null, ratePercent: "20" }]), standardDeduction: leaf("50000"), rebate: leaf({ thresholdIncome: "500000", maximum: "12500" }) },
    surcharge: leaf([]),
    cessPercent: leaf("4"),
    defaultRegime: leaf("OLD"),
    rounding: leaf({ mode: "HALF_UP", scale: 0 }),
    minimumMonthlyTds: leaf("0"),
    oneOffs: leaf("MONTH_PAID"),
    sections: leaf(SECTIONS),
    ...over,
  });
const HRA = { rentSection: "TEST_RENT", hraHeads: ["TEST_HRA"], basisHeads: ["TEST_BASIC"], rentExcessPercent: "10", metroPercent: "50", nonMetroPercent: "40", metro: false };
const withHra = (metro = false) => base({ hraExemption: leaf({ ...HRA, metro }) } as Partial<TaxYearValue>);
const P = (p: bigint) => `${p / 100n}.${String(p % 100n).padStart(2, "0")}`;

describe("ST-15 — the HRA exemption against exact fractions (TEST values)", () => {
  it("is the least of the HRA received, rent less 10% (TEST) of the basis, and 40% / 50% (TEST) of the basis; never below zero", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 100_000_000n }), fc.bigInt({ min: 0n, max: 200_000_000n }), fc.bigInt({ min: 0n, max: 100_000_000n }), fc.boolean(), (received, basis, rent, metro) => {
        const got = hraExemptionOf({ ...HRA, metro }, { received: dec(P(received)), basis: dec(P(basis)), rent: dec(P(rent)) });
        const rentLess = new Frac(rent * 100n - basis * 10n, 10000n); // rupees: rent − 10% of basis
        const share = new Frac(basis * (metro ? 50n : 40n), 10000n);
        const r = new Frac(received, 100n);
        const cands = [r, rentLess.n < 0n ? new Frac(0n, 1n) : rentLess, share];
        const least = cands.reduce((a, b) => (a.n * b.d <= b.n * a.d ? a : b));
        expect(got.times(10000).toFixed(0)).toBe(((least.n * 10000n) / least.d).toString());
      }),
      { numRuns: 500 },
    );
  });
  it("in the old regime it lowers taxable pay and the rent section is not a deduction; the new regime is untouched", () => {
    const y = withHra();
    const deductions = [{ section: "TEST_RENT", amount: "240000" }, { section: "TEST_SEC", amount: "50000" }];
    const old = computeAnnualTax({ year: y, regime: "OLD", taxablePay: "1200000", deductions, hra: { received: "200000", basis: "480000" } });
    // least of 200000, 240000 − 48000 = 192000, 40% of 480000 = 192000 → 192000
    expect(old.hraExemption).toBe("192000");
    expect(old.taxablePay).toBe("1008000");
    expect(old.sections.map((s) => s.code)).toEqual(["TEST_SEC"]);
    expect(old.taxableIncome).toBe(String(1008000 - 50000 - 50000));
    const neu = computeAnnualTax({ year: y, regime: "NEW", taxablePay: "1200000", deductions, hra: { received: "200000", basis: "480000" } });
    expect(neu.hraExemption).toBeUndefined();
    expect(neu.taxablePay).toBe("1200000");
  });
});

describe("ST-18 — marginal relief on the rebate (TEST values)", () => {
  it("just above the threshold the tax after the rebate is never more than the income above it; without the setting nothing changes", () => {
    fc.assert(
      fc.property(fc.integer({ min: 500001, max: 900000 }), (taxable) => {
        const pay = String(taxable + 50000); // standard deduction 50000 (TEST)
        const on = computeAnnualTax({ year: base({ marginalReliefOnRebate: leaf(true) } as Partial<TaxYearValue>), regime: "OLD", taxablePay: pay, deductions: [] });
        const off = computeAnnualTax({ year: base(), regime: "OLD", taxablePay: pay, deductions: [] });
        const above = taxable - 500000;
        const slab = 12500 + (taxable - 500000) * 0.2; // allow-number: TEST slabs of this file
        const expectedAfter = Math.min(slab, above);
        expect(Number(on.slabTax) - Number(on.rebate) - Number(on.marginalRelief ?? "0")).toBeCloseTo(expectedAfter, 6);
        expect(off.marginalRelief).toBeUndefined();
        expect(Number(on.annualTax)).toBeLessThanOrEqual(Number(off.annualTax));
      }),
      { numRuns: 300 },
    );
  });
});

describe("golden — a tax year without HRA or relief gives exactly the result it gave before part 4", () => {
  it("the result has exactly the fields it had before, and the new ones only when they apply", () => {
    for (const regime of ["OLD", "NEW"] as Regime[]) {
      const r = computeAnnualTax({ year: base(), regime, taxablePay: "900000", deductions: [{ section: "TEST_SEC", amount: "50000" }], hra: { received: "1", basis: "1" } });
      expect(Object.keys(r).sort()).toEqual(["annualTax", "beforeRounding", "cess", "cessPercent", "notModelled", "rebate", "regime", "sections", "sectionsTotal", "slabTax", "standardDeduction", "surcharge", "surchargeRate", "taxableIncome", "taxablePay"]);
      expect(r.notModelled).toEqual(["marginal relief on the rebate", "marginal relief on the surcharge"]);
    }
  });
});
