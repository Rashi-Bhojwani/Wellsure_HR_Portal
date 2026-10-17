import { HttpError } from "../../../middleware/errorHandler";
import { ZERO, dec, min, percentOf, roundTo, type Money } from "../money";
import type { RoundingRule } from "../salary/breakup";
import type { LwfTable, PtTable, RunRules } from "./rules";

// PF, ESI, professional tax and labour welfare fund (docs/plans/PHASE_6.md §14D). Pure functions of the figures and the rules passed in: not one rate, ceiling or
// slab is written here. What each rule means is the rule's own description in the catalog; whether the figure is law is the CA's confirmation.

/** Money is stored to six decimal places. A rule that says "no rounding" is honoured only while the figure fits; otherwise it is refused, never quietly trimmed. */
const STORAGE_SCALE = 6;

export function roundByRule(value: Money, rule: RoundingRule, what: string): Money {
  if (rule.mode !== "NONE") return roundTo(value, rule.scale, rule.mode);
  if (value.decimalPlaces() > STORAGE_SCALE) {
    throw new HttpError(409, `${what} works out to ${value.toFixed()} and its rounding rule says not to round, but money is kept to ${STORAGE_SCALE} decimal places. Choose a rounding mode for it under Rules and setup.`, "ROUNDING_NEEDED", { what });
  }
  return value;
}

export interface PfResult {
  wages: Money;
  cappedWages: Money;
  employee: Money;
  eps: Money;
  epfEr: Money;
  edli: Money;
  admin: Money;
}

export function computePf(wages: Money, rules: RunRules): PfResult {
  const w = wages.isNegative() ? ZERO : wages;
  const capped = rules.pf.ceilingMode === "CAP_AT_CEILING" ? min(w, rules.pf.ceiling) : w;
  const part = (rate: Money, what: string) => roundByRule(percentOf(capped, rate), rules.pfRounding, what);
  return {
    wages: w,
    cappedWages: capped,
    employee: part(rules.pf.employeeRate, "Employee PF"),
    eps: part(rules.pf.epsRate, "Employer pension (EPS)"),
    epfEr: part(rules.pf.epfErRate, "Employer PF"),
    edli: part(rules.pf.edliRate, "EDLI"),
    admin: part(rules.pf.adminRate, "PF administration charge"),
  };
}

export interface EsiResult {
  wages: Money;
  employee: Money;
  employer: Money;
}

export function computeEsi(earnedWages: Money, rules: RunRules): EsiResult {
  const w = earnedWages.isNegative() ? ZERO : earnedWages;
  return {
    wages: w,
    employee: roundByRule(percentOf(w, rules.esi.employeeRate), rules.esiRounding, "Employee ESI"),
    employer: roundByRule(percentOf(w, rules.esi.employerRate), rules.esiRounding, "Employer ESI"),
  };
}

/** The state key for a branch's free-text state, by the HR-maintained map (case and surrounding spaces do not matter). Null if the map has no entry. */
export function resolveState(text: string, map: Record<string, string>): string | null {
  const wanted = text.trim().toLowerCase();
  for (const [name, key] of Object.entries(map)) if (name.trim().toLowerCase() === wanted) return key;
  return null;
}

export interface PtResult {
  amount: Money;
  slab: { fromGross: string; toGross: string | null; monthlyAmount: string } | null;
  overridden: boolean;
}

/** The professional tax for a state: the slab the month's gross falls in (from inclusive, to exclusive), with that slab's amount for this month if it names one. Null if the state has no table. */
export function computePt(table: PtTable, stateKey: string, gross: Money, month: number): PtResult | null {
  const state = table.states[stateKey];
  if (!state) return null;
  const slab = state.slabs.find((s) => gross.greaterThanOrEqualTo(dec(s.fromGross)) && (s.toGross === null || gross.lessThan(dec(s.toGross))));
  if (!slab) return { amount: ZERO, slab: null, overridden: false };
  const override = slab.monthOverrides?.[String(month)];
  return { amount: dec(override ?? slab.monthlyAmount), slab: { fromGross: slab.fromGross, toGross: slab.toGross, monthlyAmount: slab.monthlyAmount }, overridden: override !== undefined };
}

export interface LwfResult {
  employee: Money;
  employer: Money;
}

/** Labour welfare fund for a state in a month: the amounts if the month is one of the state's months, else nothing. Null if the state has no entry. */
export function computeLwf(table: LwfTable, stateKey: string, month: number): LwfResult | null {
  const state = table.states[stateKey];
  if (!state) return null;
  if (!state.months.includes(month)) return { employee: ZERO, employer: ZERO };
  return { employee: dec(state.employee), employer: dec(state.employer) };
}

/** The first day of the ESI contribution period (April to September, October to March) that contains `month` of `year`, as [year, month]. */
export function contributionPeriodStart(year: number, month: number): { year: number; month: number } {
  const OCTOBER = 10;
  const APRIL = 4;
  if (month >= OCTOBER) return { year, month: OCTOBER };
  if (month >= APRIL) return { year, month: APRIL };
  return { year: year - 1, month: OCTOBER };
}
