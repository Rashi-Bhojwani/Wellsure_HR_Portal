import { HttpError } from "../../../middleware/errorHandler";
import { canonicalDecimal, dec, HUNDRED, ZERO } from "../money";
import type { CompareOptions, CompareResult, Difference, PersonResult, Register } from "./types";

// The comparison itself: pure, exact (decimals, never floating point), and independent of where a register came from. People are matched by employee code; amounts by the label of their
// column (normalised: case, spaces and punctuation do not matter), with an alias map for labels that genuinely differ.

const PERCENT_PLACES = 2; // allow-number: a count of decimal places for display, not money

export const normalise = (label: string): string => label.toLowerCase().replace(/[^a-z0-9]+/g, "");

export function parseOptions(raw: { toleranceAmount?: string; tolerancePercent?: string; aliases?: Record<string, string> }): CompareOptions {
  const amount = (raw.toleranceAmount ?? "1").trim() || "1";
  const percent = (raw.tolerancePercent ?? "0").trim() || "0";
  if (!/^\d+(\.\d+)?$/.test(amount) || !/^\d+(\.\d+)?$/.test(percent)) throw new HttpError(400, "A tolerance is a plain number, for example 1 rupee or 0.5 percent.", "VALIDATION_ERROR");
  return { toleranceAmount: canonicalDecimal(dec(amount)), tolerancePercent: canonicalDecimal(dec(percent)), aliases: raw.aliases ?? {} };
}

function withinTolerance(a: ReturnType<typeof dec>, difference: ReturnType<typeof dec>, o: CompareOptions): boolean {
  const abs = difference.abs();
  if (abs.lessThanOrEqualTo(dec(o.toleranceAmount))) return true;
  const pct = dec(o.tolerancePercent);
  if (pct.greaterThan(ZERO) && !a.isZero() && abs.div(a.abs()).times(HUNDRED).lessThanOrEqualTo(pct)) return true;
  return false;
}

export function compareRegisters(ra: Register, rb: Register, options: CompareOptions): CompareResult {
  // Which column of B means which column of A.
  const aliasOf = new Map(Object.entries(options.aliases).map(([from, to]) => [normalise(from), normalise(to)]));
  const aByKey = new Map(ra.columns.map((c) => [normalise(c), c]));
  const bToA = new Map<string, string>(); // B's label → A's label
  const matched: string[] = [];
  const onlyB: string[] = [];
  for (const c of rb.columns) {
    const key = aliasOf.get(normalise(c)) ?? normalise(c);
    const target = aByKey.get(key);
    if (target) {
      bToA.set(c, target);
      matched.push(target);
    } else onlyB.push(c);
  }
  const matchedSet = new Set(matched);
  const onlyA = ra.columns.filter((c) => !matchedSet.has(c));

  const people: PersonResult[] = [];
  const onlyInA: CompareResult["onlyInA"] = [];
  const onlyInB: CompareResult["onlyInB"] = [];
  const totals = new Map<string, { a: ReturnType<typeof dec>; b: ReturnType<typeof dec> }>(matched.map((c) => [c, { a: ZERO, b: ZERO }]));
  let identical = 0;
  let matchedPeople = 0;
  for (const pa of ra.people.values()) {
    const pb = rb.people.get(pa.code);
    if (!pb) {
      onlyInA.push({ code: pa.code, name: pa.name });
      continue;
    }
    matchedPeople += 1;
    const bValues = new Map<string, string>();
    for (const [label, v] of pb.amounts) {
      const target = bToA.get(label);
      if (target) bValues.set(target, v);
    }
    const differences: Difference[] = [];
    for (const label of matched) {
      const a = pa.amounts.get(label);
      const b = bValues.get(label);
      const av = a === undefined ? ZERO : dec(a);
      const bv = b === undefined ? ZERO : dec(b);
      const t = totals.get(label)!;
      t.a = t.a.plus(av);
      t.b = t.b.plus(bv);
      const d = bv.minus(av);
      if (d.isZero()) continue;
      differences.push({
        label,
        a: a ?? null,
        b: b ?? null,
        difference: canonicalDecimal(d),
        percent: av.isZero() ? null : canonicalDecimal(d.div(av.abs()).times(HUNDRED).toDecimalPlaces(PERCENT_PLACES)),
        flagged: !withinTolerance(av, d, options),
      });
    }
    if (differences.length === 0) identical += 1;
    else people.push({ code: pa.code, name: pa.name ?? pb.name, differences, flagged: differences.some((x) => x.flagged) });
  }
  for (const pb of rb.people.values()) if (!ra.people.has(pb.code)) onlyInB.push({ code: pb.code, name: pb.name });

  return {
    a: { label: ra.label, people: ra.people.size, columns: ra.columns, ignoredColumns: ra.ignoredColumns },
    b: { label: rb.label, people: rb.people.size, columns: rb.columns, ignoredColumns: rb.ignoredColumns },
    options,
    summary: { matchedPeople, identical, differing: people.length, flagged: people.filter((p) => p.flagged).length, onlyInA: onlyInA.length, onlyInB: onlyInB.length },
    people: people.sort((x, y) => Number(y.flagged) - Number(x.flagged) || x.code.localeCompare(y.code)), // allow-number: flagged people (true) sort before the others
    onlyInA,
    onlyInB,
    columns: { matched, onlyInA: onlyA, onlyInB: onlyB },
    totals: matched.map((label) => ({ label, a: canonicalDecimal(totals.get(label)!.a), b: canonicalDecimal(totals.get(label)!.b), difference: canonicalDecimal(totals.get(label)!.b.minus(totals.get(label)!.a)) })),
  };
}
