import { Prisma } from "@prisma/client";
import { dec, roundTo, type RoundingMode } from "../payroll/money";

// D-37 item 5 (docs/plans/D37_DEFAULTS.md): how much leave accrues in the month of leaving. Pure, so the tests can check it against an independent model.
//   NONE                  → nothing;
//   FULL_MONTH            → the month's full accrual;
//   PRO_RATA_DAYS_WORKED  → full × days worked ÷ days in the month: applied as it is when exact to two decimals; otherwise rounded by the owners' pro-rata
//                           rounding, and while that is Not set the month waits (nothing is changed);
//   FULL_IF_MIN_DAYS      → the full accrual if at least N days were worked, else nothing.
// Zero days worked accrues nothing under every option except FULL_MONTH.

export type LeavingRule = { mode: "NONE" | "FULL_MONTH" | "PRO_RATA_DAYS_WORKED" } | { mode: "FULL_IF_MIN_DAYS"; minDays: number };
export type LeavingTarget = { days: Prisma.Decimal; waiting: null } | { days: null; waiting: string };

export function leavingMonthTarget(input: { rule: LeavingRule; full: Prisma.Decimal; daysWorked: number; daysInMonth: number; rounding: { mode: RoundingMode; scale: number } | null }): LeavingTarget {
  const { rule, full, daysWorked, daysInMonth } = input;
  const zero = new Prisma.Decimal(0);
  if (rule.mode === "NONE") return { days: zero, waiting: null };
  if (rule.mode === "FULL_MONTH") return { days: full, waiting: null };
  if (rule.mode === "FULL_IF_MIN_DAYS") return { days: daysWorked >= rule.minDays ? full : zero, waiting: null };
  // Zero days worked gives exactly 0 here (exact to two decimals), so it needs no separate case.
  const exact = dec(full.toString()).times(daysWorked).dividedBy(daysInMonth);
  if (exact.times(100).isInteger()) return { days: new Prisma.Decimal(exact.toString()), waiting: null }; // allow-number: two decimals of a day
  if (!input.rounding) return { days: null, waiting: `${exact.toDecimalPlaces(6).toString()} days needs rounding, and the pro-rata rounding is Not set` };
  return { days: new Prisma.Decimal(roundTo(exact, input.rounding.scale, input.rounding.mode).toString()), waiting: null };
}

/** Days worked in the month of leaving: from the 1st (or the date of joining, if later) to the last working day, inclusive; never below zero. */
export function daysWorkedInLeavingMonth(dateOfJoining: Date, lastWorkingDate: Date): { daysWorked: number; daysInMonth: number; monthStart: Date } {
  const y = lastWorkingDate.getUTCFullYear();
  const m = lastWorkingDate.getUTCMonth();
  const monthStart = new Date(Date.UTC(y, m, 1));
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const from = dateOfJoining > monthStart ? dateOfJoining : monthStart;
  const daysWorked = Math.max(0, Math.round((lastWorkingDate.getTime() - from.getTime()) / 86_400_000) + 1); // allow-number: milliseconds in a day
  return { daysWorked, daysInMonth, monthStart };
}
