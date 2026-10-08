import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { closeHistoryOnLeaving, inForceOn } from "../../lib/effectiveDating";
import { writeAuditLog } from "../../lib/audit";
import { businessToday } from "../../lib/businessDate";
import { HttpError } from "../../middleware/errorHandler";
import { revokeAllUserRefreshTokens } from "../auth/tokens";
import { logger } from "../../lib/logger";
import { assertSuperAdminRemains, isActiveSuperAdmin, otherActiveSuperAdmins } from "../../lib/superAdminGuard";
import { notifyEmployee } from "../notifications/notifyEmployee";
import { activeUsersHoldingPermission } from "../../lib/permissions";
import { emitTeamChanged } from "../../realtime/emit";
import type { RequestMetaInput } from "./types";

interface InitiateSeparationInput {
  lastWorkingDate: string;
  reason: string;
  notes?: string;
}

export async function initiateSeparation(employeeId: string, input: InitiateSeparationInput, meta: RequestMetaInput) {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) throw new HttpError(404, "Employee not found.", "NOT_FOUND");
  if (employee.status === "SEPARATED") {
    throw new HttpError(400, "This employee has already separated.", "ALREADY_SEPARATED");
  }
  const active = await prisma.separation.findFirst({ where: { employeeId, status: "INITIATED" } });
  if (active) {
    throw new HttpError(409, "This employee already has a separation in progress.", "CONFLICT");
  }
  // E1 rule 7: never separate the last Super Admin — counting only Super
  // Admins who aren't themselves on their way out.
  const user = await prisma.user.findUnique({ where: { employeeId }, select: { id: true } });
  if (user) await assertSuperAdminRemains(user.id, { excludeLeaving: true });

  const lastWorkingDate = new Date(input.lastWorkingDate);
  // Effective dating (EF1): their history ends the day after this date, so
  // it can't be before they joined, nor before a job change that's already
  // in force (that would rewrite history). A change merely scheduled after
  // it is dropped when the separation completes.
  if (lastWorkingDate < employee.dateOfJoining) {
    throw new HttpError(400, `The last working day can't be before they joined (${employee.dateOfJoining.toISOString().slice(0, 10)}).`, "VALIDATION_ERROR");
  }
  const laterInForce = await prisma.employeeJobHistory.findFirst({ where: { employeeId, effectiveFrom: { gt: lastWorkingDate, lte: businessToday() } }, orderBy: { effectiveFrom: "asc" } });
  if (laterInForce) {
    throw new HttpError(409, `They have a job change in force from ${laterInForce.effectiveFrom.toISOString().slice(0, 10)}, after this last working day — earlier history is never rewritten. Choose a last working day on or after it.`, "HISTORY_AFTER_LEAVING");
  }
  const [row] = await prisma.$transaction([
    prisma.separation.create({
      data: { employeeId, lastWorkingDate, reason: input.reason, notes: input.notes ?? null, initiatedByUserId: meta.actorUserId },
    }),
    prisma.employee.update({ where: { id: employeeId }, data: { lastWorkingDate } }),
  ]);

  await writeAuditLog({ ...meta, action: "employee.separation.initiated", entityType: "Employee", entityId: employeeId, after: row });
  return row;
}

export async function cancelSeparation(id: string, meta: RequestMetaInput): Promise<void> {
  const row = await prisma.separation.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, "Separation not found.", "NOT_FOUND");
  if (row.status !== "INITIATED") {
    throw new HttpError(400, "Only an in-progress separation can be cancelled.", "NOT_CANCELLABLE");
  }

  await prisma.$transaction([
    prisma.separation.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date() } }),
    prisma.employee.update({ where: { id: row.employeeId }, data: { lastWorkingDate: null } }),
  ]);
  await writeAuditLog({ ...meta, action: "employee.separation.cancelled", entityType: "Employee", entityId: row.employeeId, before: row });
}

export async function listSeparations() {
  const rows = await prisma.separation.findMany({
    orderBy: { initiatedAt: "desc" },
    include: { employee: { include: { nameHistory: { where: inForceOn() } } } },
  });
  return rows.map((row) => ({
    id: row.id,
    employeeId: row.employeeId,
    employeeCode: row.employee.employeeCode,
    employeeName: row.employee.nameHistory[0]?.fullName ?? row.employee.employeeCode,
    lastWorkingDate: row.lastWorkingDate.toISOString().slice(0, 10),
    reason: row.reason,
    notes: row.notes,
    status: row.status,
    initiatedAt: row.initiatedAt.toISOString(),
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  }));
}

