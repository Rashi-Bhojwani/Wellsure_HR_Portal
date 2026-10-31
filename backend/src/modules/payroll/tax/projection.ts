import { parseFinancialYearLabel } from "@shared/utils/financialYear";
import { prisma } from "../../../lib/prisma";
import { ZERO, dec, sum, type Money } from "../money";
import { splitTaxable, type HeadLookup, type TaxableLine } from "./taxable";

// What a person has earned this financial year so far (finalised runs only; a draft run never counts) and how a month's lines add up to taxable pay. Pure where it can be.
// Taxable is the pay head's own flag. A head whose flag is Not set cannot be counted, and the caller must stop and say so.

export interface YearToDate {
  taxable: Money;
  tds: Money;
  /** The months (cycle end dates) that were counted. */
  months: Array<{ cycleEnd: string; taxable: Money; tds: Money }>;
}

/** What finalised runs of the year, ended before `before`, paid this person: taxable pay and TDS already deducted. */
export async function yearToDate(employeeId: string, year: string, before: string, head: HeadLookup): Promise<YearToDate> {
  const fy = parseFinancialYearLabel(year);
  const lines = await prisma.payrollRunLine.findMany({
    where: { employeeId, run: { status: "FINALISED", cycleEnd: { gte: new Date(`${fy.start}T00:00:00Z`), lt: new Date(`${before}T00:00:00Z`), lte: new Date(`${fy.end}T00:00:00Z`) } } },
    select: { code: true, kind: true, source: true, amount: true, run: { select: { cycleEnd: true } } },
  });
  const byMonth = new Map<string, TaxableLine[]>();
  const tdsBy = new Map<string, Money>();
  for (const l of lines) {
    const month = l.run.cycleEnd.toISOString().slice(0, 10);
    if (l.source === "TDS") {
      tdsBy.set(month, (tdsBy.get(month) ?? ZERO).plus(dec(l.amount.toString())));
      continue;
    }
    byMonth.set(month, [...(byMonth.get(month) ?? []), { code: l.code, kind: l.kind, source: l.source, amount: dec(l.amount.toString()) }]);
  }
  const months = [...new Set([...byMonth.keys(), ...tdsBy.keys()])].sort().map((cycleEnd) => {
    const split = splitTaxable(byMonth.get(cycleEnd) ?? [], head);
    return { cycleEnd, taxable: split.recurring.plus(split.oneOff), tds: tdsBy.get(cycleEnd) ?? ZERO };
  });
  return { taxable: sum(months.map((m) => m.taxable)), tds: sum(months.map((m) => m.tds)), months };
}

