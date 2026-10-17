import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { salaryOn } from "../../../lib/effectiveDating";
import { EncashmentRateNotConfiguredError, SettingsBasedEncashmentRateProvider, setEncashmentRateProvider, type EncashmentRateProvider, type EncashmentRateResult } from "../../leave/encashmentRate";
import { FormulaError, evaluateFormula } from "../formula";
import { ZERO, canonicalDecimal, dec, intDec, max, roundTo, sum, type Money } from "../money";
import { RuleContext, RuleNotSetError, pinStatuses, type RulePin } from "../rules/context";
import type { RoundingRule } from "../salary/breakup";
import { setArrearsBasisProvider, type ArrearsBasisProvider, type PaidShare } from "../salary/arrears";
import { countDays, iso } from "./days";

// The two seams earlier phases left for payroll to fill (docs/plans/PHASE_6.md §14D).

// ── What each person was actually paid, for arrears ──
// Read from a FINALISED run's item: the share of the cycle they were paid for is the employed share, split by the days asked about, less the dated loss of pay that
// fell inside them, as the exact fraction the run itself used. A run that is only a draft never answers: arrears are worked out from a closed month, or not at all.
interface StoredDays {
  basisDays: string;
  notEmployedDays: number;
  lopDivisorDays: string;
  employedDays: number;
  lopByDay: Array<{ date: string; lop: string }>;
}

export const finalisedRunArrearsProvider: ArrearsBasisProvider = {
  async paidShare(employeeId, cycle, from, to): Promise<PaidShare | null> {
    const item = await prisma.payrollRunItem.findFirst({
      where: { employeeId, status: { not: "EXCLUDED" }, run: { status: "FINALISED", cycleStart: cycle.start, cycleEnd: cycle.end } },
      select: { employedFrom: true, employedTo: true, inputs: true },
    });
    if (!item || !item.employedFrom || !item.employedTo) return null;
    const days = (item.inputs as { days?: StoredDays }).days;
    if (!days || days.employedDays === 0) return null;
    const start = item.employedFrom > from ? item.employedFrom : from;
    const end = item.employedTo < to ? item.employedTo : to;
    const basis = dec(days.basisDays);
    const divisor = dec(days.lopDivisorDays);
    const employed = intDec(days.employedDays);
    if (start > end) return { paid: ZERO, basis: intDec(1) };
    const lop = sum(days.lopByDay.filter((d) => d.date >= iso(start) && d.date <= iso(end)).map((d) => dec(d.lop)));
    // The same fraction the run used for a segment of those days: (basis - not employed) x days / (basis x employed days) - lop / divisor, over one denominator.
    const den = basis.times(employed).times(divisor);
    const num = basis.minus(intDec(days.notEmployedDays)).times(intDec(countDays(start, end))).times(divisor).minus(lop.times(basis).times(employed));
    return { paid: max(ZERO, num), basis: den };
  },
};

// ── The daily rate for year-end leave encashment, from the person's salary ──
// The formula is the rule ENCASH_DAILY_RATE_FORMULA, evaluated over the lines of the salary in force on the year-end date (BASIC / 30 is the specification's
// suggestion, never shipped as a value). `isFinal` is true only when that exact version of the rule is Confirmed. Until the rule has a value this defers to the flat
// rate HR entered in Phase 4, with its source recorded as before, so the Year End screen behaves exactly as it did until payroll is set up.
export class SalaryBasedEncashmentRateProvider implements EncashmentRateProvider {
  constructor(private readonly fallback: EncashmentRateProvider = new SettingsBasedEncashmentRateProvider()) {}

  async getDailyRate(employeeId: string, asOfDate: Date): Promise<EncashmentRateResult> {
    const ctx = await RuleContext.load();
    if (ctx.peek<string>("ENCASH_DAILY_RATE_FORMULA") === undefined) return this.fallback.getDailyRate(employeeId, asOfDate);
    const formula = ctx.rule<string>("ENCASH_DAILY_RATE_FORMULA");
    let rounding: RoundingRule;
    try {
      rounding = ctx.rule<RoundingRule>("LINE_ROUNDING");
    } catch (err) {
      if (err instanceof RuleNotSetError) throw new EncashmentRateNotConfiguredError();
      throw err;
    }
    if (rounding.mode === "NONE") throw new HttpError(409, 'The rule "Rounding of salary lines" is set to no rounding, so a daily rate cannot be rounded to the paisa. Choose a rounding mode for it.', "ROUNDING_NONE");
    const row = await salaryOn(employeeId, asOfDate);
    if (!row) throw new HttpError(409, `One person has no salary on ${iso(asOfDate)}, so their leave encashment rate cannot be worked out from the salary. Give them a salary, or clear the rule "Encashment: daily rate formula" to use the flat rate.`, "ENCASHMENT_NO_SALARY", { employeeId });
    const vars: Record<string, Money> = { CTC: dec(row.monthlyCtc.toString()), ANNUAL_CTC: dec(row.annualCtc.toString()) };
    for (const l of row.lines) vars[l.componentCode] = dec(l.amount.toString());
    let rate: Money;
    try {
      rate = evaluateFormula(formula, vars);
    } catch (err) {
      if (err instanceof FormulaError) throw new HttpError(409, `The encashment formula "${formula}" cannot be worked out for one person: ${err.message}`, "ENCASHMENT_FORMULA", { employeeId });
      throw err;
    }
    const pin = ctx.pins().find((p: RulePin) => p.key === "ENCASH_DAILY_RATE_FORMULA")!;
    const [status] = await pinStatuses([pin]);
    return { amount: new Prisma.Decimal(canonicalDecimal(roundTo(rate, 2, rounding.mode))), source: "SALARY_STRUCTURE", isFinal: status?.status === "CONFIRMED" };
  }
}

/** Plugs payroll into the seams earlier phases left for it. Called at process start by the api and the worker. */
export function registerPayroll(): void {
  setArrearsBasisProvider(finalisedRunArrearsProvider);
  setEncashmentRateProvider(new SalaryBasedEncashmentRateProvider());
}
