import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { writeAuditLog } from "../../lib/audit";
import { HttpError } from "../../middleware/errorHandler";
import { creditCompOff } from "./compOff";
import { withEmployeeLeaveLock } from "./concurrency";
import { assertSufficientBalance, writeLedgerEntry } from "./ledger";
import { isEmployeeInScope } from "./scope";
import { isLeaveTypeFor } from "./leaveTypeRoles";
import type { ActorMeta, LeaveViewer } from "./types";

// Leave Granter's manual single-entry path (spec §5's Leave Granter
// screen) — any type except COF, which has its own dedicated grant below
// (it needs hoursWorked to compute eligibility/expiry, not just a day
// count). A positive `days` writes a GRANT row, negative writes DEBIT —
// same writeLedgerEntry every other write path in this module goes
// through, under the same per-employee lock.
interface ManualGrantInput {
  employeeId: string;
  leaveTypeId: string;
  days: number;
  entryDate: string;
  remarks?: string;
}

// FIX-C3 (independent audit 2026-11-20): a manual grant or debit is no longer written by the person who asks for it. The route proposes it
// (modules/leave/changeRequests.ts); this runs only when a director other than the proposer confirms, inside the confirmation's transaction.
export async function validateManualGrant(input: ManualGrantInput) {
  const employee = await prisma.employee.findUnique({ where: { id: input.employeeId }, select: { id: true, status: true } });
  if (!employee || employee.status !== "ACTIVE") throw new HttpError(404, "Employee not found.", "NOT_FOUND");
  const leaveType = await prisma.leaveType.findUnique({ where: { id: input.leaveTypeId }, include: { policy: true } });
  if (!leaveType || !leaveType.isActive) throw new HttpError(400, "Invalid leave type.", "INVALID_LEAVE_TYPE");
  if (await isLeaveTypeFor("COMP_OFF", leaveType.id)) throw new HttpError(400, "Use the Comp-Off Grant action for comp-off credits — it needs hours worked to compute expiry.", "USE_COMP_OFF_GRANT");
  if (new Prisma.Decimal(input.days).equals(0)) throw new HttpError(400, "days must not be zero.", "INVALID_DAYS");
  return leaveType;
}

export async function manualGrantOrDebit(input: ManualGrantInput, meta: ActorMeta, db?: Prisma.TransactionClient) {
  const employee = await prisma.employee.findUnique({ where: { id: input.employeeId }, select: { id: true, status: true } });
  if (!employee || employee.status !== "ACTIVE") {
    throw new HttpError(404, "Employee not found.", "NOT_FOUND");
  }

  const leaveType = await prisma.leaveType.findUnique({ where: { id: input.leaveTypeId }, include: { policy: true } });
  if (!leaveType || !leaveType.isActive) {
    throw new HttpError(400, "Invalid leave type.", "INVALID_LEAVE_TYPE");
  }
  if (await isLeaveTypeFor("COMP_OFF", leaveType.id)) {
    throw new HttpError(400, "Use the Comp-Off Grant action for comp-off credits — it needs hours worked to compute expiry.", "USE_COMP_OFF_GRANT");
  }

  const days = new Prisma.Decimal(input.days);
  if (days.equals(0)) {
    throw new HttpError(400, "days must not be zero.", "INVALID_DAYS");
  }
  const entryDate = new Date(input.entryDate);
  const entryType = days.greaterThan(0) ? "GRANT" : "DEBIT";

  const locked = <T,>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
    db ? db.$queryRaw`SELECT id FROM employees WHERE id = ${input.employeeId} FOR UPDATE`.then(() => fn(db)) : withEmployeeLeaveLock(input.employeeId, fn);
  const entry = await locked(async (tx) => {
    if (days.lessThan(0)) {
      const policy = leaveType.policy;
      if (!policy?.skipBalanceCheck) {
        await assertSufficientBalance(tx, input.employeeId, leaveType.id, policy ?? { skipBalanceCheck: false, negativeBalanceAllowed: false }, days.negated(), entryDate);
      }
    }
    return writeLedgerEntry(tx, {
      employeeId: input.employeeId,
      leaveTypeId: leaveType.id,
      leaveYear: entryDate.getUTCFullYear(),
      entryDate,
      entryType,
      days,
      referenceType: "MANUAL_GRANT",
      remarks: input.remarks ?? null,
      createdByUserId: meta.actorUserId,
    });
  });

  await writeAuditLog({
    ...meta,
    action: entryType === "GRANT" ? "leave.grant.credit" : "leave.grant.debit",
    entityType: "LeaveLedger",
    entityId: entry.id,
    after: { employeeId: input.employeeId, leaveTypeId: leaveType.id, leaveTypeCode: leaveType.code, days: days.toNumber(), entryDate: input.entryDate, remarks: input.remarks ?? null },
  });

  return {
    id: entry.id,
    employeeId: input.employeeId,
    leaveTypeId: leaveType.id,
    leaveTypeCode: leaveType.code,
    entryType,
    days: days.toNumber(),
    entryDate: input.entryDate,
    remarks: input.remarks ?? null,
  };
}

