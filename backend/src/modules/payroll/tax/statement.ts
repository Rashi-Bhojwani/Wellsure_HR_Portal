import { financialYearOf, monthsLeftInYear, parseFinancialYearLabel } from "@shared/utils/financialYear";
import { businessToday } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { canonicalDecimal } from "../money";
import { keysIn, loadItems, summarise } from "../items";
import type { ComponentValue } from "../salary/schemas";
import { compareRegimes } from "./declarations";
import { monthlyTds } from "./engine";
import { yearToDate } from "./projection";
import type { HeadLookup } from "./taxable";
import { taxYearForEngine } from "./years";

// The IT statement: a person's own year of income tax, month by month, with the two regimes side by side (docs/plans/STAGE_7_PLAN.md, P7-3). Months already paid come from finalised
// runs; the months left are a projection at this month's recurring pay, and are labelled as one. Every figure is a draft while the tax year is not confirmed.

const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function statementFor(employeeId: string, fyRaw?: string) {
  const today = iso(businessToday());
  let fy: string;
  try {
    fy = fyRaw ? parseFinancialYearLabel(fyRaw).label : financialYearOf(today).label;
  } catch (err) {
    throw new HttpError(400, (err as Error).message, "VALIDATION_ERROR");
  }
  const { start, end } = parseFinancialYearLabel(fy);
  const comparison = await compareRegimes(employeeId, fy);
  const data = await loadItems("COMPONENT");
  const current = new Map(keysIn(data).map((k) => [k, summarise(data, k).current?.value as ComponentValue | undefined]));
  const head: HeadLookup = (code) => current.get(code);
  const paid = await yearToDate(employeeId, fy, iso(new Date(Date.UTC(parseFinancialYearLabel(fy).startYear + 1, 3, 1))), head); // up to the end of the year: only finalised months exist
  const year = await taxYearForEngine(fy);
  const chosen = comparison.chosen ?? comparison.defaultRegime;
  const months = paid.months.map((m) => ({ month: m.cycleEnd, kind: "PAID" as const, taxablePay: canonicalDecimal(m.taxable), tds: canonicalDecimal(m.tds) }));
  // What is left of the chosen regime's tax, spread over the months left (the same arithmetic the run uses, so the statement and the next payslip agree).
  let toCome: { monthsLeft: number; remaining: string; perMonth: string } | null = null;
  if (comparison.available && chosen && year && today >= start && today <= end) {
    const monthsLeft = monthsLeftInYear(today);
    const r = monthlyTds({ year: year.value, annualTax: comparison.results[chosen]!.annualTax, deductedSoFar: canonicalDecimal(paid.tds), monthsLeft });
    toCome = { monthsLeft, remaining: r.remaining, perMonth: r.tds };
  }
  const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { employeeCode: true } });
  return {
    year: fy,
    employeeCode: employee?.employeeCode ?? "",
    draft: comparison.draft,
    watermark: comparison.draft ? "DRAFT: the tax values for this year have not been confirmed by a second director" : null,
    chosenRegime: comparison.chosen,
    defaultRegime: comparison.defaultRegime,
    available: comparison.available,
    missing: comparison.missing,
    basis: comparison.basis,
    taxablePayProjected: comparison.taxablePay,
    regimes: comparison.results,
    paidSoFar: { taxable: canonicalDecimal(paid.taxable), tds: canonicalDecimal(paid.tds), months },
    toCome,
    note: "Pay from before this system, and marginal relief, are not counted. Months left are a projection at this month's recurring pay.",
  };
}
