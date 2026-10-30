import { addCalendarDays } from "../../../lib/businessDate";
import { cycleForRules, type Cycle, type CycleRule } from "../../../lib/attendanceCycle";
import { payrollLockedBetween } from "../../../lib/effectiveDating";
import { HttpError } from "../../../middleware/errorHandler";
import { ZERO, canonicalDecimal, roundTo, sum, type Money } from "../money";
import type { RoundingRule } from "./breakup";

// Arrears on a back-dated salary revision (docs/plans/PHASE_6.md §14B). The payroll period is the attendance cycle. A revision dated inside a cycle that
// payroll has locked keeps its true date on the salary timeline, the closed cycle is never rewritten, and what it owes is paid as arrears in the next run:
// one pending adjustment per person per locked cycle, with the breakdown by component.
//
//   arrears for a cycle = for each line, (new amount - old amount) x the share of the cycle the person was actually paid
//
// "The share they were actually paid" is what the finalised run recorded: paid days over the days the month counts as, for a line that pro-rates with paid
// days, and all-or-nothing for a line that does not. That record belongs to the payroll run (P6-3, run/providers.ts registers the reader of it). Until a run
// has been finalised for the month, a revision that needs arrears is REFUSED with a message that says it is waiting on payroll runs and that the revision
// itself is fine: arrears are never guessed.

export interface PaidShare {
  /** Days the person was paid within the part of the cycle the revision covers. */
  paid: Money;
  /** Days the month counts as for them in that cycle (the pay-days basis the run used). */
  basis: Money;
}

export interface ArrearsBasisProvider {
  /** What the finalised run paid this person for [from, to] inside `cycle`; null if the run has no record of them. */
  paidShare(employeeId: string, cycle: { start: Date; end: Date }, from: Date, to: Date): Promise<PaidShare | null>;
}

let provider: ArrearsBasisProvider | null = null;
export function setArrearsBasisProvider(p: ArrearsBasisProvider | null): void {
  provider = p;
}
export function getArrearsBasisProvider(): ArrearsBasisProvider | null {
  return provider;
}

/**
 * What `amount` comes to at a share, worked out as amount x paid / basis in one division, so that a share like 16/31 loses nothing before the rounding rule
 * is applied. A line that does not pro-rate is the whole amount if the person was paid at all, and nothing if not.
 */
export function applyShare(amount: Money, prorates: boolean, share: PaidShare): Money {
  if (!prorates) return share.paid.greaterThan(ZERO) ? amount : ZERO;
  if (share.basis.isZero()) throw new HttpError(409, "The pay-days basis for that month is zero, so a share of it cannot be worked out.", "ARREARS_BASIS_INVALID");
  return amount.times(share.paid).dividedBy(share.basis);
}

export interface ArrearsLine {
  component: string;
  /** Signed: positive is owed to the person, negative is owed back. */
  amount: Money;
}

export interface CycleArrears {
  /** Heads whose new-minus-old was NOT paid because arrear-on-arrear is off and they are worked out from another head. Shown so nobody is surprised. */
  leftOut?: string[];
  cycleStart: Date;
  cycleEnd: Date;
  cycleLabel: string;
  lines: ArrearsLine[];
  total: Money;
}

export interface ArrearsInput {
  employeeId: string;
  effectiveFrom: Date;
  /** The monthly amount per component the person was paid under (empty when they had no salary yet). */
  old: ReadonlyMap<string, Money>;
  /** The monthly amount per component the revision sets. */
  next: ReadonlyMap<string, Money>;
  /** Whether each component pro-rates with paid days (read from the component version each side pinned). */
  prorates: ReadonlyMap<string, boolean>;
  lockedCycles: readonly Cycle[];
  rounding: RoundingRule & { mode: Exclude<RoundingRule["mode"], "NONE"> };
  provider: ArrearsBasisProvider;
  /**
   * Heads that are worked out from another head (a percentage or formula of it, a table keyed by it, or the balance). With arrear-on-arrear ON they get arrears
   * like any head, because their new amount already includes the base head's rise; OFF, they get none and are reported as left out. Absent means ON.
   */
  dependentHeads?: ReadonlySet<string>;
}

/** The arrears a revision owes, cycle by cycle. A cycle where the lines cancel out (or nothing changed) owes nothing and is left out. */
export async function computeArrears(input: ArrearsInput): Promise<CycleArrears[]> {
  const out: CycleArrears[] = [];
  const codes = [...new Set([...input.old.keys(), ...input.next.keys()])].sort();
  for (const cycle of input.lockedCycles) {
    const from = cycle.start > input.effectiveFrom ? cycle.start : input.effectiveFrom;
    if (from > cycle.end) continue; // the revision starts after this cycle
    const share = await input.provider.paidShare(input.employeeId, { start: cycle.start, end: cycle.end }, from, cycle.end);
    if (!share) {
      throw new HttpError(409, `${cycle.label} is closed, but there is no finalised payroll run on record showing what this person was paid in it, and arrears are worked out from what was actually paid. The revision itself is fine: it is waiting only on payroll runs being finalised for that month.`, "ARREARS_BASIS_UNAVAILABLE", { cycle: cycle.label, employeeId: input.employeeId });
    }
    const lines: ArrearsLine[] = [];
    const leftOut: string[] = [];
    for (const component of codes) {
      if (input.dependentHeads?.has(component)) {
        if (!(input.next.get(component) ?? ZERO).minus(input.old.get(component) ?? ZERO).isZero()) leftOut.push(component);
        continue;
      }
      const diff = (input.next.get(component) ?? ZERO).minus(input.old.get(component) ?? ZERO);
      if (diff.isZero()) continue;
      const amount = roundTo(applyShare(diff, input.prorates.get(component) ?? true, share), input.rounding.scale, input.rounding.mode);
      if (!amount.isZero()) lines.push({ component, amount });
    }
    const total = sum(lines.map((l) => l.amount));
    if (lines.length === 0 || total.isZero()) continue;
    out.push({ cycleStart: cycle.start, cycleEnd: cycle.end, cycleLabel: cycle.label, lines, total, ...(leftOut.length ? { leftOut } : {}) });
  }
  return out;
}

/**
 * The payroll cycles from the one containing `effectiveFrom` up to the one containing `today` that payroll has locked. A revision dated today or later
 * touches none; one dated inside an open cycle touches none either (the next run simply uses the new salary).
 */
export async function lockedCyclesFrom(rules: CycleRule[], effectiveFrom: Date, today: Date): Promise<Cycle[]> {
  const out: Cycle[] = [];
  if (effectiveFrom > today) return out;
  let cycle = cycleForRules(rules, effectiveFrom);
  for (;;) {
    if ((await payrollLockedBetween(cycle.start, cycle.end)).locked) out.push(cycle);
    if (cycle.end >= today) break;
    cycle = cycleForRules(rules, addCalendarDays(cycle.end, 1));
  }
  return out;
}

export const arrearsToJson = (c: CycleArrears) => ({ cycleStart: c.cycleStart.toISOString().slice(0, 10), cycleEnd: c.cycleEnd.toISOString().slice(0, 10), total: canonicalDecimal(c.total), lines: c.lines.map((l) => ({ component: l.component, amount: canonicalDecimal(l.amount) })), ...(c.leftOut ? { leftOut: c.leftOut } : {}) });
