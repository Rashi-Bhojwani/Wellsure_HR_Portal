import { financialYearOf, monthsLeftInYear } from "@shared/utils/financialYear";
import { canonicalDecimal } from "../money";
import type { RuleContext } from "../rules/context";
import type { TaxIn } from "../run/types";
import { countedDeductions } from "./declarations";
import { missingForTds } from "./schema";
import { yearToDate } from "./projection";
import type { HeadLookup } from "./taxable";
import { taxYearForEngine } from "./years";

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * For a run with TDS_MODE PROJECTED: each person's tax inputs (the year's values, what counts under each section, the regime they chose or the year's default, and what has been paid and
 * deducted so far this financial year from finalised runs). Pins the tax year version live, so a Placeholder year makes the run a test and a change makes it stale. Null when TDS is off.
 */
export async function gatherTax(ctx: RuleContext, cycle: { start: Date; end: Date }, employeeIds: readonly string[], head: HeadLookup): Promise<Map<string, TaxIn> | null> {
  // A rule nothing depends on is not read, so it is not pinned: only a company that switched TDS on is judged on it.
  if (ctx.peek<string>("TDS_MODE") !== "PROJECTED") return null;
  ctx.rule("TDS_MODE");
  const fy = financialYearOf(iso(cycle.end)).label;
  const year = await taxYearForEngine(fy);
  if (year) ctx.addLivePin({ kind: "TAX_YEAR", key: fy, version: year.version, valueHash: year.valueHash });
  const values = year?.value ?? null;
  const missing = missingForTds(values);
  const sections = values?.sections?.value ?? [];
  const out = new Map<string, TaxIn>();
  for (const id of employeeIds) {
    const counted = await countedDeductions(id, fy, sections, iso(cycle.end));
    const ytd = await yearToDate(id, fy, iso(cycle.start), head);
    const defaultRegime = values?.defaultRegime?.value ?? null;
    out.set(id, {
      year: fy,
      missing,
      values,
      regime: counted.regime ?? defaultRegime,
      regimeSource: counted.regime ? "CHOSEN" : defaultRegime ? "DEFAULT" : null,
      deductions: counted.deductions,
      deductionBasis: counted.basis,
      declarationVersion: counted.declarationVersion,
      taxableSoFar: ytd.taxable,
      tdsSoFar: ytd.tds,
      monthsLeft: monthsLeftInYear(iso(cycle.end)),
    });
  }
  return out;
}

/** What goes into the run's fingerprint for a person's tax: change a declaration, a regime or what was paid and the world has moved. */
export const taxFingerprint = (t: TaxIn | undefined): unknown => (t ? [t.year, t.regime, t.deductionBasis, t.declarationVersion, t.deductions.map((d) => [d.section, d.amount]), canonicalDecimal(t.taxableSoFar), canonicalDecimal(t.tdsSoFar), t.monthsLeft, t.missing.length] : null);