// The scheduled deactivation (spec §3.8: "login is disabled automatically
// after the last working day"). Run daily by jobs/scheduler.ts +
// jobs/worker.ts; also called directly by tests with a past lastWorkingDate
// rather than waiting on real BullMQ scheduling. Completes every INITIATED
// separation whose last working date has passed: separates the employee,
// deactivates their login and revokes every session, closes the open job-
// history row and frees the device user ID for reuse (spec §3's device-ID
// reuse flow) by closing the open DeviceUserMapping too.
export async function processScheduledSeparations(): Promise<{ processed: number }> {
  const today = businessToday();
  const due = await prisma.separation.findMany({ where: { status: "INITIATED", lastWorkingDate: { lt: today } } });

  // Sequential, not parallel — a handful of rows/day at most, and each
  // needs its own transaction.
  let processed = 0;
  for (const sep of due) {
    // E1 rule 7: completing this would deactivate the last active Super
    // Admin — refuse, keep the separation pending, and raise the alarm
    // (every day until someone appoints another Super Admin or cancels it).
    const leaving = await prisma.user.findUnique({ where: { employeeId: sep.employeeId }, select: { id: true } });
    if (leaving && (await isActiveSuperAdmin(leaving.id)) && (await otherActiveSuperAdmins(leaving.id)) === 0) {
      logger.error({ separationId: sep.id, employeeId: sep.employeeId }, "separation NOT completed: employee is the last active Super Admin");
      await writeAuditLog({ actorUserId: null, action: "employee.separation.blocked_last_super_admin", entityType: "Employee", entityId: sep.employeeId, after: { separationId: sep.id } });
      await notifyEmployee(sep.employeeId, {
        type: "access.alert",
        title: "Your separation couldn't complete",
        body: "You're the last active Super Admin, so your access was kept. Appoint another Super Admin (Employee profile → Access), then the separation completes on the next daily run.",
        link: "/admin",
        payload: { separationId: sep.id },
      });
      continue;
    }
    let removedScheduled: Awaited<ReturnType<typeof markSeparatedInTx>>["removedScheduled"];
    try {
      ({ removedScheduled } = await prisma.$transaction(async (tx) => {
        const closed = await markSeparatedInTx(tx, sep.employeeId, sep.lastWorkingDate, sep.reason);
        await tx.separation.update({ where: { id: sep.id }, data: { status: "COMPLETED", completedAt: new Date() } });
        return closed;
      }));
    } catch (err) {
      // History that can't be closed without rewriting it (a job change in
      // force after the last working day): keep the separation pending and
      // say why, every day, rather than guess.
      if (!(err instanceof HttpError)) throw err;
      logger.error({ separationId: sep.id, employeeId: sep.employeeId, code: err.code }, "separation NOT completed: history conflict");
      await writeAuditLog({ actorUserId: null, action: "employee.separation.blocked_history", entityType: "Employee", entityId: sep.employeeId, after: { separationId: sep.id, reason: err.message } });
      continue;
    }
    for (const row of removedScheduled) {
      await writeAuditLog({ actorUserId: null, action: "employee.job.scheduled_change_removed", entityType: "Employee", entityId: sep.employeeId, before: row, after: { reason: "Dated after their last working day — it would never take effect." } });
    }

    const user = await prisma.user.findUnique({ where: { employeeId: sep.employeeId } });
    if (user) {
      await revokeAllUserRefreshTokens(user.id);
    }
    await writeAuditLog({ actorUserId: null, action: "employee.separation.completed", entityType: "Employee", entityId: sep.employeeId });
    // E2: a manager who left with a team leaves that team unassigned (their
    // reports now show on Manager Management's Unassigned list) — tell
    // whoever can reassign them.
    const orphaned = await prisma.employeeJobHistory.count({ where: { reportingManagerId: sep.employeeId, ...inForceOn(), employee: { status: "ACTIVE" } } });
    if (orphaned > 0) {
      for (const holder of await activeUsersHoldingPermission("manager.team.assign")) {
        await notifyEmployee(holder.employeeId, {
          type: "team.unassigned",
          title: "A manager has left — their team needs reassigning",
          body: `${orphaned} team member${orphaned === 1 ? "" : "s"} now ${orphaned === 1 ? "has" : "have"} no manager. Reassign them in Manager Management.`,
          link: "/admin/admin-tools/managers",
          payload: { separatedEmployeeId: sep.employeeId },
        });
      }
      emitTeamChanged([sep.employeeId]);
    }
    processed += 1;
  }

  return { processed };
}

// What "this person has left" means in the data, in one place — used when a
// separation completes and by the Excel import for ex-employees migrated
// from greytHR (who have a last working day and a reason, but no Separation
// row in this system). Status SEPARATED, account deactivated, the current
// placement and device mapping closed on the last working day.
// History closes the day AFTER the last working day (lib/effectiveDating.ts:
// a row covers its start up to but not including its end), so the leaver is
// in force on their last day — payroll's last month and attendance for that
// day both depend on it. Returns any scheduled job change dated after the
// last day, removed because it can never take effect, for the audit log.
export async function markSeparatedInTx(tx: Prisma.TransactionClient, employeeId: string, lastWorkingDate: Date, exitReason: string | null) {
  await tx.employee.update({ where: { id: employeeId }, data: { status: "SEPARATED", lastWorkingDate, exitReason } });
  await tx.user.update({ where: { employeeId }, data: { status: "DEACTIVATED" } });
  return closeHistoryOnLeaving(tx, employeeId, lastWorkingDate);
}
