import { writeAuditLog } from "../../lib/audit";
import { addCalendarDays, businessToday } from "../../lib/businessDate";
import { cancelScheduledChange, inForceOn, type HistoryKind } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";
import { getSetting, setSetting } from "../../lib/settings";
import { logger } from "../../lib/logger";
import { emitPlacementRooms, emitTasksCounts, emitTeamChanged } from "../../realtime/emit";
import { findScopedEmployee } from "./service";
import { notifyEmployee } from "../notifications/notifyEmployee";
import type { DataScope } from "../../lib/dataScope";
import type { RequestMetaInput } from "./types";

// Scheduled changes (EF3, docs/plans/EFFECTIVE_DATES.md): a job, name or bank
// change dated after today is stored now and takes effect on its day —
// every read is "in force today" since EF2. This module is what makes them
// visible and humane: who is told when a move is scheduled and again on the
// day, how one is cancelled, and the daily rollover that refreshes live
// screens when a scheduled change starts.

const iso = (d: Date) => d.toISOString().slice(0, 10);
const longDate = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

async function nameOf(employeeId: string | null | undefined): Promise<string> {
  if (!employeeId) return "";
  const e = await prisma.employee.findUnique({ where: { id: employeeId }, select: { employeeCode: true, nameHistory: { where: inForceOn(), select: { fullName: true } } } });
  return e?.nameHistory[0]?.fullName ?? e?.employeeCode ?? "";
}

/**
 * A reporting-line change dated after today was just stored: tell the
 * employee and both managers now, so nobody is surprised on the day.
 */
export async function notifyScheduledMove(employeeId: string, fromManagerId: string | null, toManagerId: string | null, effectiveFrom: Date): Promise<void> {
  if (effectiveFrom <= businessToday() || fromManagerId === toManagerId) return;
  const [who, to] = await Promise.all([nameOf(employeeId), nameOf(toManagerId)]);
  const when = longDate(effectiveFrom);
  const payload = { employeeId, effectiveFrom: iso(effectiveFrom), fromManagerId, toManagerId };
  await notifyEmployee(employeeId, {
    type: "team.move.scheduled",
    title: "Your reporting manager is changing",
    body: toManagerId ? `From ${when}, you'll report to ${to}.` : `From ${when}, you'll report directly to Admin.`,
    link: "/app/profile",
    payload,
  });
  if (fromManagerId) await notifyEmployee(fromManagerId, { type: "team.move.scheduled", title: "A team member is moving", body: `${who} leaves your team on ${when}.`, link: "/admin/employee/all", payload });
  if (toManagerId) await notifyEmployee(toManagerId, { type: "team.move.scheduled", title: "Someone is joining your team", body: `${who} joins your team on ${when}.`, link: "/admin/employee/all", payload });
}

// ── Cancelling ────────────────────────────────────────────────────────────

const AUDIT_ACTION: Record<HistoryKind, string> = {
  job: "employee.job.scheduled_change_cancelled",
  name: "employee.name.scheduled_change_cancelled",
  bank: "employee.bank.scheduled_change_cancelled",
};