// Leave Granter's comp-off path — thin wrapper over compOff.ts's
// creditCompOff (source: "MANUAL_GRANT"), the same function Phase 2's
// attendance rules engine will call later with source: "ATTENDANCE".
interface ManualCompOffGrantInput {
  employeeId: string;
  earnedDate: string;
  hoursWorked: number;
  remarks?: string;
}

export async function manualCompOffGrant(input: ManualCompOffGrantInput, meta: ActorMeta, db?: Prisma.TransactionClient) {
  const employee = await prisma.employee.findUnique({ where: { id: input.employeeId }, select: { id: true, status: true } });
  if (!employee || employee.status !== "ACTIVE") {
    throw new HttpError(404, "Employee not found.", "NOT_FOUND");
  }

  const credit = await creditCompOff({
    employeeId: input.employeeId,
    earnedDate: new Date(input.earnedDate),
    hoursWorked: input.hoursWorked,
    source: "MANUAL_GRANT",
    grantedByUserId: meta.actorUserId,
  }, db);

  await writeAuditLog({
    ...meta,
    action: "leave.grant.compOff",
    entityType: "CompOffCredit",
    entityId: credit.id,
    after: { employeeId: input.employeeId, earnedDate: input.earnedDate, hoursWorked: input.hoursWorked, earnedDays: credit.earnedDays.toNumber(), expiresOn: credit.expiresOn.toISOString().slice(0, 10), remarks: input.remarks ?? null },
  });

  return {
    id: credit.id,
    employeeId: credit.employeeId,
    earnedDate: credit.earnedDate.toISOString().slice(0, 10),
    earnedDays: credit.earnedDays.toNumber(),
    remainingDays: credit.remainingDays.toNumber(),
    expiresOn: credit.expiresOn.toISOString().slice(0, 10),
    status: credit.status,
    source: credit.source,
  };
}

// Every comp-off lot for one employee (earned/remaining/status/expiry) —
// the Leave Granter and Employee Leave admin screens' comp-off detail
// view. Same SELF/TEAM/ALL + leave.view gate as getLeaveBalancesForDisplay.
export async function listCompOffCredits(targetEmployeeId: string, viewer: LeaveViewer) {
  if (targetEmployeeId !== viewer.employeeId) {
    if (!viewer.permissions.has("leave.view")) {
      throw new HttpError(403, "Missing permission: leave.view", "FORBIDDEN");
    }
    const scope = viewer.dataScope;
    if (!(await isEmployeeInScope(targetEmployeeId, viewer.employeeId, scope))) {
      throw new HttpError(404, "Employee not found.", "NOT_FOUND");
    }
  }

  const credits = await prisma.compOffCredit.findMany({
    where: { employeeId: targetEmployeeId },
    orderBy: { earnedDate: "desc" },
  });
  return credits.map((c) => ({
    id: c.id,
    earnedDate: c.earnedDate.toISOString().slice(0, 10),
    earnedDays: c.earnedDays.toNumber(),
    remainingDays: c.remainingDays.toNumber(),
    expiresOn: c.expiresOn.toISOString().slice(0, 10),
    status: c.status,
    source: c.source,
  }));
}
