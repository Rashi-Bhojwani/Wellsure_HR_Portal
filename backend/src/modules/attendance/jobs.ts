import { attendanceProcessQueue, attendanceRecomputeQueue } from "../../jobs/attendanceQueues";
import { businessToday } from "../../lib/businessDate";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { getSetting, setSetting } from "../../lib/settings";
import { computeAttendance } from "./compute";
import { addDays } from "./engine/time";
import type { DayRef } from "./recompute";

// Background work for the engine (docs/plans/PHASE_2.md §4.1, §3.1).

const iso = (d: Date) => d.toISOString().slice(0, 10);
export const NIGHTLY_LAST_RUN_KEY = "attendance.nightlyLastRun";
const NIGHTLY_MAX_DAYS = 31;
const CHUNK = 100;

/**
 * The recompute handler registered with requestRecompute: groups the days by
 * employee into contiguous ranges and enqueues each range, debounced — a burst
 * of punches for one person becomes one recompute about a second later.
 */
export async function enqueueRecompute(days: DayRef[]): Promise<void> {
  const byEmployee = new Map<string, string[]>();
  for (const d of days) byEmployee.set(d.employeeId, [...(byEmployee.get(d.employeeId) ?? []), iso(d.date)]);
  const q = attendanceRecomputeQueue();
  for (const [employeeId, dates] of byEmployee) {
    const sorted = [...new Set(dates)].sort();
    // A punch can count toward the previous day (a night shift), so each range starts a day early.
    let start = addDays(sorted[0]!, -1);
    let prev = sorted[0]!;
    const flush = async (from: string, to: string) => {
      const id = `${employeeId}:${from}:${to}`;
      await q.add("recompute", { employeeId, from, to }, { delay: 1000, deduplication: { id, ttl: 1000, extend: true, replace: true }, removeOnComplete: true, removeOnFail: 1000 });
    };
    for (const d of sorted.slice(1)) {
      if (d > addDays(prev, 1)) {
        await flush(start, prev);
        start = addDays(d, -1);
      }
      prev = d;
    }
    await flush(start, prev);
  }
}

/** Everyone employed on these dates (a holiday changed): one job per date. */
export async function enqueueRecomputeDates(dates: Date[]): Promise<void> {
  const q = attendanceRecomputeQueue();
  for (const d of [...new Set(dates.map(iso))]) {
    await q.add("recompute-everyone", { from: d, to: d }, { delay: 1000, deduplication: { id: `everyone:${d}`, ttl: 1000, extend: true, replace: true }, removeOnComplete: true, removeOnFail: 1000 });
  }
}

export async function processRecomputeJob(data: { employeeId?: string; from: string; to: string }) {
  if (data.employeeId) return computeAttendance([data.employeeId], data.from, data.to);
  const ids = await employeesInRange(data.from, data.to);
  const r = await computeInChunks(ids, data.from, data.to);
  return { processed: r.processed, changed: r.changed };
}

/** Everyone employed at any point in [from, to]. */
export async function employeesInRange(from: string, to: string, filter: { employeeIds?: string[] } = {}): Promise<string[]> {
  const rows = await prisma.employee.findMany({
    where: {
      ...(filter.employeeIds?.length ? { id: { in: filter.employeeIds } } : {}),
      dateOfJoining: { lte: new Date(`${to}T00:00:00Z`) },
      OR: [{ lastWorkingDate: null }, { lastWorkingDate: { gte: new Date(`${from}T00:00:00Z`) } }],
    },
    select: { id: true },
    orderBy: { employeeCode: "asc" },
  });
  return rows.map((r) => r.id);
}

/** Recompute a range for many employees, in chunks; `onChunk` reports progress. */
export async function computeInChunks(employeeIds: string[], from: string, to: string, onChunk?: (r: Awaited<ReturnType<typeof computeAttendance>>) => Promise<void>) {
  const total = { processed: 0, changed: 0, locked: 0, beforeEngineStart: 0, deleted: 0, changes: [] as Awaited<ReturnType<typeof computeAttendance>>["changes"] };
  for (let i = 0; i < employeeIds.length; i += CHUNK) {
    const r = await computeAttendance(employeeIds.slice(i, i + CHUNK), from, to, { maxChanges: Math.max(0, 500 - total.changes.length) });
    total.processed += r.processed;
    total.changed += r.changed;
    total.locked += r.locked;
    total.beforeEngineStart += r.beforeEngineStart;
    total.deleted += r.deleted;
    total.changes.push(...r.changes);
    if (onChunk) await onChunk(r);
  }
  return total;
}

/**
 * Nightly (02:00 IST): finalise yesterday for everyone — absences and
 * exceptions only become final once a day's shift window has closed. Starts
 * the day before the last run's end (a night shift's window closes the next
 * morning), and catches up any missed nights, up to 31 days back.
 */
export async function runNightly(today: Date = businessToday()) {
  const yesterday = addDays(iso(today), -1);
  const lastEnd = await getSetting<string | null>(NIGHTLY_LAST_RUN_KEY, null);
  const earliest = addDays(yesterday, -(NIGHTLY_MAX_DAYS - 1));
  let from = lastEnd ? addDays(lastEnd, -1) : addDays(yesterday, -1);
  if (from < earliest) from = earliest;
  const ids = await employeesInRange(from, yesterday);
  const result = await computeInChunks(ids, from, yesterday);
  await setSetting(NIGHTLY_LAST_RUN_KEY, yesterday, null);
  logger.info({ from, to: yesterday, employees: ids.length, changed: result.changed }, "attendance nightly done");
  return { from, to: yesterday, employees: ids.length, changed: result.changed, processed: result.processed };
}

export async function enqueueProcessRun(runId: string): Promise<void> {
  await attendanceProcessQueue().add("process", { runId }, { removeOnComplete: true, removeOnFail: 1000 });
}

