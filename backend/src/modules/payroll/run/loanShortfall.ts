import { HUNDRED, ZERO, canonicalDecimal, dec, roundTo, sum, type Money } from "../money";

// D-37 item 4 (docs/plans/D37_DEFAULTS.md): loan instalments against net pay. Pure, so the tests can check it against an independent model.
//
// After every other line, what is left for loan instalments is gross less every other deduction, and, when the directors set a limit, no more than that percentage of gross
// less every other deduction; never below zero; whole paise (rounded down, so a recovery never takes a fraction more than is there). Each instalment, in order:
//   fits            → recovered in full;
//   does not fit    → the type's rule: STOP_RUN recovers nothing and blocks the run (naming the loan); SKIP_AND_CARRY recovers nothing, it stays owed for the next run,
//                     with a warning naming the loan; PARTIAL_AND_CARRY recovers what is left and carries the rest, with a warning naming the loan.
// So net pay is never pushed below zero by a loan.

export type ShortfallRule = "STOP_RUN" | "SKIP_AND_CARRY" | "PARTIAL_AND_CARRY";
export interface LoanInstalmentIn {
  adjustmentId: string;
  amount: Money;
  loanId: string;
  typeKey: string;
  rule: ShortfallRule;
}
export interface ShortfallDecision {
  adjustmentId: string;
  loanId: string;
  typeKey: string;
  rule: ShortfallRule;
  due: string;
  recovered: string;
  carried: string;
}

export function applyLoanShortfall(input: { gross: Money; otherDeductions: Money; instalments: readonly LoanInstalmentIn[]; maxPercent: Money | null }): { recovered: Map<string, Money>; decisions: ShortfallDecision[]; blocking: ShortfallDecision[]; room: Money } {
  let room = input.gross.minus(input.otherDeductions);
  if (input.maxPercent) {
    const cap = input.gross.times(input.maxPercent).dividedBy(HUNDRED).minus(input.otherDeductions);
    if (cap.lessThan(room)) room = cap;
  }
  if (room.isNegative()) room = ZERO;
  room = roundTo(room, 2, "DOWN");
  const startRoom = room;
  const recovered = new Map<string, Money>();
  const decisions: ShortfallDecision[] = [];
  const blocking: ShortfallDecision[] = [];
  for (const i of input.instalments) {
    if (i.amount.lessThanOrEqualTo(room)) {
      recovered.set(i.adjustmentId, i.amount);
      room = room.minus(i.amount);
      continue;
    }
    const take = i.rule === "PARTIAL_AND_CARRY" ? room : ZERO;
    recovered.set(i.adjustmentId, take);
    room = room.minus(take);
    const d: ShortfallDecision = { adjustmentId: i.adjustmentId, loanId: i.loanId, typeKey: i.typeKey, rule: i.rule, due: canonicalDecimal(i.amount), recovered: canonicalDecimal(take), carried: canonicalDecimal(i.amount.minus(take)) };
    decisions.push(d);
    if (i.rule === "STOP_RUN") blocking.push(d);
  }
  return { recovered, decisions, blocking, room: startRoom.minus(sum([...recovered.values()])) };
}

/** The decisions of a calculated item (stored in its inputs), for the finaliser. */
export function decisionsOf(inputs: Record<string, unknown>): ShortfallDecision[] {
  const v = inputs.loanShortfall;
  return Array.isArray(v) ? (v as ShortfallDecision[]).map((d) => ({ ...d, recovered: canonicalDecimal(dec(d.recovered)), carried: canonicalDecimal(dec(d.carried)) })) : [];
}
