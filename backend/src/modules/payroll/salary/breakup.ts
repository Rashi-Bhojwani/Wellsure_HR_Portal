import type { ComponentType } from "@shared/constants/payrollSalary";
import { HttpError } from "../../../middleware/errorHandler";
import { evaluateFormula } from "../formula";
import { ZERO, canonicalDecimal, dec, fixed, intDec, percentOf, roundTo, sum, type Money, type RoundingMode } from "../money";
import type { ComponentValue, StructureValue } from "./schemas";

// From an annual CTC and a structure to the frozen monthly breakup of a salary row (docs/plans/PHASE_6.md §14B). Pure: no database, no clock.
//
//   monthly CTC = annual CTC / 12, rounded by the rule "Rounding of salary lines" (passed in: the caller reads it through RuleContext so the salary
//                 row records which version it used)
//   each line   = what the structure says (a percentage, a fixed amount, a typed amount, a formula), rounded by the same rule; later lines see earlier
//                 lines AS ROUNDED, which is what the payslip shows; amounts that a person typed (fixed or per person) are not rounded
//   the balance = monthly CTC minus every other line of a kind that counts toward CTC, so the lines always add up exactly
// A structure with no balance line has to add up on its own; if it does not, or the balance would be negative, the breakup is refused and says by how much.

export interface RoundingRule {
  mode: RoundingMode | "NONE";
  scale: number;
}

export interface BreakupLine {
  component: string;
  componentVersion: number;
  type: ComponentType;
  amount: Money;
  order: number;
}

export interface Breakup {
  monthlyCtc: Money;
  lines: BreakupLine[];
}

export class BreakupError extends HttpError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(409, message, code, details);
    this.name = "BreakupError";
  }
}

export interface BreakupInput {
  annualCtc: Money;
  structure: StructureValue;
  /** The component version each structure line pins, by component code. */
  components: ReadonlyMap<string, { version: number; value: ComponentValue }>;
  /** Amounts typed for this person, for the structure's PER_PERSON lines. */
  perPerson?: Readonly<Record<string, Money>>;
  rounding: RoundingRule;
}

const MONTHS_IN_YEAR = intDec(12);

function roundWith(value: Money, rule: RoundingRule & { mode: RoundingMode }): Money {
  return roundTo(value, rule.scale, rule.mode);
}

