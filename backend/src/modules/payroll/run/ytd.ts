import { Prisma } from "@prisma/client";
import { financialYearOf, parseFinancialYearLabel } from "@shared/utils/financialYear";
import { businessToday } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { dec, fixed, ZERO, type Money } from "../money";

// P7-3 (docs/plans/PHASE_7.md §6): year to date, line by line, from runs in this system. Only FINALISED runs count (a draft never does), plus, for a payslip being
// built, the run it belongs to. Opening figures (A-3) are totals for tax, not lines, so they are not in these line totals; the screens say so.

const iso = (d: Date) => d.toISOString().slice(0, 10);

export interface YtdLine {
  code: string;
  label: string;
  kind: string;
  amount: Money;
}

/**
 * Per person: each line code's total over the financial year that contains `uptoCycleEnd`, from finalised runs whose cycle ends on or before it, and also
 * `includeRunId`'s lines (the run a payslip is being built from). Keyed by employee id, then by `${kind}|${code}`.
 */
export async function ytdLines(employeeIds: readonly string[], uptoCycleEnd: Date, includeRunId: string | null = null): Promise<Map<string, Map<string, YtdLine>>> {
  const fy = financialYearOf(iso(uptoCycleEnd));
  const out = new Map<string, Map<string, YtdLine>>();
  if (employeeIds.length === 0) return out;
  const runFilter: Prisma.PayrollRunWhereInput = {
    cycleEnd: { gte: new Date(`${fy.start}T00:00:00Z`), lte: uptoCycleEnd },
    OR: [{ status: "FINALISED" }, ...(includeRunId ? [{ id: includeRunId }] : [])],
  };
  const lines = await prisma.payrollRunLine.findMany({
    where: { employeeId: { in: [...employeeIds] }, kind: { in: ["EARNING", "DEDUCTION", "EMPLOYER_CONTRIBUTION"] }, run: runFilter },
    select: { employeeId: true, code: true, label: true, kind: true, amount: true, run: { select: { cycleEnd: true } } },
    orderBy: [{ run: { cycleEnd: "asc" } }],
  });
  for (const l of lines) {
    const mine = out.get(l.employeeId) ?? new Map<string, YtdLine>();
    const key = `${l.kind}|${l.code}`;
    const prev = mine.get(key);
    // The latest label wins (a head can be renamed during the year); the amounts are summed exactly.
    mine.set(key, { code: l.code, label: l.label, kind: l.kind, amount: (prev?.amount ?? ZERO).plus(dec(l.amount.toString())) });
    out.set(l.employeeId, mine);
  }
  return out;
}

/** The employee's own YTD report: every finalised month of the year, line by line, and the year's totals. Their own pay is theirs to see. */
export async function myYtdReport(employeeId: string, year?: string) {
  const fy = year ? parseFinancialYearLabel(year) : financialYearOf(iso(businessToday()));
  const lines = await prisma.payrollRunLine.findMany({
    where: { employeeId, kind: { in: ["EARNING", "DEDUCTION"] }, run: { status: "FINALISED", cycleEnd: { gte: new Date(`${fy.start}T00:00:00Z`), lte: new Date(`${fy.end}T00:00:00Z`) } } },
    select: { code: true, label: true, kind: true, amount: true, run: { select: { cycleEnd: true, cycleLabel: true } } },
    orderBy: [{ run: { cycleEnd: "asc" } }],
  });
  const months = [...new Map(lines.map((l) => [iso(l.run.cycleEnd), l.run.cycleLabel])).entries()].map(([end, label]) => ({ end, label }));
  const rows = new Map<string, { code: string; label: string; kind: string; byMonth: Record<string, string>; total: Money }>();
  for (const l of lines) {
    const key = `${l.kind}|${l.code}`;
    const r = rows.get(key) ?? { code: l.code, label: l.label, kind: l.kind, byMonth: {}, total: ZERO };
    const m = iso(l.run.cycleEnd);
    r.byMonth[m] = fixed(dec(r.byMonth[m] ?? "0").plus(dec(l.amount.toString())), 2);
    r.total = r.total.plus(dec(l.amount.toString()));
    r.label = l.label;
    rows.set(key, r);
  }
  const all = [...rows.values()].map((r) => ({ ...r, total: fixed(r.total, 2) }));
  const totalOf = (kind: string) => fixed(all.filter((r) => r.kind === kind).reduce((s, r) => s.plus(dec(r.total)), ZERO), 2);
  return { year: fy.label, months, earnings: all.filter((r) => r.kind === "EARNING"), deductions: all.filter((r) => r.kind === "DEDUCTION"), totals: { earnings: totalOf("EARNING"), deductions: totalOf("DEDUCTION") }, note: "From finished payroll runs in this system only. Pay before this system is not in these lines." };
}
