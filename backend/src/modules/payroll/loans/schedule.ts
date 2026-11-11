import { dec, intDec, roundTo, sum, ZERO, type Money } from "../money";

// P7-4 (docs/plans/P7_4_LOANS.md): a loan's instalments, exact. Pure: no figure of its own, no clock.
// * A rate of zero: equal principal parts rounded down to the paisa, the last part taking the remainder.
// * Otherwise the reducing-balance method: the instalment = P·r·(1+r)^n / ((1+r)^n − 1) with r = yearly rate ÷ 12 ÷ 100, rounded half-up to the paisa; each month's
//   interest = the balance × r, rounded half-up to the paisa; principal = instalment − interest; the last month clears the balance exactly.
// The principal parts always sum to the principal to the paisa.

export interface Instalment {
  /** 1-based position. */
  n: number;
  /** "YYYY-MM-01": the month whose run recovers it. */
  month: string;
  principal: Money;
  interest: Money;
  /** The balance left after this instalment. */
  balanceAfter: Money;
}

export function addMonths(month: string, k: number): string {
  const y = Number(month.slice(0, 4)); // allow-number: a calendar year, not money
  const m = Number(month.slice(5, 7)) - 1 + k; // allow-number: a calendar month, not money
  const yy = y + Math.floor(m / 12); // allow-number: calendar arithmetic, not money
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, "0")}-01`;
}

export function loanSchedule(principalText: string, yearlyRatePercentText: string, count: number, firstMonth: string): Instalment[] {
  const principal = dec(principalText);
  const rate = dec(yearlyRatePercentText);
  if (!Number.isInteger(count) || count < 1) throw new Error("The number of instalments must be a whole number of at least 1.");
  if (principal.lte(ZERO)) throw new Error("The principal must be more than zero.");
  if (rate.isNegative()) throw new Error("The rate cannot be negative.");
  if (!/^\d{4}-\d{2}-01$/.test(firstMonth)) throw new Error("The first month is a month's first day (YYYY-MM-01).");
  const out: Instalment[] = [];
  let balance = principal;
  if (rate.isZero()) {
    const part = roundTo(principal.dividedBy(intDec(count)), 2, "DOWN");
    for (let i = 1; i <= count; i += 1) {
      const p = i === count ? balance : part;
      balance = balance.minus(p);
      out.push({ n: i, month: addMonths(firstMonth, i - 1), principal: p, interest: ZERO, balanceAfter: balance });
    }
    return out;
  }
  const r = rate.dividedBy(intDec(1200));
  const growth = r.plus(intDec(1)).pow(count);
  const emi = roundTo(principal.times(r).times(growth).dividedBy(growth.minus(intDec(1))), 2, "HALF_UP");
  for (let i = 1; i <= count; i += 1) {
    const interest = roundTo(balance.times(r), 2, "HALF_UP");
    const p = i === count ? balance : emi.minus(interest);
    if (p.isNegative()) throw new Error("The instalment does not cover the interest.");
    balance = balance.minus(p);
    out.push({ n: i, month: addMonths(firstMonth, i - 1), principal: p, interest, balanceAfter: balance });
  }
  return out;
}

export const totalOf = (rows: Instalment[], part: "principal" | "interest") => sum(rows.map((r) => r[part]));