export async function cancelScheduled(kind: HistoryKind, employeeId: string, rowId: string, viewer: { employeeId: string; dataScope: DataScope }, meta: RequestMetaInput) {
  await findScopedEmployee(employeeId, viewer.employeeId, viewer.dataScope);
  const { removed, reopened } = await prisma.$transaction((tx) => cancelScheduledChange(tx, kind, employeeId, rowId));
  // The removed row in full (bank: never the account number, only what identifies it).
  const before =
    kind === "bank" && "accountNumberLast4" in removed
      ? { id: removed.id, effectiveFrom: iso(removed.effectiveFrom), accountNumberLast4: removed.accountNumberLast4, ifsc: removed.ifsc, bankName: removed.bankName }
      : removed;
  await writeAuditLog({ ...meta, action: AUDIT_ACTION[kind], entityType: "Employee", entityId: employeeId, before, after: { reopenedRowId: reopened.id } });

  if (kind === "job" && "reportingManagerId" in removed && "reportingManagerId" in reopened && removed.reportingManagerId !== reopened.reportingManagerId) {
    const payload = { employeeId, cancelledFrom: iso(removed.effectiveFrom) };
    const who = await nameOf(employeeId);
    await notifyEmployee(employeeId, { type: "team.move.cancelled", title: "Your manager change was cancelled", body: `The change planned for ${longDate(removed.effectiveFrom)} won't happen.`, link: "/app/profile", payload });
    if (removed.reportingManagerId) await notifyEmployee(removed.reportingManagerId, { type: "team.move.cancelled", title: "A planned team move was cancelled", body: `${who} won't be joining your team on ${longDate(removed.effectiveFrom)}.`, link: "/admin/employee/all", payload });
    emitTeamChanged([removed.reportingManagerId, reopened.reportingManagerId]);
  }
  return { cancelled: rowId, reopened: reopened.id };
}

// ── The daily rollover (00:05 IST) ────────────────────────────────────────

export const ROLLOVER_LAST_RUN_KEY = "history.rolloverLastRun";

/**
 * For every job change that was SCHEDULED (stored before its day) and has
 * taken effect since the last run — today, or any day missed while the
 * scheduler was down — refresh the live state: move the person's sockets to
 * their new department/branch rooms, refresh both managers' team screens
 * and task counts, and tell the employee and both managers it's happened.
 * Changes made effective immediately already did all of this when written.
 */
export async function processHistoryRollover(today: Date = businessToday()): Promise<{ processed: number }> {
  const last = await getSetting<string | null>(ROLLOVER_LAST_RUN_KEY, null);
  const from = last ? addCalendarDays(new Date(`${last}T00:00:00Z`), 1) : today;
  if (from > today) return { processed: 0 };

  const started = await prisma.employeeJobHistory.findMany({ where: { effectiveFrom: { gte: from, lte: today } }, orderBy: { effectiveFrom: "asc" } });
  let processed = 0;
  for (const row of started) {
    const ist = new Date(row.createdAt.getTime() + 5.5 * 3_600_000);
    const addedOn = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate())); // the IST day it was written
    if (addedOn >= row.effectiveFrom) continue; // effective when written — already handled then
    const previous = await prisma.employeeJobHistory.findFirst({ where: { employeeId: row.employeeId, effectiveTo: row.effectiveFrom } });
    emitPlacementRooms(row.employeeId, { departmentId: previous?.departmentId ?? null, locationId: previous?.locationId ?? null }, { departmentId: row.departmentId, locationId: row.locationId });
    emitTeamChanged([previous?.reportingManagerId, row.reportingManagerId, row.employeeId]);
    emitTasksCounts(previous?.reportingManagerId ?? null);
    emitTasksCounts(row.reportingManagerId);
    if (previous && previous.reportingManagerId !== row.reportingManagerId) {
      const [who, to] = await Promise.all([nameOf(row.employeeId), nameOf(row.reportingManagerId)]);
      const payload = { employeeId: row.employeeId, jobHistoryId: row.id };
      await notifyEmployee(row.employeeId, { type: "team.move.effective", title: "Your reporting manager has changed", body: row.reportingManagerId ? `From today, you report to ${to}.` : "From today, you report directly to Admin.", link: "/app/profile", payload });
      if (previous.reportingManagerId) await notifyEmployee(previous.reportingManagerId, { type: "team.move.effective", title: "A team member has moved", body: `${who} is no longer in your team from today.`, link: "/admin/employee/all", payload });
      if (row.reportingManagerId) await notifyEmployee(row.reportingManagerId, { type: "team.move.effective", title: "Someone has joined your team", body: `${who} is in your team from today.`, link: "/admin/employee/all", payload });
    }
    processed += 1;
  }
  await setSetting(ROLLOVER_LAST_RUN_KEY, iso(today), null);
  logger.info({ processed, from: iso(from), to: iso(today) }, "history rollover done");
  return { processed };
}
