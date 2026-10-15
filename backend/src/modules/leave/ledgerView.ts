import { prisma } from "../../lib/prisma";
import { businessToday } from "../../lib/businessDate";
import { HttpError } from "../../middleware/errorHandler";
import { isEmployeeInScope, resolveApprovalReach } from "./scope";
import type { LeaveViewer } from "./types";

// The leave ledger as a person reads it (Phase 3 commit 2): every credit and debit, newest first, with a plain
// description and the reason HR gave when it was HR's doing — in particular the days returned when HR released leave
// on a day the person worked. Same visibility as balances: your own; someone else's only within your scope.

export interface LedgerLine {
  id: string;
  date: string;
  leaveTypeCode: string;
  entryType: string;
  days: number;
  description: string;
  remarks: string | null;
  /** Set for a line caused by HR releasing leave on a day worked: the attendance day it concerns. */
  releasedDate: string | null;
}

const WORDS: Record<string, string> = {
  OPENING: "Opening balance",
  ACCRUAL: "Monthly credit",
  CONSUMED: "Leave taken",
  GRANT: "Granted by HR",
  DEBIT: "Deducted",
  CARRY_FORWARD: "Carried forward",
  ENCASHMENT: "Encashed at year end",
  LAPSE: "Lapsed",
  EXPIRY: "Expired",
};

function describe(entryType: string, referenceType: string | null): string {
  if (entryType === "REVERSAL") {
    if (referenceType === "LEAVE_DAY_RELEASE") return "Returned: you worked on a day of approved leave";
    if (referenceType === "LEAVE_REQUEST") return "Returned: leave cancelled";
    return "Reversed";
  }
  return WORDS[entryType] ?? entryType;
}

export async function getLeaveLedger(targetEmployeeId: string | undefined, viewer: LeaveViewer, opts: { leaveTypeId?: string; limit?: number } = {}): Promise<LedgerLine[]> {
  const employeeId = targetEmployeeId ?? viewer.employeeId;
  if (employeeId !== viewer.employeeId) {
    const delegated = (await resolveApprovalReach(viewer)).delegated.has(employeeId);
    if (!delegated) {
      if (!viewer.permissions.has("leave.view")) throw new HttpError(403, "Missing permission: leave.view", "FORBIDDEN");
      if (!(await isEmployeeInScope(employeeId, viewer.employeeId, viewer.dataScope))) throw new HttpError(404, "Employee not found.", "NOT_FOUND");
    }
  }
  const rows = await prisma.leaveLedger.findMany({
    where: { employeeId, entryDate: { lte: businessToday() }, ...(opts.leaveTypeId ? { leaveTypeId: opts.leaveTypeId } : {}) },
    include: { leaveType: { select: { code: true } } },
    orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
    take: opts.limit ?? 200,
  });
  const releaseIds = rows.filter((r) => r.referenceType === "LEAVE_DAY_RELEASE" && r.referenceId).map((r) => r.referenceId!);
  const releases = releaseIds.length ? await prisma.leaveDayRelease.findMany({ where: { id: { in: releaseIds } }, select: { id: true, date: true } }) : [];
  const dateOf = new Map(releases.map((r) => [r.id, r.date.toISOString().slice(0, 10)]));
  return rows.map((r) => ({
    id: r.id,
    date: r.entryDate.toISOString().slice(0, 10),
    leaveTypeCode: r.leaveType.code,
    entryType: r.entryType,
    days: r.days.toNumber(),
    description: describe(r.entryType, r.referenceType),
    remarks: r.remarks,
    releasedDate: r.referenceType === "LEAVE_DAY_RELEASE" && r.referenceId ? (dateOf.get(r.referenceId) ?? null) : null,
  }));
}
