import { addCalendarDays } from "../../../lib/businessDate";
import { cycleForRules, loadCycleRules } from "../../../lib/attendanceCycle";
import { namesOn } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { ZERO, canonicalDecimal, dec, sum, type Money } from "../money";
import { RuleContext } from "../rules/context";
import { iso } from "./days";

// The variance report (docs/plans/PHASE_6.md §5.7): each person against the previous cycle's run, with the reasons it can know. The baseline is the most final run
// there is for that cycle, and the report says which: a draft baseline is not a closed month. The highlight thresholds are read live and are NOT pinned, because they
// only decide what is coloured, never a rupee; a Placeholder threshold must not turn a run into a test.

const STATUTORY = ["PF_EMPLOYEE", "ESI_EMPLOYEE", "PT", "LWF_EMPLOYEE"] as const;

export type VarianceTag = "JOINED" | "LEFT" | "SALARY_REVISED" | "LOP_CHANGED" | "ADJUSTMENT" | "ARREARS" | "ENCASHMENT" | "STATUTORY_CHANGE" | "HELD" | "NOT_CALCULATED" | "NOT_IN_THIS_RUN";

interface Figures {
  gross: Money;
  deductions: Money;
  net: Money;
}

export interface VarianceRow {
  employeeId: string;
  employeeCode: string;
  name: string;
  status: string;
  current: Figures | null;
  previous: Figures | null;
  change: Figures | null;
  percent: string | null;
  tags: VarianceTag[];
  flagged: boolean;
}

const figs = (i: { gross: { toString(): string }; deductions: { toString(): string }; netPay: { toString(): string } }): Figures => ({ gross: dec(i.gross.toString()), deductions: dec(i.deductions.toString()), net: dec(i.netPay.toString()) });
const HUNDRED_PERCENT = dec("100");