export function computeBreakup(input: BreakupInput): Breakup {
  const rule = input.rounding;
  if (rule.mode === "NONE") {
    throw new BreakupError(
      "ROUNDING_NONE",
      'The rule "Rounding of salary lines" is set to no rounding, but one twelfth of a yearly CTC is not a finite number. Choose a rounding mode and a number of decimal places for it.',
    );
  }
  const rounding = rule as RoundingRule & { mode: RoundingMode };
  const { structure } = input;
  const monthlyCtc = roundWith(input.annualCtc.dividedBy(MONTHS_IN_YEAR), rounding);
  const included = new Set<string>(structure.ctcIncludes);

  const amounts = new Map<string, Money>();
  const lines: BreakupLine[] = [];
  const missing: string[] = [];
  let balanceIndex = -1;

  for (const [order, line] of structure.lines.entries()) {
    const pinned = input.components.get(line.component);
    if (!pinned) throw new BreakupError("COMPONENT_MISSING", `The structure uses ${line.component}, which has no version on record.`);
    const type = pinned.value.type;
    const base: BreakupLine = { component: line.component, componentVersion: pinned.version, type, amount: ZERO, order };
    const calc = line.calc;
    let amount: Money | null = null;
    if (calc.method === "BALANCE") {
      balanceIndex = lines.length;
    } else if (calc.method === "PERCENT") {
      const of = calc.of === "CTC" ? monthlyCtc : amounts.get(calc.of);
      if (!of) throw new BreakupError("STRUCTURE_INVALID", `${line.component} is a percentage of ${calc.of}, which comes later or is not in the structure.`);
      amount = roundWith(percentOf(of, dec(calc.percent)), rounding);
    } else if (calc.method === "FIXED_AMOUNT") {
      amount = dec(calc.amount);
    } else if (calc.method === "PER_PERSON") {
      const typed = input.perPerson?.[line.component];
      if (typed === undefined) missing.push(line.component);
      else if (typed.isNegative()) throw new BreakupError("AMOUNT_NEGATIVE", `${line.component} cannot be negative.`);
      else amount = typed;
    } else {
      const vars: Record<string, Money> = { CTC: monthlyCtc, ANNUAL_CTC: input.annualCtc };
      for (const [name, value] of amounts) vars[name] = value;
      amount = roundWith(evaluateFormula(calc.formula, vars), rounding);
      if (amount.isNegative()) throw new BreakupError("AMOUNT_NEGATIVE", `The formula for ${line.component} gives a negative amount (${fixed(amount, rounding.scale)}).`);
    }
    if (amount !== null) amounts.set(line.component, amount);
    lines.push({ ...base, amount: amount ?? ZERO });
  }
  if (missing.length) throw new BreakupError("PER_PERSON_MISSING", `An amount has to be typed in for ${missing.join(", ")}.`, { components: missing });

  const counted = (l: BreakupLine, skip = -1): boolean => included.has(l.type) && lines.indexOf(l) !== skip;
  const others = sum(lines.filter((l) => counted(l, balanceIndex)).map((l) => l.amount));
  if (balanceIndex >= 0) {
    const balance = monthlyCtc.minus(others);
    const b = lines[balanceIndex]!;
    if (balance.isNegative()) {
      throw new BreakupError(
        "BALANCE_NEGATIVE",
        `The other lines come to ${fixed(others, rounding.scale)} a month, which is ${fixed(balance.negated(), rounding.scale)} more than the monthly CTC of ${fixed(monthlyCtc, rounding.scale)}, so there is nothing left for ${b.component}.`,
        { monthlyCtc: canonicalDecimal(monthlyCtc), others: canonicalDecimal(others), shortfall: canonicalDecimal(balance.negated()) },
      );
    }
    amounts.set(b.component, balance);
    lines[balanceIndex] = { ...b, amount: balance };
  } else if (!others.equals(monthlyCtc)) {
    const diff = others.minus(monthlyCtc);
    throw new BreakupError(
      "STRUCTURE_DOES_NOT_SUM",
      `The lines come to ${fixed(others, rounding.scale)} a month, which is ${fixed(diff.abs(), rounding.scale)} ${diff.isPositive() ? "more" : "less"} than the monthly CTC of ${fixed(monthlyCtc, rounding.scale)}. Add a balance line, or change the percentages.`,
      { monthlyCtc: canonicalDecimal(monthlyCtc), lines: canonicalDecimal(others), difference: canonicalDecimal(diff) },
    );
  }
  return { monthlyCtc, lines };
}

/** The breakup as plain strings, for JSON, hashing and the screens. */
export function breakupToJson(b: Breakup): { monthlyCtc: string; lines: Array<{ component: string; componentVersion: number; type: ComponentType; amount: string; order: number }> } {
  return { monthlyCtc: canonicalDecimal(b.monthlyCtc), lines: b.lines.map((l) => ({ component: l.component, componentVersion: l.componentVersion, type: l.type, amount: canonicalDecimal(l.amount), order: l.order })) };
}

/**
 * Each line over a year (twelve months of the monthly amount), the total of the lines that count toward CTC, and how far that is from the yearly CTC. The monthly
 * figures are rounded and the balance line absorbs the rounding, so the twelve months can differ from the yearly CTC by a few paise: the screen shows both
 * side by side and names the difference, so nobody is surprised.
 */
export function annualView(b: Breakup, annualCtc: Money, ctcIncludes: readonly ComponentType[]): { annualCtc: string; lines: Array<{ component: string; annual: string }>; total: string; difference: string } {
  const lines = b.lines.map((l) => ({ component: l.component, annual: canonicalDecimal(l.amount.times(MONTHS_IN_YEAR)) }));
  const total = sum(b.lines.filter((l) => ctcIncludes.includes(l.type)).map((l) => l.amount.times(MONTHS_IN_YEAR)));
  return { annualCtc: canonicalDecimal(annualCtc), lines, total: canonicalDecimal(total), difference: canonicalDecimal(total.minus(annualCtc)) };
}
