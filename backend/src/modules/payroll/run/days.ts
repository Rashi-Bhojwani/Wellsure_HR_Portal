import { addCalendarDays } from "../../../lib/businessDate";
import { ZERO, intDec, max, sum, type Money } from "../money";
import type { DayIn } from "./types";
import type { LopDivisor, PayDaysBasis } from "./rules";

// Days, and the share of a month a person is paid for (docs/plans/PHASE_6.md §14D). Pure: no database, no clock.
//
//   basisDays      what a month counts as (PAY_DAYS_BASIS): the days in the cycle, a fixed number, or the working days in it
//   employedShare  (basisDays - days not employed in the cycle) / basisDays        a joiner or leaver is paid for the days they were here
//   lopShare       days of loss of pay / lopDivisorDays (LOP_DIVISOR)               a day of LOP costs a day's pay, by the company's divisor
//   factor         employedShare - lopShare                                          what fraction of each full-month line is paid
//
// Each salary segment (a revision on the 16th makes two) gets a factor of its own that adds up to the person's: the employed share split by its days, less the
// loss of pay that actually fell inside it. A day is a day in the span; the locked daily rows say which were holidays, week offs and loss of pay.
//
// A factor is carried as a FRACTION (numerator and denominator, both exact), never as a quotient. 28/31 has no finite decimal form, and a line worked out as
// amount x 0.9032258064516129... can land a hair either side of a half, rounding the wrong way, or leave a speck above zero for someone who lost every day and so
// be paid a non-prorating allowance in full. Amount x numerator / denominator divides once, at the end, and "is it zero" is a comparison of exact numbers.
// All the segments of one person share a denominator, so their numerators add exactly.

export const iso = (d: Date): string => d.toISOString().slice(0, 10);

/** Whole days in [from, to] inclusive (0 if to < from). */
export function countDays(from: Date, to: Date): number {
  let n = 0;
  for (let d = from; d <= to; d = addCalendarDays(d, 1)) n += 1;
  return n;
}

export type DaysHold = { reason: "WORKING_DAYS_PART_MONTH"; detail: string };

export interface DayFigures {
  cycleDays: number;
  employedDays: number;
  notEmployedDays: number;
  basisDays: Money;
  lopDivisorDays: Money;
  lopDays: Money;
  employedShare: Money;
  lopShare: Money;
  /** The fraction of each full-month line that is paid: factorNum / factorDen, with factorNum never below zero. Money is worked out from these two, not from `factor`. */
  factorNum: Money;
  factorDen: Money;
  /** factorNum / factorDen, for display. Money is never worked out from it. */
  factor: Money;
  /** factor x basisDays, for display. */
  paidDays: Money;
  lopExceedsDays: boolean;
  hold: DaysHold | null;
}

const isNonWorking = (d: DayIn) => d.status === "H" || d.status === "O";

export function computeDayFigures(args: {
  cycle: { start: Date; end: Date };
  span: { from: Date; to: Date };
  days: readonly DayIn[];
  basis: PayDaysBasis;
  lopDivisor: LopDivisor;
  fixedDays: number | null;
}): DayFigures {
  const cycleDays = countDays(args.cycle.start, args.cycle.end);
  const employedDays = countDays(args.span.from, args.span.to);
  const notEmployedDays = cycleDays - employedDays;
  const lopDays = sum(args.days.map((d) => d.lopDays));
  const wholeCycle = notEmployedDays === 0;
  const workingDays = intDec(args.days.filter((d) => !isNonWorking(d)).length);

  let hold: DaysHold | null = null;
  const daysFor = (b: PayDaysBasis): Money => {
    if (b === "CALENDAR_DAYS") return intDec(cycleDays);
    if (b === "FIXED_DAYS") return intDec(args.fixedDays ?? cycleDays);
    // Working days: only knowable from the person's own rows, which exist only for the days they were employed.
    if (!wholeCycle) {
      hold = { reason: "WORKING_DAYS_PART_MONTH", detail: `They were employed ${employedDays} of the ${cycleDays} days of this cycle, and the pay-days basis is working days. The working days of the days they were not here are not on record, so the share cannot be worked out. Choose another pay-days basis, or pay this person outside the run.` };
    }
    return workingDays;
  };
  const basisDays = daysFor(args.basis);
  const lopDivisorDays = args.lopDivisor === "SAME_AS_PAY_DAYS_BASIS" ? basisDays : daysFor(args.lopDivisor);

  if (hold || basisDays.isZero() || lopDivisorDays.isZero()) {
    const failed = hold ?? { reason: "WORKING_DAYS_PART_MONTH" as const, detail: "The number of days a month counts as is zero for this person, so a share of it cannot be worked out." };
    return { cycleDays, employedDays, notEmployedDays, basisDays, lopDivisorDays, lopDays, employedShare: ZERO, lopShare: ZERO, factorNum: ZERO, factorDen: intDec(1), factor: ZERO, paidDays: ZERO, lopExceedsDays: false, hold: failed };
  }
  const employedAmount = basisDays.minus(intDec(notEmployedDays)); // the days of the basis they are paid for
  // employedAmount / basisDays - lopDays / lopDivisorDays, over one denominator.
  const den = basisDays.times(lopDivisorDays);
  const num = max(ZERO, employedAmount.times(lopDivisorDays).minus(lopDays.times(basisDays)));
  const factor = num.dividedBy(den);
  return {
    cycleDays,
    employedDays,
    notEmployedDays,
    basisDays,
    lopDivisorDays,
    lopDays,
    employedShare: employedAmount.dividedBy(basisDays),
    lopShare: lopDays.dividedBy(lopDivisorDays),
    factorNum: num,
    factorDen: den,
    factor,
    paidDays: factor.times(basisDays),
    lopExceedsDays: lopDays.greaterThan(intDec(employedDays)),
    hold: null,
  };
}

export interface SegmentFactor {
  days: number;
  lop: Money;
  /** The segment's fraction: num / den, num never below zero. `den` is the same for every segment of the person, so the numerators of a person's segments add exactly. */
  num: Money;
  den: Money;
  /** For display only. */
  factor: Money;
}

/** The factor of one salary segment: the employed share split by the segment's days, less the loss of pay that fell inside it. */
export function segmentFactor(figures: DayFigures, seg: { from: Date; to: Date }, days: readonly DayIn[]): SegmentFactor {
  const segDays = countDays(seg.from, seg.to);
  const lop = sum(days.filter((d) => d.date >= seg.from && d.date <= seg.to).map((d) => d.lopDays));
  const employed = intDec(figures.employedDays);
  const den = figures.basisDays.times(employed).times(figures.lopDivisorDays);
  if (figures.employedDays === 0 || figures.hold || den.isZero()) return { days: segDays, lop, num: ZERO, den: intDec(1), factor: ZERO };
  // (basis - notEmployed) x segDays / (basis x employedDays)  -  lop / lopDivisor, over basis x employedDays x lopDivisor.
  const employedAmount = figures.basisDays.minus(intDec(figures.notEmployedDays));
  const num = max(ZERO, employedAmount.times(intDec(segDays)).times(figures.lopDivisorDays).minus(lop.times(figures.basisDays).times(employed)));
  return { days: segDays, lop, num, den, factor: num.dividedBy(den) };
}
