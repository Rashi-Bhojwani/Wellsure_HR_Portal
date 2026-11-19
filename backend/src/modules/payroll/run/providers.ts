import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { EncashmentRateNotConfiguredError, setEncashmentRateProvider, type EncashmentRateProvider, type EncashmentRateResult } from "../../leave/encashmentRate";
import { behaviourValue } from "../../behaviours/service";
import { salariesOn } from "../../../lib/effectiveDating";
import { encashmentAmount } from "../payPolicies/arith";
import { SALARY_HEAD_NOT_FOUND, headRefusalText, missingHeads } from "../payPolicies/service";
import { ZERO, canonicalDecimal, dec, fixed, intDec, max, sum } from "../money";
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

// ── The value of a leave day, from the person's salary (audit fix 2026-11-18, docs/plans/AUDIT_FIXES.md item 4) ──
// One setting for year-end, mid-year and exit encashment alike: Default behaviours, "Leave encashment amount" (payroll.leaveEncashment): the heads of the salary in
// force on the day, divided by the chosen divisor (a fixed number of days or the month's calendar days), with its rounding, once at the end. Not set: refused, naming
// it. A chosen head missing from the salary: refused, naming the head. There is no flat-rupee fallback and no other formula.
export class SalaryBasedEncashmentRateProvider implements EncashmentRateProvider {
  async getDailyRate(employeeId: string, asOfDate: Date): Promise<EncashmentRateResult> {
    return this.amountFor(employeeId, asOfDate, new Prisma.Decimal(1));
  }

  async amountFor(employeeId: string, asOfDate: Date, days: Prisma.Decimal): Promise<EncashmentRateResult> {
    const setting = (await behaviourValue("payroll.leaveEncashment")).value;
    if (!setting) throw new EncashmentRateNotConfiguredError();
    const salary = (await salariesOn([employeeId], asOfDate)).get(employeeId);
    if (!salary) throw new HttpError(409, `One person has no salary on ${iso(asOfDate)}, so the value of their leave days cannot be worked out. Give them a salary first.`, "ENCASHMENT_NO_SALARY", { employeeId });
    const lines = salary.lines.map((l) => ({ componentCode: l.componentCode, amount: l.amount.toString() }));
    const missing = missingHeads(lines, setting.basisHeads);
    if (missing.length) throw new HttpError(409, headRefusalText(missing), SALARY_HEAD_NOT_FOUND, { use: "ENCASHMENT", heads: missing, employeeId });
    const dim = new Date(Date.UTC(asOfDate.getUTCFullYear(), asOfDate.getUTCMonth() + 1, 0)).getUTCDate();
    const amount = encashmentAmount(canonicalDecimal(dec(days.toString())), lines, setting.basisHeads, setting.divisor, dim, setting.rounding);
    return { amount: new Prisma.Decimal(fixed(amount, 2)), source: "SALARY_STRUCTURE", isFinal: true };
  }
}

/** Plugs payroll into the seams earlier phases left for it. Called at process start by the api and the worker. */
export function registerPayroll(): void {
  setArrearsBasisProvider(finalisedRunArrearsProvider);
  setEncashmentRateProvider(new SalaryBasedEncashmentRateProvider());
}
