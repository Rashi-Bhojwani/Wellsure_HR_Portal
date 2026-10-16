import { Prisma } from "@prisma/client";

// Exact money (Phase 6, docs/plans/PHASE_6.md §5.3). Every rupee in payroll is a decimal.js value, never a JavaScript number:
//   - construction takes a string (or bigint, or another decimal), so a float cannot be passed in by accident;
//   - arithmetic runs at 40 significant digits, far beyond any salary, so nothing is lost between steps;
//   - rounding happens only where a rule names it, with the rule's mode and scale (roundTo), never as a side effect;
//   - anything stored in JSON or hashed is a canonical string (canonicalDecimal), never a JSON number.
// A source scan (payrollGuards.test.ts) fails on Number(), parseFloat() and friends anywhere in this module.

/** The payroll decimal type: Prisma's own Decimal (so values go to and from the database untouched), cloned at higher precision. */
export const Dec = Prisma.Decimal.clone({ precision: 40, rounding: Prisma.Decimal.ROUND_HALF_UP });
export type Money = InstanceType<typeof Dec>;

export const ZERO = new Dec("0");
export const HUNDRED = new Dec("100");

/** The only ways in. A float is a type error here, and a non-finite or malformed string throws. */
export function dec(value: string | bigint | Money | Prisma.Decimal): Money {
  // The type already refuses a number; this refuses one that arrives from untyped JSON at run time.
  if (typeof (value as unknown) === "number") throw new Error("dec() does not take a JavaScript number: money is built from strings, so a float can never get in");
  if (typeof value === "string") {
    if (!/^-?\d+(\.\d+)?$/.test(value.trim())) throw new Error(`"${value}" is not a decimal number`);
    return new Dec(value.trim());
  }
  return new Dec(value.toString());
}

/** A whole number such as a day count or a scale. Refuses anything that is not an integer. */
export function intDec(value: number): Money {
  if (!Number.isInteger(value)) throw new Error("intDec takes whole numbers only; money is never built from a float");
  return new Dec(String(value));
}

export type RoundingMode = "HALF_UP" | "HALF_EVEN" | "UP" | "DOWN" | "CEIL" | "FLOOR";
export const ROUNDING_MODES: readonly RoundingMode[] = ["HALF_UP", "HALF_EVEN", "UP", "DOWN", "CEIL", "FLOOR"];

const MODE: Record<RoundingMode, Prisma.Decimal.Rounding> = {
  HALF_UP: Dec.ROUND_HALF_UP,
  HALF_EVEN: Dec.ROUND_HALF_EVEN,
  UP: Dec.ROUND_UP, // away from zero
  DOWN: Dec.ROUND_DOWN, // towards zero
  CEIL: Dec.ROUND_CEIL, // towards +infinity
  FLOOR: Dec.ROUND_FLOOR, // towards -infinity
};

/** Round to `scale` decimal places with a named mode. The only place rounding happens. */
export function roundTo(value: Money, scale: number, mode: RoundingMode): Money {
  if (!Number.isInteger(scale) || scale < 0 || scale > 6) throw new Error("rounding scale must be a whole number from 0 to 6");
  return new Dec(value.toDecimalPlaces(scale, MODE[mode]).toString());
}

export function sum(values: Iterable<Money>): Money {
  let total = ZERO;
  for (const v of values) total = total.plus(v);
  return total;
}

/** `ratePercent` is a percentage as written in a rule ("12" means 12%), so it is divided by 100 here, exactly. */
export function percentOf(amount: Money, ratePercent: Money): Money {
  return amount.times(ratePercent).dividedBy(HUNDRED);
}

export function min(a: Money, b: Money): Money {
  return a.lessThan(b) ? a : b;
}
export function max(a: Money, b: Money): Money {
  return a.greaterThan(b) ? a : b;
}

/** The one string form of a decimal for storage in JSON and for hashing: plain digits, no exponent, no trailing zeros. */
export function canonicalDecimal(value: Money | Prisma.Decimal): string {
  return new Dec(value.toString()).toFixed();
}

/** Fixed-scale text for display and exports ("1234.50"). Rendering is the end of the line: nothing is computed from this string. */
export function fixed(value: Money, scale: number): string {
  return value.toFixed(scale, Dec.ROUND_HALF_UP);
}
