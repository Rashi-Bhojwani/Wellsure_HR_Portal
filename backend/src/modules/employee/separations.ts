import { prisma } from "../../lib/prisma";
import { writeAuditLog } from "../../lib/audit";
import { businessToday } from "../../lib/businessDate";
import { HttpError } from "../../middleware/errorHandler";
import { revokeAllUserRefreshTokens } from "../auth/tokens";
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

  const lastWorkingDate = new Date(input.lastWorkingDate);
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
    include: { employee: { include: { nameHistory: { where: { effectiveTo: null } } } } },
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
    await prisma.$transaction(async (tx) => {
      await tx.employee.update({ where: { id: sep.employeeId }, data: { status: "SEPARATED" } });
      await tx.user.update({ where: { employeeId: sep.employeeId }, data: { status: "DEACTIVATED" } });
      await tx.employeeJobHistory.updateMany({
        where: { employeeId: sep.employeeId, effectiveTo: null },
        data: { effectiveTo: sep.lastWorkingDate },
      });
      await tx.deviceUserMapping.updateMany({
        where: { employeeId: sep.employeeId, validTo: null },
        data: { validTo: sep.lastWorkingDate },
      });
      await tx.separation.update({ where: { id: sep.id }, data: { status: "COMPLETED", completedAt: new Date() } });
    });

    const user = await prisma.user.findUnique({ where: { employeeId: sep.employeeId } });
    if (user) {
      await revokeAllUserRefreshTokens(user.id);
    }
    await writeAuditLog({ actorUserId: null, action: "employee.separation.completed", entityType: "Employee", entityId: sep.employeeId });
    processed += 1;
  }

  return { processed };
}
