import { prisma } from "../../lib/prisma";

// Which attendance cycles are finalised right now: those whose latest event in attendance_period_locks is FINALISE. The
// engine reads this so it never writes a day inside one (days that did not exist when the cycle was locked, for example a
// joiner whose joining date falls inside it, would otherwise appear unlocked); finalisation.ts reads it to say which
// employees have days waiting. Separate from finalisation.ts because finalisation imports the engine.

const iso = (d: Date) => d.toISOString().slice(0, 10);

export interface FinalisedPeriod {
  from: string;
  to: string;
}

/** The finalised cycles that overlap [from, to] (inclusive business dates). */
export async function finalisedPeriodsOverlapping(from: string, to: string): Promise<FinalisedPeriod[]> {
  const events = await prisma.attendancePeriodLock.findMany({
    where: { periodStart: { lte: new Date(`${to}T00:00:00Z`) }, periodEnd: { gte: new Date(`${from}T00:00:00Z`) } },
    orderBy: { seq: "asc" },
    select: { periodStart: true, periodEnd: true, action: true },
  });
  const latest = new Map<string, { from: string; to: string; action: string }>();
  for (const e of events) latest.set(`${iso(e.periodStart)}|${iso(e.periodEnd)}`, { from: iso(e.periodStart), to: iso(e.periodEnd), action: e.action });
  return [...latest.values()].filter((p) => p.action === "FINALISE").map(({ from: f, to: t }) => ({ from: f, to: t }));
}

export const inAnyPeriod = (periods: FinalisedPeriod[], date: string) => periods.some((p) => p.from <= date && date <= p.to);
