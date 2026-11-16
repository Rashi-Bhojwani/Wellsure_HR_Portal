import { canonicalDecimal, dec, ZERO, type Money } from "../money";

// Stage 8 (docs/plans/STAGE_8_PLAN.md): the parallel-run comparison, a pure function so it can be tested against an independent reference. People are matched by
// employee number only. Every mapped head, the three totals and the days are compared; money within the director's allowance counts as a match, days compare
// exactly. A "likely cause" is given only where the data proves it (a head on one side only, LOP days differing, a person on one side only); otherwise none.

export interface SidePerson {
  code: string;
  days: { workdays: string | null; lop: string | null };
  totals: { gross: string | null; deductions: string | null; net: string | null };
  heads: Record<string, string>;
}
/** greytHR column → the portal head it is compared with, or null when it has none (it is then a head only in greytHR). */
export type HeadMapping = Record<string, string | null>;

export interface CompareLine {
  item: string;
  kind: "HEAD" | "TOTAL" | "DAYS";
  greythr: string | null;
  portal: string | null;
  difference: string | null;
  higher: "GREYTHR" | "PORTAL" | null;
  matched: boolean;
  hint: string | null;
}
export interface ComparePerson {
  code: string;
  side: "BOTH" | "GREYTHR_ONLY" | "PORTAL_ONLY";
  matched: boolean;
  hint: string | null;
  lines: CompareLine[];
}
export interface CompareTotals {
  item: string;
  greythr: string;
  portal: string;
  difference: string;
}
export interface CompareResult {
  allowance: string;
  people: ComparePerson[];
  heads: { onlyInGreythr: string[]; onlyInPortal: string[]; compared: Array<{ portal: string; label: string; greythr: string[] }> };
  totals: CompareTotals[];
  overallNetDifference: string;
  counts: { matchedPeople: number; peopleWithDifferences: number; greythrOnly: number; portalOnly: number; differences: number };
}

const c = (m: Money) => canonicalDecimal(m);
const add = (a: string | null | undefined, b: Money) => (a == null ? b : b.plus(dec(a)));

function line(item: string, kind: CompareLine["kind"], g: string | null, p: string | null, allowance: Money, hint: string | null = null): CompareLine {
  const gv = dec(g ?? "0");
  const pv = dec(p ?? "0");
  const diff = pv.minus(gv);
  const within = kind === "DAYS" ? diff.isZero() : diff.abs().lte(allowance);
  return { item, kind, greythr: g, portal: p, difference: diff.isZero() ? "0" : c(diff), higher: diff.isZero() ? null : diff.isPositive() ? "PORTAL" : "GREYTHR", matched: within, hint: within ? null : hint };
}

