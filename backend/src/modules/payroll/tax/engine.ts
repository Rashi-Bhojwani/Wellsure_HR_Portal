import { HUNDRED, ZERO, canonicalDecimal, dec, max, min, roundTo, sum, type Money, type RoundingMode } from "../money";
import type { SectionDef, TaxYearValue } from "./schema";

// The tax engine: pure, exact, no I/O (docs/plans/STAGE_7_PLAN.md). It works out one regime's annual tax from the figures it is given and the tax year the owners entered, and a
// month's TDS from that. It knows no rate, slab or limit of its own: whatever is not entered stops it, naming the value. Every step is returned, so a payslip can explain it.
// Not modelled (and said in the working): marginal relief on the rebate or the surcharge.

export type Regime = "NEW" | "OLD";

export class TaxValueNotSetError extends Error {
  constructor(public readonly what: string) {
    super(`${what} has not been entered for this tax year, so tax cannot be worked out.`);
  }
}

export interface EngineInput {
  year: TaxYearValue;
  regime: Regime;
  /** The year's taxable pay before any deduction, projected, an exact decimal. */
  taxablePay: string;
  /** What the person declared (or what was verified, after the proof cut-off), by section code. */
  deductions: ReadonlyArray<{ section: string; amount: string }>;
}

export interface SectionWorking {
  code: string;
  label: string;
  requested: string;
  counted: string;
  why: string;
}

export interface EngineResult {
  regime: Regime;
  taxablePay: string;
  standardDeduction: string;
  sections: SectionWorking[];
  sectionsTotal: string;
  taxableIncome: string;
  slabTax: string;
  rebate: string;
  surchargeRate: string;
  surcharge: string;
  cessPercent: string;
  cess: string;
  beforeRounding: string;
  annualTax: string;
  notModelled: string[];
}

const need = <T>(value: T | undefined, what: string): T => {
  if (value === undefined) throw new TaxValueNotSetError(what);
  return value;
};
const REGIME_NAME: Record<Regime, string> = { NEW: "the new regime", OLD: "the old regime" };

/** What counts under each section: its own cap, then the cap shared with the other lines of its group, in catalogue order. Only sections that apply to the regime count. */
export function countDeductions(sections: readonly SectionDef[], regime: Regime, declared: ReadonlyArray<{ section: string; amount: string }>): SectionWorking[] {
  const byCode = new Map<string, Money>();
  for (const d of declared) byCode.set(d.section, (byCode.get(d.section) ?? ZERO).plus(dec(d.amount)));
  const usedInGroup = new Map<string, Money>();
  const out: SectionWorking[] = [];
  for (const s of sections) {
    const requested = byCode.get(s.code);
    if (requested === undefined) continue;
    if (s.appliesTo !== "BOTH" && s.appliesTo !== regime) {
      out.push({ code: s.code, label: s.label, requested: canonicalDecimal(requested), counted: "0", why: `not allowed under ${REGIME_NAME[regime]}` });
      continue;
    }
    let counted = requested;
    const reasons: string[] = [];
    if (s.cap !== null && counted.greaterThan(dec(s.cap))) {
      counted = dec(s.cap);
      reasons.push(`limited to its own cap of ${s.cap}`);
    }
    if (s.groupCap) {
      const left = max(ZERO, dec(s.groupCap.cap).minus(usedInGroup.get(s.groupCap.group) ?? ZERO));
      if (counted.greaterThan(left)) {
        counted = left;
        reasons.push(`limited by the cap of ${s.groupCap.cap} shared by group ${s.groupCap.group}`);
      }
      usedInGroup.set(s.groupCap.group, (usedInGroup.get(s.groupCap.group) ?? ZERO).plus(counted));
    }
    out.push({ code: s.code, label: s.label, requested: canonicalDecimal(requested), counted: canonicalDecimal(counted), why: reasons.join("; ") || "counted in full" });
  }
  return out;
}

