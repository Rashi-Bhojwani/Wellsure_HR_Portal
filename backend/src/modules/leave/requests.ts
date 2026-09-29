import type { LeaveDayPart, LeaveRequestStatus, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { writeAuditLog } from "../../lib/audit";
import { addCalendarDays, businessToday } from "../../lib/businessDate";
import { resolveDataScope } from "../../lib/dataScope";
import { HttpError } from "../../middleware/errorHandler";
import { createNotification } from "../notifications/service";
import { emitLeaveApplied, emitLeaveDecided, emitNotificationNew, emitTasksCounts } from "../../realtime/emit";
import { getAttendanceLeaveSink, type ApprovedLeaveDay } from "./attendanceIntegration";
import { consumeCompOffFifo, reverseCompOffConsumption } from "./compOff";
import { withEmployeeLeaveLock } from "./concurrency";
import { computeTotalLeaveDays } from "./dayCount";
import { resolveDayCountContext } from "./dayCountContext";
import { assertSufficientBalance, writeLedgerEntry } from "./ledger";
import { buildLeaveEmployeeIdFilter, isEmployeeInScope } from "./scope";
import type { ActorMeta, LeaveViewer } from "./types";

interface ApplyLeaveInput {
  employeeId?: string; // target; defaults to the caller's own
  leaveTypeId: string;
  fromDate: string;
  toDate: string;
  fromDayPart: LeaveDayPart;
  toDayPart: LeaveDayPart;
  reason?: string;
  attachmentStorageKey?: string;
}

// Notification.userId is a User id, not an Employee id — every emit room
// (realtime/socket.ts) is keyed by employeeId, so callers pass the target
// employeeId here and this resolves+persists+delivers in one step.
// Persistence (createNotification) always happens before the socket
// emit, and happens even if no one is connected — see
// modules/notifications/service.ts's module comment for why the two are
// deliberately separate steps, never coupled.
async function notifyEmployee(targetEmployeeId: string, input: { type: string; title: string; body: string; link?: string | null; payload?: Record<string, unknown> }): Promise<void> {
  const user = await prisma.user.findUnique({ where: { employeeId: targetEmployeeId } });
  if (!user) return;
  const notification = await createNotification({ userId: user.id, ...input });
  emitNotificationNew(targetEmployeeId, {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    link: notification.link,
    createdAt: notification.createdAt.toISOString(),
  });
}

async function assertNoLockedPeriod(employeeId: string, fromDate: Date, toDate: Date): Promise<void> {
  const sink = getAttendanceLeaveSink();
  for (let d = fromDate; d.getTime() <= toDate.getTime(); d = addCalendarDays(d, 1)) {
    if (await sink.isPeriodLocked(employeeId, d)) {
      throw new HttpError(409, `${d.toISOString().slice(0, 10)} falls inside a locked attendance period.`, "PERIOD_LOCKED");
    }
  }
}

// Every calendar day in [fromDate, toDate] with its effective day part —
// deliberately NOT pre-excluding holidays/week-offs here (unlike
// computeTotalLeaveDays, which does, for balance purposes): spec §4.4's
// attendance rule order already prioritises holiday/week-off over approved
// leave, so Phase 2's real AttendanceLeaveSink should make that call
// itself rather than leave pre-filtering on its behalf.
function buildApprovedLeaveDays(request: { id: string; employeeId: string; fromDate: Date; toDate: Date; fromDayPart: LeaveDayPart; toDayPart: LeaveDayPart }, leaveTypeCode: string): ApprovedLeaveDay[] {
  const days: ApprovedLeaveDay[] = [];
  let cursor = request.fromDate;
  while (cursor.getTime() <= request.toDate.getTime()) {
    const isFrom = cursor.getTime() === request.fromDate.getTime();
    const isTo = cursor.getTime() === request.toDate.getTime();
    const dayPart = isFrom ? request.fromDayPart : isTo ? request.toDayPart : "FULL";
    days.push({ employeeId: request.employeeId, date: cursor, leaveTypeCode, dayPart, leaveRequestId: request.id });
    cursor = addCalendarDays(cursor, 1);
  }
  return days;
}

export async function applyForLeave(input: ApplyLeaveInput, viewer: LeaveViewer, meta: ActorMeta) {
  const targetEmployeeId = input.employeeId ?? viewer.employeeId;
  if (targetEmployeeId !== viewer.employeeId) {
    if (!viewer.permissions.has("leave.apply.onBehalf")) {
      throw new HttpError(403, "Missing permission: leave.apply.onBehalf", "FORBIDDEN");
    }
    const scope = resolveDataScope(viewer.roleCodes);
    if (!(await isEmployeeInScope(targetEmployeeId, viewer.employeeId, scope))) {
      throw new HttpError(404, "Employee not found.", "NOT_FOUND");
    }
  }

  const employee = await prisma.employee.findUnique({ where: { id: targetEmployeeId }, select: { id: true, status: true } });
  if (!employee || employee.status !== "ACTIVE") {
    throw new HttpError(404, "Employee not found.", "NOT_FOUND");
  }

  const leaveType = await prisma.leaveType.findUnique({ where: { id: input.leaveTypeId }, include: { policy: true } });
  if (!leaveType || !leaveType.isActive) {
    throw new HttpError(400, "Invalid leave type.", "INVALID_LEAVE_TYPE");
  }

  const fromDate = new Date(input.fromDate);
  const toDate = new Date(input.toDate);
  if (fromDate.getTime() > toDate.getTime()) {
    throw new HttpError(400, "fromDate must not be after toDate.", "INVALID_RANGE");
  }
  if (fromDate.getTime() === toDate.getTime() && input.fromDayPart !== input.toDayPart) {
    throw new HttpError(400, "A single-day request must use the same day part for from and to.", "INVALID_DAY_PART");
  }
  if (!leaveType.allowHalfDay && (input.fromDayPart !== "FULL" || input.toDayPart !== "FULL")) {
    throw new HttpError(400, `${leaveType.code} does not allow half-day requests.`, "HALF_DAY_NOT_ALLOWED");
  }

  await assertNoLockedPeriod(targetEmployeeId, fromDate, toDate);

  const { holidayDates, weekOffDays } = await resolveDayCountContext(targetEmployeeId, fromDate, toDate);
  const totalDays = computeTotalLeaveDays(fromDate, toDate, input.fromDayPart, input.toDayPart, holidayDates, weekOffDays);
  if (totalDays.lessThanOrEqualTo(0)) {
    throw new HttpError(400, "The selected range contains no working days to apply leave for.", "NO_WORKING_DAYS");
  }

  const request = await withEmployeeLeaveLock(targetEmployeeId, async (tx) => {
    const overlap = await tx.leaveRequest.findFirst({
      where: { employeeId: targetEmployeeId, status: { in: ["PENDING", "APPROVED"] }, fromDate: { lte: toDate }, toDate: { gte: fromDate } },
    });
    if (overlap) {
      throw new HttpError(409, "An existing request already covers part of this date range.", "OVERLAPPING_REQUEST");
    }

    if (!leaveType.policy?.skipBalanceCheck) {
      await assertSufficientBalance(tx, targetEmployeeId, leaveType.id, leaveType.policy ?? { skipBalanceCheck: false, negativeBalanceAllowed: false }, totalDays);
    }

    return tx.leaveRequest.create({
      data: {
        employeeId: targetEmployeeId,
        leaveTypeId: leaveType.id,
        fromDate,
        toDate,
        fromDayPart: input.fromDayPart,
        toDayPart: input.toDayPart,
        totalDays,
        reason: input.reason ?? null,
        attachmentStorageKey: input.attachmentStorageKey ?? null,
        appliedByUserId: meta.actorUserId,
        status: "PENDING",
      },
    });
  });

  await writeAuditLog({ ...meta, action: "leave.request.apply", entityType: "LeaveRequest", entityId: request.id, after: toAuditJson(request) });
  const formatted = await reloadFormatted(request.id);

  const jobHistory = await prisma.employeeJobHistory.findFirst({ where: { employeeId: targetEmployeeId, effectiveTo: null }, select: { reportingManagerId: true } });
  const reportingManagerId = jobHistory?.reportingManagerId ?? null;

  if (reportingManagerId) {
    await notifyEmployee(reportingManagerId, {
      type: "leave.applied",
      title: "New leave request",
      body: `${formatted.employeeName} applied for ${formatted.totalDays} day(s) of ${formatted.leaveTypeCode} (${formatted.fromDate} to ${formatted.toDate}).`,
      link: "/admin/workforce/leave/employee-leave",
      payload: { leaveRequestId: formatted.id },
    });
  }
  emitLeaveApplied(
    { leaveRequestId: formatted.id, employeeId: formatted.employeeId, employeeName: formatted.employeeName, leaveTypeCode: formatted.leaveTypeCode, fromDate: formatted.fromDate, toDate: formatted.toDate, totalDays: formatted.totalDays },
    reportingManagerId,
  );
  emitTasksCounts(reportingManagerId);

  return formatted;
}

export interface ListLeaveRequestsQuery {
  employeeId?: string;
  status?: LeaveRequestStatus;
  leaveTypeId?: string;
  fromDate?: string;
  toDate?: string;
  page: number;
  pageSize: number;
}

// writeAuditLog's `before`/`after` go through Prisma's Json input, which
// can't serialise a raw LeaveRequest row directly — Prisma.Decimal
// (totalDays) carries a `constructor` function property that fails
// JSON serialisation. Also deliberately narrower than the full row: only
// LeaveRequest's own scalar fields, never a nested leaveType/policy
// relation some callers' `existing` fetch happens to include.
function toAuditJson(row: {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  fromDate: Date;
  toDate: Date;
  fromDayPart: string;
  toDayPart: string;
  totalDays: Prisma.Decimal;
  reason: string | null;
  status: string;
  appliedByUserId: string;
  decidedByUserId: string | null;
  decidedAt: Date | null;
  decisionComments: string | null;
  cancelledByUserId: string | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
}) {
  return {
    id: row.id,
    employeeId: row.employeeId,
    leaveTypeId: row.leaveTypeId,
    fromDate: row.fromDate.toISOString().slice(0, 10),
    toDate: row.toDate.toISOString().slice(0, 10),
    fromDayPart: row.fromDayPart,
    toDayPart: row.toDayPart,
    totalDays: row.totalDays.toNumber(),
    reason: row.reason,
    status: row.status,
    appliedByUserId: row.appliedByUserId,
    decidedByUserId: row.decidedByUserId,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionComments: row.decisionComments,
    cancelledByUserId: row.cancelledByUserId,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancellationReason: row.cancellationReason,
  };
}

function formatLeaveRequestRow(row: Prisma.LeaveRequestGetPayload<{ include: { leaveType: true; employee: { include: { nameHistory: true } } } }>) {
  return {
    id: row.id,
    employeeId: row.employeeId,
    employeeCode: row.employee.employeeCode,
    employeeName: row.employee.nameHistory[0]?.fullName ?? row.employee.employeeCode,
    leaveTypeId: row.leaveTypeId,
    leaveTypeCode: row.leaveType.code,
    leaveTypeName: row.leaveType.name,
    fromDate: row.fromDate.toISOString().slice(0, 10),
    toDate: row.toDate.toISOString().slice(0, 10),
    fromDayPart: row.fromDayPart,
    toDayPart: row.toDayPart,
    totalDays: row.totalDays.toNumber(),
    reason: row.reason,
    status: row.status,
    appliedByUserId: row.appliedByUserId,
    decidedByUserId: row.decidedByUserId,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionComments: row.decisionComments,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancellationReason: row.cancellationReason,
    createdAt: row.createdAt.toISOString(),
  };
}

const REQUEST_LIST_INCLUDE = { leaveType: true, employee: { include: { nameHistory: { where: { effectiveTo: null } } } } } as const;

// Every write endpoint (apply/approve/reject/cancel) returns this same
// formatted shape as list/get — a plain `return updated` would hand back
// the raw Prisma row instead, where totalDays (a Decimal) serialises to a
// JSON *string*, not a number, a real inconsistency a client can't rely on.
async function reloadFormatted(requestId: string) {
  return formatLeaveRequestRow(await prisma.leaveRequest.findUniqueOrThrow({ where: { id: requestId }, include: REQUEST_LIST_INCLUDE }));
}

export async function listLeaveRequests(query: ListLeaveRequestsQuery, viewer: LeaveViewer) {
  const scope = resolveDataScope(viewer.roleCodes);
  const hasBroadView = viewer.permissions.has("leave.view");
  const where: Prisma.LeaveRequestWhereInput = {};

  if (query.employeeId && query.employeeId !== viewer.employeeId) {
    if (!hasBroadView) throw new HttpError(403, "Missing permission: leave.view", "FORBIDDEN");
    if (!(await isEmployeeInScope(query.employeeId, viewer.employeeId, scope))) {
      throw new HttpError(404, "Employee not found.", "NOT_FOUND");
    }
    where.employeeId = query.employeeId;
  } else if (query.employeeId === viewer.employeeId) {
    where.employeeId = viewer.employeeId;
  } else if (!hasBroadView) {
    where.employeeId = viewer.employeeId; // no filter given, no broad view — silently narrow to self
  } else {
    const filter = await buildLeaveEmployeeIdFilter(viewer.employeeId, scope);
    if (filter) where.employeeId = filter;
  }

  if (query.status) where.status = query.status;
  if (query.leaveTypeId) where.leaveTypeId = query.leaveTypeId;
  // Overlap filter, not exact-match: any request that touches the given
  // range at all (toDate >= rangeFrom AND fromDate <= rangeTo).
  if (query.fromDate) where.toDate = { gte: new Date(query.fromDate) };
  if (query.toDate) where.fromDate = { lte: new Date(query.toDate) };

  const [total, rows] = await Promise.all([
    prisma.leaveRequest.count({ where }),
    prisma.leaveRequest.findMany({
      where,
      include: REQUEST_LIST_INCLUDE,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return { total, page: query.page, pageSize: query.pageSize, rows: rows.map(formatLeaveRequestRow) };
}

export async function getLeaveRequestById(requestId: string, viewer: LeaveViewer) {
  const row = await prisma.leaveRequest.findUnique({ where: { id: requestId }, include: REQUEST_LIST_INCLUDE });
  if (!row) throw new HttpError(404, "Leave request not found.", "NOT_FOUND");

  const scope = resolveDataScope(viewer.roleCodes);
  const isSelf = row.employeeId === viewer.employeeId;
  if (!isSelf && !viewer.permissions.has("leave.view")) {
    throw new HttpError(404, "Leave request not found.", "NOT_FOUND");
  }
  if (!isSelf && !(await isEmployeeInScope(row.employeeId, viewer.employeeId, scope))) {
    throw new HttpError(404, "Leave request not found.", "NOT_FOUND");
  }
  return formatLeaveRequestRow(row);
}

async function assertCanDecide(existing: { employeeId: string }, viewer: LeaveViewer): Promise<void> {
  if (!viewer.permissions.has("leave.approve")) {
    throw new HttpError(403, "Missing permission: leave.approve", "FORBIDDEN");
  }
  if (existing.employeeId === viewer.employeeId) {
    throw new HttpError(403, "You cannot decide your own leave request.", "SELF_APPROVAL_BLOCKED");
  }
  const scope = resolveDataScope(viewer.roleCodes);
  if (!(await isEmployeeInScope(existing.employeeId, viewer.employeeId, scope))) {
    throw new HttpError(404, "Leave request not found.", "NOT_FOUND");
  }
}

export async function approveLeaveRequest(requestId: string, viewer: LeaveViewer, comments: string | undefined, meta: ActorMeta) {
  const existing = await prisma.leaveRequest.findUnique({ where: { id: requestId }, include: { leaveType: { include: { policy: true } } } });
  if (!existing) throw new HttpError(404, "Leave request not found.", "NOT_FOUND");
  await assertCanDecide(existing, viewer);
  if (existing.status !== "PENDING") {
    throw new HttpError(409, `Request is ${existing.status.toLowerCase()}, not pending.`, "NOT_PENDING");
  }
  await assertNoLockedPeriod(existing.employeeId, existing.fromDate, existing.toDate);

  const updated = await withEmployeeLeaveLock(existing.employeeId, async (tx) => {
    const fresh = await tx.leaveRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (fresh.status !== "PENDING") {
      throw new HttpError(409, `Request is ${fresh.status.toLowerCase()}, not pending.`, "NOT_PENDING");
    }
    const leaveYear = fresh.fromDate.getUTCFullYear();

    if (existing.leaveType.code === "COF") {
      await consumeCompOffFifo(tx, existing.employeeId, requestId, fresh.totalDays, leaveYear, fresh.fromDate);
    } else {
      const policy = existing.leaveType.policy;
      if (!policy?.skipBalanceCheck) {
        await assertSufficientBalance(tx, existing.employeeId, existing.leaveType.id, policy ?? { skipBalanceCheck: false, negativeBalanceAllowed: false }, fresh.totalDays);
      }
      await writeLedgerEntry(tx, {
        employeeId: existing.employeeId,
        leaveTypeId: existing.leaveType.id,
        leaveYear,
        entryDate: fresh.fromDate,
        entryType: "CONSUMED",
        days: fresh.totalDays.negated(),
        referenceType: "LEAVE_REQUEST",
        referenceId: requestId,
        createdByUserId: meta.actorUserId,
      });
    }

    return tx.leaveRequest.update({
      where: { id: requestId },
      data: { status: "APPROVED", decidedByUserId: meta.actorUserId, decidedAt: new Date(), decisionComments: comments ?? null },
    });
  });

  await getAttendanceLeaveSink().onLeaveApproved(buildApprovedLeaveDays(updated, existing.leaveType.code));
  await writeAuditLog({ ...meta, action: "leave.request.approve", entityType: "LeaveRequest", entityId: requestId, before: toAuditJson(existing), after: toAuditJson(updated) });
  const formatted = await reloadFormatted(requestId);
  await notifyEmployee(formatted.employeeId, {
    type: "leave.decided",
    title: "Leave approved",
    body: `Your ${formatted.leaveTypeCode} request (${formatted.fromDate} to ${formatted.toDate}) was approved.`,
    link: "/app/leave/balances",
    payload: { leaveRequestId: formatted.id, status: "APPROVED" },
  });
  emitLeaveDecided({
    leaveRequestId: formatted.id,
    employeeId: formatted.employeeId,
    employeeName: formatted.employeeName,
    leaveTypeCode: formatted.leaveTypeCode,
    fromDate: formatted.fromDate,
    toDate: formatted.toDate,
    totalDays: formatted.totalDays,
    status: "APPROVED",
  });
  emitTasksCounts(viewer.employeeId);
  return formatted;
}

export async function rejectLeaveRequest(requestId: string, viewer: LeaveViewer, comments: string, meta: ActorMeta) {
  const existing = await prisma.leaveRequest.findUnique({ where: { id: requestId } });
  if (!existing) throw new HttpError(404, "Leave request not found.", "NOT_FOUND");
  await assertCanDecide(existing, viewer);
  if (existing.status !== "PENDING") {
    throw new HttpError(409, `Request is ${existing.status.toLowerCase()}, not pending.`, "NOT_PENDING");
  }

  const updated = await withEmployeeLeaveLock(existing.employeeId, async (tx) => {
    const fresh = await tx.leaveRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (fresh.status !== "PENDING") {
      throw new HttpError(409, `Request is ${fresh.status.toLowerCase()}, not pending.`, "NOT_PENDING");
    }
    return tx.leaveRequest.update({
      where: { id: requestId },
      data: { status: "REJECTED", decidedByUserId: meta.actorUserId, decidedAt: new Date(), decisionComments: comments },
    });
  });

  await writeAuditLog({ ...meta, action: "leave.request.reject", entityType: "LeaveRequest", entityId: requestId, before: toAuditJson(existing), after: toAuditJson(updated) });
  const formatted = await reloadFormatted(requestId);
  await notifyEmployee(formatted.employeeId, {
    type: "leave.decided",
    title: "Leave rejected",
    body: `Your ${formatted.leaveTypeCode} request (${formatted.fromDate} to ${formatted.toDate}) was rejected.`,
    link: "/app/leave/balances",
    payload: { leaveRequestId: formatted.id, status: "REJECTED" },
  });
  emitLeaveDecided({
    leaveRequestId: formatted.id,
    employeeId: formatted.employeeId,
    employeeName: formatted.employeeName,
    leaveTypeCode: formatted.leaveTypeCode,
    fromDate: formatted.fromDate,
    toDate: formatted.toDate,
    totalDays: formatted.totalDays,
    status: "REJECTED",
  });
  emitTasksCounts(viewer.employeeId);
  return formatted;
}

interface BulkApproveResult {
  id: string;
  status: "approved" | "failed";
  error?: string;
}

export async function bulkApproveLeaveRequests(ids: string[], viewer: LeaveViewer, comments: string | undefined, meta: ActorMeta): Promise<BulkApproveResult[]> {
  const results: BulkApproveResult[] = [];
  for (const id of ids) {
    try {
      await approveLeaveRequest(id, viewer, comments, meta);
      results.push({ id, status: "approved" });
    } catch (err) {
      results.push({ id, status: "failed", error: err instanceof Error ? err.message : "Unknown error" });
    }
  }
  return results;
}

export async function cancelLeaveRequest(requestId: string, viewer: LeaveViewer, reason: string | undefined, meta: ActorMeta) {
  const existing = await prisma.leaveRequest.findUnique({ where: { id: requestId }, include: { leaveType: true } });
  if (!existing) throw new HttpError(404, "Leave request not found.", "NOT_FOUND");

  const isSelf = existing.employeeId === viewer.employeeId;
  if (!isSelf) {
    if (!viewer.permissions.has("leave.approve")) {
      throw new HttpError(403, "Missing permission: leave.approve", "FORBIDDEN");
    }
    const scope = resolveDataScope(viewer.roleCodes);
    if (!(await isEmployeeInScope(existing.employeeId, viewer.employeeId, scope))) {
      throw new HttpError(404, "Leave request not found.", "NOT_FOUND");
    }
  }
  if (existing.status !== "PENDING" && existing.status !== "APPROVED") {
    throw new HttpError(409, `Request is already ${existing.status.toLowerCase()}.`, "NOT_CANCELLABLE");
  }
  if (existing.status === "APPROVED") {
    await assertNoLockedPeriod(existing.employeeId, existing.fromDate, existing.toDate);
  }

  const wasApproved = existing.status === "APPROVED";
  const cancelDate = businessToday();

  const updated = await withEmployeeLeaveLock(existing.employeeId, async (tx) => {
    const fresh = await tx.leaveRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (fresh.status !== "PENDING" && fresh.status !== "APPROVED") {
      throw new HttpError(409, `Request is already ${fresh.status.toLowerCase()}.`, "NOT_CANCELLABLE");
    }

    if (fresh.status === "APPROVED") {
      const leaveYear = cancelDate.getUTCFullYear();
      if (existing.leaveType.code === "COF") {
        await reverseCompOffConsumption(tx, requestId, leaveYear, cancelDate);
      } else {
        await writeLedgerEntry(tx, {
          employeeId: existing.employeeId,
          leaveTypeId: existing.leaveType.id,
          leaveYear,
          entryDate: cancelDate,
          entryType: "REVERSAL",
          days: fresh.totalDays,
          referenceType: "LEAVE_REQUEST",
          referenceId: requestId,
          createdByUserId: meta.actorUserId,
        });
      }
    }

    return tx.leaveRequest.update({
      where: { id: requestId },
      data: { status: "CANCELLED", cancelledByUserId: meta.actorUserId, cancelledAt: new Date(), cancellationReason: reason ?? null },
    });
  });

  if (wasApproved) {
    await getAttendanceLeaveSink().onLeaveReversed(buildApprovedLeaveDays(updated, existing.leaveType.code));
  }
  await writeAuditLog({ ...meta, action: "leave.request.cancel", entityType: "LeaveRequest", entityId: requestId, before: toAuditJson(existing), after: toAuditJson(updated) });
  return reloadFormatted(requestId);
}