export function compareStatements(greythr: SidePerson[], portal: SidePerson[], mapping: HeadMapping, portalLabels: Record<string, string>, allowanceText: string): CompareResult {
  const allowance = dec(allowanceText);
  const gBy = new Map(greythr.map((p) => [p.code, p]));
  const pBy = new Map(portal.map((p) => [p.code, p]));
  const gHeads = [...new Set(greythr.flatMap((p) => Object.keys(p.heads)))];
  const pHeads = [...new Set(portal.flatMap((p) => Object.keys(p.heads)))];
  const targets = new Map<string, string[]>(); // portal head → the greytHR columns compared with it
  for (const h of gHeads) {
    const t = mapping[h];
    if (t) targets.set(t, [...(targets.get(t) ?? []), h]);
  }
  const onlyInGreythr = gHeads.filter((h) => !mapping[h]);
  const onlyInPortal = pHeads.filter((h) => !targets.has(h));
  const labelOf = (code: string) => portalLabels[code] ?? code;

  const people: ComparePerson[] = [];
  const codes = [...new Set([...gBy.keys(), ...pBy.keys()])].sort();
  for (const code of codes) {
    const g = gBy.get(code);
    const p = pBy.get(code);
    if (!g || !p) {
      const only = (g ?? p)!;
      const side = g ? "GREYTHR_ONLY" : "PORTAL_ONLY";
      const v = (x: string | null) => (g ? { g: x, p: null } : { g: null, p: x });
      const lines = [line("Net pay", "TOTAL", v(only.totals.net).g, v(only.totals.net).p, allowance), line("Gross", "TOTAL", v(only.totals.gross).g, v(only.totals.gross).p, allowance)];
      people.push({ code, side, matched: false, hint: g ? "Only in greytHR: check the portal's joiners, leavers and Not on Payroll list." : "Only in the portal: check greytHR's joiners, leavers and people left out of its run.", lines });
      continue;
    }
    const lines: CompareLine[] = [];
    for (const [target, cols] of [...targets.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const gSum = cols.some((col) => g.heads[col] != null) ? c(cols.reduce((s, col) => add(g.heads[col], s), ZERO)) : null;
      lines.push(line(labelOf(target), "HEAD", gSum ?? "0", p.heads[target] ?? "0", allowance));
    }
    for (const h of onlyInGreythr) if (g.heads[h] != null && !dec(g.heads[h]!).isZero()) lines.push(line(h, "HEAD", g.heads[h]!, null, allowance, "This head exists only in greytHR: no portal pay head is compared with it."));
    for (const h of onlyInPortal) if (p.heads[h] != null && !dec(p.heads[h]!).isZero()) lines.push(line(labelOf(h), "HEAD", null, p.heads[h]!, allowance, "This head exists only in the portal: no greytHR column is compared with it."));
    lines.push(line("Gross", "TOTAL", g.totals.gross, p.totals.gross, allowance));
    lines.push(line("Total deductions", "TOTAL", g.totals.deductions, p.totals.deductions, allowance));
    lines.push(line("Net pay", "TOTAL", g.totals.net, p.totals.net, allowance));
    lines.push(line("Days paid", "DAYS", g.days.workdays, p.days.workdays, allowance));
    lines.push(line("LOP days", "DAYS", g.days.lop, p.days.lop, allowance, `LOP days differ: greytHR ${g.days.lop ?? "0"}, the portal ${p.days.lop ?? "0"}.`));
    people.push({ code, side: "BOTH", matched: lines.every((l) => l.matched), hint: null, lines });
  }

  const sum = (side: SidePerson[], pick: (x: SidePerson) => string | null | undefined) => side.reduce((s, x) => add(pick(x), s), ZERO);
  const totals: CompareTotals[] = [];
  const total = (item: string, gT: Money, pT: Money) => totals.push({ item, greythr: c(gT), portal: c(pT), difference: c(pT.minus(gT)) });
  for (const [target, cols] of [...targets.entries()].sort((a, b) => a[0].localeCompare(b[0]))) total(labelOf(target), cols.reduce((s, col) => s.plus(sum(greythr, (x) => x.heads[col])), ZERO), sum(portal, (x) => x.heads[target]));
  for (const h of onlyInGreythr) total(h, sum(greythr, (x) => x.heads[h]), ZERO);
  for (const h of onlyInPortal) total(labelOf(h), ZERO, sum(portal, (x) => x.heads[h]));
  total("Gross", sum(greythr, (x) => x.totals.gross), sum(portal, (x) => x.totals.gross));
  total("Total deductions", sum(greythr, (x) => x.totals.deductions), sum(portal, (x) => x.totals.deductions));
  total("Net pay", sum(greythr, (x) => x.totals.net), sum(portal, (x) => x.totals.net));
  const net = totals.at(-1)!;

  const both = people.filter((x) => x.side === "BOTH");
  return {
    allowance: c(allowance),
    people,
    heads: { onlyInGreythr, onlyInPortal, compared: [...targets.entries()].map(([portalHead, cols]) => ({ portal: portalHead, label: labelOf(portalHead), greythr: cols })) },
    totals,
    overallNetDifference: net.difference,
    counts: {
      matchedPeople: both.filter((x) => x.matched).length,
      peopleWithDifferences: both.filter((x) => !x.matched).length,
      greythrOnly: people.filter((x) => x.side === "GREYTHR_ONLY").length,
      portalOnly: people.filter((x) => x.side === "PORTAL_ONLY").length,
      differences: both.reduce((n, x) => n + x.lines.filter((l) => !l.matched).length, 0),
    },
  };
}

/** Header → portal head, matched only where the names are the same once case, spaces and punctuation are ignored. Exported for the test. */
export function autoMapping(greythrHeads: string[], portalHeads: Array<{ code: string; label: string }>): HeadMapping {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const out: HeadMapping = {};
  for (const h of greythrHeads) {
    const hits = portalHeads.filter((p) => norm(p.label) === norm(h) || norm(p.code) === norm(h));
    out[h] = hits.length === 1 ? hits[0]!.code : null; // two candidates: a director chooses
  }
  return out;
}