export function computeAnnualTax(input: EngineInput): EngineResult {
  const name = REGIME_NAME[input.regime];
  const regime = need(input.year[input.regime], name);
  const slabs = need(regime.slabs, `${name}'s slabs`).value;
  const standard = dec(need(regime.standardDeduction, `${name}'s standard deduction`).value);
  const rebateDef = need(regime.rebate, `${name}'s rebate`).value;
  const surchargeTable = need(input.year.surcharge, "the surcharge table").value;
  const cessPercent = dec(need(input.year.cessPercent, "the cess percentage").value);
  const rounding = need(input.year.rounding, "the rounding of tax").value;
  const catalogue = need(input.year.sections, "the section catalogue").value;

  const pay = max(ZERO, dec(input.taxablePay));
  const sections = countDeductions(catalogue, input.regime, input.deductions);
  const sectionsTotal = sum(sections.map((s) => dec(s.counted)));
  const income = max(ZERO, pay.minus(standard).minus(sectionsTotal));

  let slabTax = ZERO;
  for (const s of slabs) {
    const top = s.to === null ? income : min(income, dec(s.to));
    const inSlab = top.minus(dec(s.from));
    if (inSlab.greaterThan(ZERO)) slabTax = slabTax.plus(inSlab.times(dec(s.ratePercent)).dividedBy(HUNDRED));
  }
  const rebate = income.lessThanOrEqualTo(dec(rebateDef.thresholdIncome)) ? min(slabTax, dec(rebateDef.maximum)) : ZERO;
  const afterRebate = slabTax.minus(rebate);
  const band = surchargeTable.find((s) => income.greaterThanOrEqualTo(dec(s.from)) && (s.to === null || income.lessThan(dec(s.to))));
  const surchargeRate = band ? dec(band.ratePercent) : ZERO;
  const surcharge = afterRebate.times(surchargeRate).dividedBy(HUNDRED);
  const cess = afterRebate.plus(surcharge).times(cessPercent).dividedBy(HUNDRED);
  const beforeRounding = afterRebate.plus(surcharge).plus(cess);
  const annualTax = roundTo(beforeRounding, rounding.scale, rounding.mode as RoundingMode);
  return {
    regime: input.regime,
    taxablePay: canonicalDecimal(pay),
    standardDeduction: canonicalDecimal(standard),
    sections,
    sectionsTotal: canonicalDecimal(sectionsTotal),
    taxableIncome: canonicalDecimal(income),
    slabTax: canonicalDecimal(slabTax),
    rebate: canonicalDecimal(rebate),
    surchargeRate: canonicalDecimal(surchargeRate),
    surcharge: canonicalDecimal(surcharge),
    cessPercent: canonicalDecimal(cessPercent),
    cess: canonicalDecimal(cess),
    beforeRounding: canonicalDecimal(beforeRounding),
    annualTax: canonicalDecimal(annualTax),
    notModelled: ["marginal relief on the rebate", "marginal relief on the surcharge"],
  };
}

export interface MonthlyTdsInput {
  year: TaxYearValue;
  annualTax: string;
  /** TDS already deducted this year, an exact decimal. */
  deductedSoFar: string;
  /** Pay months left in the year including this one. */
  monthsLeft: number;
}

export interface MonthlyTdsResult {
  remaining: string;
  share: string;
  minimum: string;
  tds: string;
}

/**
 * This month's TDS: what is still to be deducted this year, spread over the months left, rounded by the year's rule, at least the year's minimum, never more than what remains and
 * never below zero (tax is not refunded through payroll: a person who has paid too much simply has nothing taken until the figures catch up).
 */
export function monthlyTds(input: MonthlyTdsInput): MonthlyTdsResult {
  const rounding = need(input.year.rounding, "the rounding of tax").value;
  const minimum = dec(need(input.year.minimumMonthlyTds, "the minimum monthly TDS").value);
  if (!Number.isInteger(input.monthsLeft) || input.monthsLeft < 1) throw new Error("months left must be a whole number of at least one");
  const remaining = dec(input.annualTax).minus(dec(input.deductedSoFar));
  if (remaining.lessThanOrEqualTo(ZERO)) return { remaining: canonicalDecimal(max(ZERO, remaining)), share: "0", minimum: canonicalDecimal(minimum), tds: "0" };
  const share = roundTo(remaining.dividedBy(dec(String(input.monthsLeft))), rounding.scale, rounding.mode as RoundingMode);
  const tds = min(remaining, max(share, minimum));
  return { remaining: canonicalDecimal(remaining), share: canonicalDecimal(share), minimum: canonicalDecimal(minimum), tds: canonicalDecimal(tds) };
}
