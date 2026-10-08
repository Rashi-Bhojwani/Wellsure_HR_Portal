import { writeAuditLog } from "../../lib/audit";
import { businessToday } from "../../lib/businessDate";
import { placementsOn } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { computeInChunks, employeesInRange, enqueueProcessRun } from "./jobs";

// Process Attendance (docs/plans/PHASE_2.md §3.1, user addition 2026-10-08):
// re-run the engine for any range and any employees, at any time before the
// period is locked — "a wrong rule value discovered later is a recompute
// rather than a data-entry exercise". A background job with progress,
// audited (who, range, why), reporting how many days changed and which.

export interface Meta {
  actorUserId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
export const MAX_PROCESS_DAYS = 366;

function spanDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

async function scope(input: { fromDate: string; toDate: string; employeeIds?: string[]; locationId?: string | null }): Promise<string[]> {
  let ids = await employeesInRange(input.fromDate, input.toDate, { employeeIds: input.employeeIds });
  if (input.locationId) {
    const placements = await placementsOn(ids, new Date(`${input.toDate}T00:00:00Z`));
    ids = ids.filter((id) => placements.get(id)?.locationId === input.locationId);
  }
  return ids;
}

export async function startProcessRun(input: { fromDate: string; toDate: string; employeeIds?: string[]; locationId?: string | null; reason: string }, meta: Meta) {
  const today = iso(businessToday());
  if (input.fromDate > input.toDate) throw new HttpError(400, "The start date must be on or before the end date.", "VALIDATION_ERROR");
  if (input.toDate > today) throw new HttpError(400, "Attendance can't be processed for days that haven't happened yet.", "VALIDATION_ERROR");
  if (spanDays(input.fromDate, input.toDate) > MAX_PROCESS_DAYS) throw new HttpError(400, `Process at most ${MAX_PROCESS_DAYS} days at a time.`, "VALIDATION_ERROR");
  const ids = await scope(input);
  if (ids.length === 0) throw new HttpError(400, "Nobody was employed in that range and selection.", "VALIDATION_ERROR");
  const run = await prisma.attendanceProcessRun.create({
    data: {
      fromDate: new Date(`${input.fromDate}T00:00:00Z`),
      toDate: new Date(`${input.toDate}T00:00:00Z`),
      employeeIds: input.employeeIds ?? [],
      locationId: input.locationId ?? null,
      reason: input.reason,
      requestedByUserId: meta.actorUserId,
      totalDays: ids.length * spanDays(input.fromDate, input.toDate),
    },
  });
  await writeAuditLog({ ...meta, action: "attendance.process.requested", entityType: "AttendanceProcessRun", entityId: run.id, after: { from: input.fromDate, to: input.toDate, employees: ids.length, locationId: input.locationId ?? null, reason: input.reason } });
  await enqueueProcessRun(run.id);
  return run;
}

/** The worker's side: recompute the run's scope in chunks, recording progress and what changed. */
export async function executeProcessRun(runId: string) {
  const run = await prisma.attendanceProcessRun.findUnique({ where: { id: runId } });
  if (!run || run.status === "COMPLETED") return run;
  const from = iso(run.fromDate);
  const to = iso(run.toDate);
  await prisma.attendanceProcessRun.update({ where: { id: runId }, data: { status: "RUNNING", startedAt: new Date(), processedDays: 0, changedDays: 0, lockedDays: 0 } });
  try {
    const ids = await scope({ fromDate: from, toDate: to, employeeIds: run.employeeIds, locationId: run.locationId });
    let processed = 0;
    let changed = 0;
    let locked = 0;
    const total = await computeInChunks(ids, from, to, async (r) => {
      processed += r.processed;
      changed += r.changed;
      locked += r.locked;
      await prisma.attendanceProcessRun.update({ where: { id: runId }, data: { processedDays: processed, changedDays: changed, lockedDays: locked } });
    });
    return prisma.attendanceProcessRun.update({
      where: { id: runId },
      data: { status: "COMPLETED", finishedAt: new Date(), processedDays: total.processed, changedDays: total.changed, lockedDays: total.locked, changes: total.changes as never },
    });
  } catch (err) {
    await prisma.attendanceProcessRun.update({ where: { id: runId }, data: { status: "FAILED", finishedAt: new Date(), error: err instanceof Error ? err.message : String(err) } });
    throw err;
  }
}

export async function listProcessRuns() {
  return prisma.attendanceProcessRun.findMany({ orderBy: { requestedAt: "desc" }, take: 50, omit: { changes: true } });
}

export async function getProcessRun(id: string) {
  const run = await prisma.attendanceProcessRun.findUnique({ where: { id } });
  if (!run) throw new HttpError(404, "Run not found.", "NOT_FOUND");
  const changes = (run.changes as Array<{ employeeId: string; date: string; before: string | null; after: string | null }>) ?? [];
  const emps = await prisma.employee.findMany({ where: { id: { in: [...new Set(changes.map((c) => c.employeeId))] } }, select: { id: true, employeeCode: true } });
  const code = new Map(emps.map((e) => [e.id, e.employeeCode]));
  return { ...run, changes: changes.map((c) => ({ ...c, employeeCode: code.get(c.employeeId) ?? null })) };
}

/** How many employee-days a recompute from `from` (to today) would cover — what a settings change offers to recompute. */
export async function recomputeScopeFrom(from: string): Promise<{ from: string; to: string; employees: number; days: number }> {
  const to = iso(businessToday());
  const start = from > to ? to : from;
  const ids = await employeesInRange(start, to);
  return { from: start, to, employees: ids.length, days: ids.length * spanDays(start, to) };
}

