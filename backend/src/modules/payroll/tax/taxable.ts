import { ZERO, dec, type Money } from "../money";
import type { ComponentValue } from "../salary/schemas";

// The pure part of taxable pay (no database): how a month's lines add up to taxable pay, and the year's projection from them. Taxable is the pay head's own flag; a head whose flag is Not set cannot be
// counted, and the caller must stop and say so.

export interface TaxableLine {
  code: string;
  kind: "EARNING" | "DEDUCTION" | "EMPLOYER_CONTRIBUTION" | "ROUNDING";
  source: string;
  amount: Money;
}
export type HeadLookup = (code: string) => Pick<ComponentValue, "type" | "taxable"> | undefined;

/** Lines that are recurring pay (taxed every month at the run rate); everything else taxable is a one-off and is taxed in the month it is paid. */
export const RECURRING_SOURCES = ["COMPONENT"] as const;

export interface TaxableSplit {
  recurring: Money;
  oneOff: Money;
  /** Pay heads whose "taxable" answer is Not set: the figure cannot be trusted until they are answered. */
  notSet: string[];
}

/**
 * A pay line counts as taxable pay when it belongs to an earning head the owners flagged taxable. An earning line adds; a deduction line of an earning head (a negative figure that took
 * pay back) takes off. Deduction heads (an advance recovered, PF, PT) are not income and count for nothing here.
 */
export function splitTaxable(lines: readonly TaxableLine[], head: HeadLookup): TaxableSplit {
  let recurring = ZERO;
  let oneOff = ZERO;
  const notSet = new Set<string>();
  for (const l of lines) {
    if (l.kind !== "EARNING" && l.kind !== "DEDUCTION") continue;
    const h = head(l.code);
    if (!h || h.type !== "EARNING") continue;
    if (h.taxable === null) {
      notSet.add(l.code);
      continue;
    }
    if (!h.taxable) continue;
    const signed = l.kind === "EARNING" ? l.amount : l.amount.negated();
    if ((RECURRING_SOURCES as readonly string[]).includes(l.source)) recurring = recurring.plus(signed);
    else oneOff = oneOff.plus(signed);
  }
  return { recurring, oneOff, notSet: [...notSet].sort() };
}

/** This year's taxable pay: what was already paid, the one-offs of this month, and this month's recurring pay carried to every month that is left, this one included. */
export function projectTaxablePay(input: { paidSoFar: Money; recurring: Money; oneOff: Money; monthsLeft: number }): Money {
  return input.paidSoFar.plus(input.oneOff).plus(input.recurring.times(dec(String(input.monthsLeft))));
}

