import { dec, roundTo, sum, ZERO, type Money } from "../money";

// Part 3 A2/A3 (docs/plans/A_PART3.md): the pure arithmetic of overtime pay and leave encashment. Exact until the one rounding the directors' setting names.
type Rounding = { mode: "HALF_UP" | "UP" | "DOWN"; scale: number };
export type OvertimeRate = { mode: "FLAT_PER_HOUR"; perHour: string } | { mode: "MULTIPLIER"; multiplier: string; basisHeads: string[]; hoursPerMonth: string };
export type Divisor = { kind: "FIXED_DAYS"; days: string } | { kind: "CALENDAR_DAYS" };

/** The total of the chosen heads in a salary's monthly lines (a head the salary does not have counts as zero). */
export function basisOf(lines: ReadonlyArray<{ componentCode: string; amount: string }>, heads: readonly string[]): Money {
  return sum(lines.filter((l) => heads.includes(l.componentCode)).map((l) => dec(l.amount)));
}

/** Overtime pay for `minutes` of approved overtime in a month. */
export function overtimeAmount(minutes: number, rate: OvertimeRate, lines: ReadonlyArray<{ componentCode: string; amount: string }>, rounding: Rounding): Money {
  // One division, last: minutes × rate ÷ 60 (or minutes × multiplier × basis ÷ (60 × hours a month)), so a recurring fraction is never cut before the rounding.
  const mins = dec(String(minutes));
  const exact = rate.mode === "FLAT_PER_HOUR" ? mins.times(dec(rate.perHour)).div(60) : mins.times(dec(rate.multiplier)).times(basisOf(lines, rate.basisHeads)).div(dec(rate.hoursPerMonth).times(60)); // allow-number: minutes in an hour
  return roundTo(exact, rounding.scale, rounding.mode);
}

/** Leave encashment for `days` days: days × (the chosen heads ÷ the divisor). */
export function encashmentAmount(days: string, lines: ReadonlyArray<{ componentCode: string; amount: string }>, basisHeads: readonly string[], divisor: Divisor, calendarDaysInMonth: number, rounding: Rounding): Money {
  const by = divisor.kind === "FIXED_DAYS" ? dec(divisor.days) : dec(String(calendarDaysInMonth));
  if (by.lte(ZERO)) throw new Error("The divisor must be more than zero.");
  return roundTo(dec(days).times(basisOf(lines, basisHeads)).div(by), rounding.scale, rounding.mode);
}

/** Part 4: years of service counted for gratuity from completed years and months (a part year counts as a year from six months, when the setting says so). */
export function gratuityYears(years: number, months: number, partYear: "COMPLETED_YEARS_ONLY" | "SIX_MONTHS_OR_MORE_COUNTS_AS_A_YEAR"): number {
  return partYear === "SIX_MONTHS_OR_MORE_COUNTS_AS_A_YEAR" && months >= 6 ? years + 1 : years; // allow-number: the setting's own six months
}

/** Part 4: gratuity = wage × days per year ÷ divisor × counted years, capped at the ceiling (unless NONE); one division, last; one rounding at the end. */
export function gratuityAmount(countedYears: number, wage: Money, daysPerYear: string, divisor: string, ceiling: string, rounding: Rounding): Money {
  const exact = wage.times(dec(daysPerYear)).times(dec(String(countedYears))).div(dec(divisor));
  const capped = ceiling === "NONE" || exact.lte(dec(ceiling)) ? exact : dec(ceiling);
  return roundTo(capped, rounding.scale, rounding.mode);
}

/** Part 4: days of notice served (both ends counted) and the shortfall against the notice period. Pure; UTC dates. */
export function noticeShortfall(noticeGiven: Date, lastWorkingDay: Date, noticeDays: number): { served: number; shortfall: number } {
  const served = Math.max(0, Math.round((lastWorkingDay.getTime() - noticeGiven.getTime()) / 86_400_000) + 1); // allow-number: milliseconds in a day
  return { served, shortfall: Math.max(0, noticeDays - served) };
}

/** Part 4: notice recovery = shortfall days × basis ÷ divisor; one division, last; one rounding at the end. */
export function noticeRecoveryAmount(shortfallDays: number, basis: Money, divisor: string, rounding: Rounding): Money {
  return roundTo(dec(String(shortfallDays)).times(basis).div(dec(divisor)), rounding.scale, rounding.mode);
}
