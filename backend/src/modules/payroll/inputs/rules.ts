import { payrollHash } from "../hash";
import { canonicalDecimal, dec } from "../money";

// Monthly Inputs, the pure part (docs/plans/STAGE_4_PLAN.md). Nothing here reads the database, so every rule is tested on its own.

/** How many whole-number digits a figure may have (up to 999,999,999,999) and how many after the point (the ledger holds six). */
const MAX_WHOLE_DIGITS = 12;
const MAX_FRACTION_DIGITS = 6;

export type AmountResult = { ok: true; value: string } | { ok: false; message: string };

/**
 * Reads a figure typed or uploaded as text. Exact: it is never a JavaScript number. Blank is not a figure (that is "nothing entered"); zero is. A figure is zero or more:
 * whether it is paid or taken off is the pay head's, not the sign's. Thousand separators and currency signs are refused rather than guessed at.
 */
export function parseAmountText(raw: string): AmountResult {
  const text = raw.trim();
  if (text === "") return { ok: false, message: "No figure. Leave the cell blank to enter nothing, or write 0." };
  if (text.startsWith("-")) return { ok: false, message: `"${text}" is negative. A figure is zero or more; the pay head says whether it is paid or taken off.` };
  if (!/^\d+(\.\d+)?$/.test(text)) return { ok: false, message: `"${text}" is not a figure. Write digits with an optional decimal point, with no commas or currency sign.` };
  const [whole = "", fraction = ""] = text.split(".");
  if (whole.replace(/^0+(?=\d)/, "").length > MAX_WHOLE_DIGITS) return { ok: false, message: `"${text}" is too large.` };
  if (fraction.length > MAX_FRACTION_DIGITS) return { ok: false, message: `"${text}" has more than ${MAX_FRACTION_DIGITS} decimal places.` };
  return { ok: true, value: canonicalDecimal(dec(text)) };
}

export type MonthState = "CLOSED" | "OPEN" | "CONFIRMED" | "LOCKED";

export interface MonthFacts {
  cycleOver: boolean;
  attendanceFinal: boolean;
  /** A payroll run for the month is waiting for a decision, approved, or final. */
  runUsesIt: boolean;
  /** A second director approved exactly the figures that stand now. */
  confirmed: boolean;
}

/**
 * closed    attendance for the month is not finalised (or the month is not over): the grid refuses entry and says why
 * open      attendance is finalised: figures may be entered
 * confirmed a different director approved these exact figures; any new entry returns the month to open
 * locked    a payroll run for the month is with an approver or final: nothing changes here any more
 */
export function monthState(f: MonthFacts): { state: MonthState; reason: string | null } {
  if (f.runUsesIt) return { state: "LOCKED", reason: "A payroll run for this month has been sent for approval or is final, so its figures no longer change. Unlock the period, or put a correction through an adjustment in a later month." };
  if (!f.cycleOver) return { state: "CLOSED", reason: "The month is not over yet, so its attendance cannot be final." };
  if (!f.attendanceFinal) return { state: "CLOSED", reason: "Attendance for this month is not finalised yet. Monthly Inputs open once it is." };
  return f.confirmed ? { state: "CONFIRMED", reason: null } : { state: "OPEN", reason: null };
}

export interface Cell {
  employeeId: string;
  head: string;
  /** Canonical decimal text. */
  amount: string;
}

/** The hash a month's confirmation is bound to: every entered figure, sorted. A blank cell is simply absent; a zero is present. */
export function inputsHash(cycleStart: string, cells: readonly Cell[]): string {
  const sorted = [...cells].sort((a, b) => (a.employeeId < b.employeeId ? -1 : a.employeeId > b.employeeId ? 1 : a.head < b.head ? -1 : a.head > b.head ? 1 : 0));
  return payrollHash({ t: "MONTHLY_INPUTS", cycleStart, cells: sorted.map((c) => [c.employeeId, c.head, canonicalDecimal(dec(c.amount))]) });
}

export interface LedgerRow {
  employeeId: string;
  head: string;
  amount: string | null;
  cleared: boolean;
}

/** Rows oldest first. The current figure of a cell is its newest row; a cleared cell has none. */
export function currentCells(rowsOldestFirst: readonly LedgerRow[]): Cell[] {
  const latest = new Map<string, LedgerRow>();
  for (const r of rowsOldestFirst) latest.set(`${r.employeeId}|${r.head}`, r);
  return [...latest.values()].flatMap((r) => (r.cleared || r.amount === null ? [] : [{ employeeId: r.employeeId, head: r.head, amount: r.amount }]));
}

export interface MissingInput {
  employeeId: string;
  head: string;
}

/** Every person in the run × every active flagged head with no figure entered. Zero counts as entered. */
export function missingInputs(employeeIds: readonly string[], heads: readonly string[], cells: readonly Cell[]): MissingInput[] {
  const have = new Set(cells.map((c) => `${c.employeeId}|${c.head}`));
  return employeeIds.flatMap((employeeId) => heads.filter((head) => !have.has(`${employeeId}|${head}`)).map((head) => ({ employeeId, head })));
}

/** The payroll months (cycle starts) from the one containing `from` to the one containing `till`, inclusive. `cycleStarts` is every cycle start, sorted. */
export function monthsBetween(cycleStarts: readonly string[], from: string, till: string): string[] {
  if (till < from) return [];
  const containing = (day: string): string | null => {
    let found: string | null = null;
    for (const s of cycleStarts) if (s <= day) found = s;
    return found;
  };
  const first = containing(from);
  const last = containing(till);
  if (!first || !last) return [];
  return cycleStarts.filter((s) => s >= first && s <= last);
}