export async function computeVariance(runId: string) {
  const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
  if (!run) throw new HttpError(404, "No such payroll run.", "NOT_FOUND");
  const rules = await loadCycleRules();
  const previousCycle = cycleForRules(rules, addCalendarDays(run.cycleStart, -1));
  // At most one live run exists per cycle (a database index), so this is "the previous cycle's run": finalised if it has got that far, otherwise a draft, and the
  // report says which. A discarded, failed or never-calculated run is nothing to compare with.
  const baseline = await prisma.payrollRun.findFirst({ where: { cycleStart: previousCycle.start, cycleEnd: previousCycle.end, status: { in: ["FINALISED", "CALCULATED"] } } });

  const ctx = await RuleContext.load();
  const percentRule = ctx.peek<string>("VARIANCE_FLAG_PERCENT");
  const minRule = ctx.peek<string>("VARIANCE_FLAG_MIN_AMOUNT");
  const thresholds = { percent: percentRule ?? null, minAmount: minRule ?? null, set: percentRule !== undefined && minRule !== undefined };

  const [items, before] = await Promise.all([
    prisma.payrollRunItem.findMany({ where: { runId }, include: { employee: { select: { employeeCode: true } }, lines: true } }),
    baseline ? prisma.payrollRunItem.findMany({ where: { runId: baseline.id }, include: { employee: { select: { employeeCode: true } }, lines: true } }) : Promise.resolve([]),
  ]);
  const prev = new Map(before.map((i) => [i.employeeId, i]));
  const names = await namesOn([...new Set([...items.map((i) => i.employeeId), ...before.map((i) => i.employeeId)])], run.cycleEnd);
  const rows: VarianceRow[] = [];

  const flag = (change: Figures | null, previous: Figures | null): boolean => {
    if (!change || !thresholds.set) return false;
    const absolute = change.net.abs();
    if (absolute.lessThan(dec(minRule!))) return false;
    if (!previous || previous.net.isZero()) return !absolute.isZero();
    return absolute.times(HUNDRED_PERCENT).dividedBy(previous.net.abs()).greaterThanOrEqualTo(dec(percentRule!));
  };

  for (const cur of items) {
    const old = prev.get(cur.employeeId);
    const tags: VarianceTag[] = [];
    if (cur.status === "EXCLUDED") tags.push("NOT_CALCULATED");
    if (cur.status === "HELD") tags.push("HELD");
    if (cur.employedFrom && cur.employedFrom > run.cycleStart) tags.push("JOINED");
    if (cur.employedTo && cur.employedTo < run.cycleEnd) tags.push("LEFT");
    const oldLines = new Map((old?.lines ?? []).map((l) => [`${l.code}|${l.sourceRef ?? ""}`, l]));
    const hasNew = (source: string) => cur.lines.some((l) => l.source === source && !oldLines.has(`${l.code}|${l.sourceRef ?? ""}`));
    if (hasNew("ADJUSTMENT")) tags.push("ADJUSTMENT");
    if (hasNew("ARREARS")) tags.push("ARREARS");
    if (hasNew("ENCASHMENT")) tags.push("ENCASHMENT");
    if (old) {
      const salaryIds = (r: typeof cur) => ((r.inputs as { segments?: Array<{ salaryId: string }> }).segments ?? []).map((s) => s.salaryId).join(",");
      if (salaryIds(cur) !== salaryIds(old)) tags.push("SALARY_REVISED");
      if (!cur.lopDays.equals(old.lopDays)) tags.push("LOP_CHANGED");
      const stat = (r: typeof cur) => STATUTORY.map((code) => r.lines.filter((l) => l.code === code).reduce((a, l) => a.plus(dec(l.amount.toString())), ZERO).toFixed());
      if (stat(cur).join() !== stat(old).join() && cur.gross.equals(old.gross)) tags.push("STATUTORY_CHANGE");
    }
    const current = cur.status === "EXCLUDED" ? null : figs(cur);
    const previous = old && old.status !== "EXCLUDED" ? figs(old) : null;
    if (!current && !previous) continue; // nothing to compare either month: they are on the run's list of people left out, not here
    const change = current ? { gross: current.gross.minus(previous?.gross ?? ZERO), deductions: current.deductions.minus(previous?.deductions ?? ZERO), net: current.net.minus(previous?.net ?? ZERO) } : null;
    rows.push({
      employeeId: cur.employeeId,
      employeeCode: cur.employee.employeeCode,
      name: names.get(cur.employeeId) ?? cur.employee.employeeCode,
      status: cur.status,
      current,
      previous,
      change,
      percent: change && previous && !previous.net.isZero() ? canonicalDecimal(change.net.times(HUNDRED_PERCENT).dividedBy(previous.net.abs()).toDecimalPlaces(2)) : null,
      tags,
      flagged: flag(change, previous),
    });
  }
  // People who were paid last time and are not in this run at all.
  const here = new Set(items.map((i) => i.employeeId));
  for (const old of before) {
    if (here.has(old.employeeId) || old.status === "EXCLUDED") continue;
    const previous = figs(old);
    rows.push({ employeeId: old.employeeId, employeeCode: old.employee.employeeCode, name: names.get(old.employeeId) ?? old.employee.employeeCode, status: "ABSENT", current: null, previous, change: { gross: previous.gross.negated(), deductions: previous.deductions.negated(), net: previous.net.negated() }, percent: null, tags: ["NOT_IN_THIS_RUN"], flagged: flag({ gross: previous.gross.negated(), deductions: previous.deductions.negated(), net: previous.net.negated() }, previous) });
  }
  rows.sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));

  const totalOf = (list: Array<{ status: string; gross: { toString(): string }; deductions: { toString(): string }; netPay: { toString(): string } }>): Figures => {
    const calc = list.filter((i) => i.status !== "EXCLUDED");
    return { gross: sum(calc.map((i) => dec(i.gross.toString()))), deductions: sum(calc.map((i) => dec(i.deductions.toString()))), net: sum(calc.map((i) => dec(i.netPay.toString()))) };
  };
  const now = totalOf(items);
  const was = baseline ? totalOf(before) : null;
  return {
    cycle: { start: iso(run.cycleStart), end: iso(run.cycleEnd), label: run.cycleLabel },
    baseline: baseline ? { runId: baseline.id, status: baseline.status, final: baseline.status === "FINALISED", cycleLabel: baseline.cycleLabel } : null,
    thresholds,
    totals: { current: now, previous: was, change: was ? { gross: now.gross.minus(was.gross), deductions: now.deductions.minus(was.deductions), net: now.net.minus(was.net) } : null },
    rows,
  };
}

const fj = (f: Figures | null) => (f ? { gross: canonicalDecimal(f.gross), deductions: canonicalDecimal(f.deductions), net: canonicalDecimal(f.net) } : null);

export async function varianceJson(runId: string, q: { page: number; pageSize: number; changedOnly: boolean; flaggedOnly: boolean }) {
  const v = await computeVariance(runId);
  let rows = v.rows;
  if (q.changedOnly) rows = rows.filter((r) => r.tags.length > 0 || (r.change && !r.change.net.isZero()));
  if (q.flaggedOnly) rows = rows.filter((r) => r.flagged);
  const tagCounts: Record<string, number> = {};
  for (const r of v.rows) for (const t of r.tags) tagCounts[t] = (tagCounts[t] ?? 0) + 1;
  return {
    cycle: v.cycle,
    baseline: v.baseline,
    thresholds: v.thresholds,
    totals: { current: fj(v.totals.current), previous: fj(v.totals.previous), change: fj(v.totals.change) },
    tagCounts,
    flaggedCount: v.rows.filter((r) => r.flagged).length,
    total: rows.length,
    items: rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize).map((r) => ({ ...r, current: fj(r.current), previous: fj(r.previous), change: fj(r.change) })),
  };
}
