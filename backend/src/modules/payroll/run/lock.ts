import { prisma } from "../../../lib/prisma";

// The real payroll lock (docs/plans/PHASE_6.md §14F). A cycle is locked while the latest row of `payroll_period_locks` for it is a FINALISE. This is what
// lib/effectiveDating's lock hook asks before any history change, cancellation or separation dated inside a payroll period; a locked day refuses it with PAYROLL_LOCKED.

/** Whether a calendar day sits inside a finalised payroll cycle, and which. Cycles can overlap if the cycle dates were ever changed, so every one that covers the day is looked at. */
export async function payrollLockOn(day: Date): Promise<{ locked: boolean; period?: string }> {
  const rows = await prisma.payrollPeriodLock.findMany({ where: { cycleStart: { lte: day }, cycleEnd: { gte: day } }, orderBy: { seq: "asc" }, select: { cycleStart: true, cycleEnd: true, cycleLabel: true, action: true } });
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) latest.set(`${r.cycleStart.toISOString()}|${r.cycleEnd.toISOString()}`, r);
  for (const r of latest.values()) if (r.action === "FINALISE") return { locked: true, period: r.cycleLabel };
  return { locked: false };
}

type Stage = "SUBMITTED" | "APPROVED" | "FINALISED";
const ORDER: Stage[] = ["SUBMITTED", "APPROVED", "FINALISED"];

/** Whether payroll has relied on the attendance of [from, to]: a run for an overlapping cycle is waiting for a decision, approved, or final. The furthest stage wins. */
export async function payrollConsumption(from: Date, to: Date): Promise<{ consumed: boolean; period?: string; stage?: Stage }> {
  const runs = await prisma.payrollRun.findMany({ where: { status: { in: ORDER }, cycleStart: { lte: to }, cycleEnd: { gte: from } }, select: { status: true, cycleLabel: true } });
  let best: { stage: Stage; period: string } | null = null;
  for (const r of runs) {
    const stage = r.status as Stage;
    if (!best || ORDER.indexOf(stage) > ORDER.indexOf(best.stage)) best = { stage, period: r.cycleLabel };
  }
  return best ? { consumed: true, period: best.period, stage: best.stage } : { consumed: false };
}
