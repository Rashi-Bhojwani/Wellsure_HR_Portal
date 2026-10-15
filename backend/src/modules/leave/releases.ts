import { Prisma, type LeaveDayPart } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { restoreCompOffDays } from "./compOff";
import { writeLedgerEntry } from "./ledger";

// Releasing approved leave on a day the person actually worked (Phase 3 commit 2, docs/plans/PHASE_3.md "Leave day
// worked"). Manual Override calls this inside its own transaction, so the attendance override and the leave
// reversal are one action: the day never reads worked while the ledger still says consumed. Everything here is
// explicit and visible: a leave_day_releases row, a REVERSAL in the leave ledger that points back to it (reference
// LEAVE_DAY_RELEASE) with the date and reason in its remarks, and the attendance override.

const iso = (d: Date) => d.toISOString().slice(0, 10);

export interface LeaveCover {
  requestId: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  part: LeaveDayPart;
  /** The days this date accounts for: 1 for a full day, 0.5 for a half. */
  days: number;
}

type Db = Prisma.TransactionClient | typeof prisma;

/** The approved leave covering this employee on this date that has not been released yet (one per half at most). */
export async function leaveCoverOn(db: Db, employeeId: string, date: string): Promise<LeaveCover[]> {
  const d = new Date(`${date}T00:00:00Z`);
  const requests = await db.leaveRequest.findMany({
    where: { employeeId, status: "APPROVED", fromDate: { lte: d }, toDate: { gte: d } },
    select: { id: true, fromDate: true, toDate: true, fromDayPart: true, toDayPart: true, leaveType: { select: { id: true, code: true } } },
  });
  if (requests.length === 0) return [];
  const released = new Set((await db.leaveDayRelease.findMany({ where: { employeeId, date: d }, select: { leaveRequestId: true } })).map((r) => r.leaveRequestId));
  return requests
    .filter((r) => !released.has(r.id))
    .map((r) => {
      const part: LeaveDayPart = iso(r.fromDate) === date ? r.fromDayPart : iso(r.toDate) === date ? r.toDayPart : "FULL";
      return { requestId: r.id, leaveTypeId: r.leaveType.id, leaveTypeCode: r.leaveType.code, part, days: part === "FULL" ? 1 : 0.5 };
    });
}

/** How many days of this request are still consumed: its CONSUMED rows less every reversal of it (cancellation excluded: that ends the request). */
async function stillConsumed(tx: Prisma.TransactionClient, requestId: string, releaseIds: string[]): Promise<Prisma.Decimal> {
  const rows = await tx.leaveLedger.findMany({
    where: {
      OR: [
        { referenceType: "LEAVE_REQUEST", referenceId: requestId, entryType: { in: ["CONSUMED", "REVERSAL"] } },
        ...(releaseIds.length ? [{ referenceType: "LEAVE_DAY_RELEASE", referenceId: { in: releaseIds }, entryType: "REVERSAL" as const }] : []),
      ],
    },
    select: { days: true },
  });
  return rows.reduce((sum, r) => sum.minus(r.days), new Prisma.Decimal(0));
}

export interface ReleasedLeave {
  releaseId: string;
  requestId: string;
  leaveTypeCode: string;
  part: LeaveDayPart;
  daysReturned: number;
}

/**
 * Release this employee's approved leave on `date` and return the days to the balance. Call inside a transaction
 * that has locked the employee row (the leave module's own lock), after the attendance override row exists.
 */
export async function releaseLeaveOnDay(
  tx: Prisma.TransactionClient,
  input: { employeeId: string; date: string; overrideId: string; reason: string; actorUserId: string; covers?: LeaveCover[] },
): Promise<ReleasedLeave[]> {
  const covers = input.covers ?? (await leaveCoverOn(tx, input.employeeId, input.date));
  const date = new Date(`${input.date}T00:00:00Z`);
  const out: ReleasedLeave[] = [];
  for (const c of covers) {
    const earlier = await tx.leaveDayRelease.findMany({ where: { leaveRequestId: c.requestId }, select: { id: true } });
    const consumed = await stillConsumed(tx, c.requestId, earlier.map((r) => r.id));
    const returned = Prisma.Decimal.min(new Prisma.Decimal(c.days), Prisma.Decimal.max(consumed, new Prisma.Decimal(0)));
    const release = await tx.leaveDayRelease.create({
      data: {
        employeeId: input.employeeId,
        date,
        leaveRequestId: c.requestId,
        leaveTypeId: c.leaveTypeId,
        dayPart: c.part,
        days: returned,
        overrideId: input.overrideId,
        reason: input.reason,
        createdByUserId: input.actorUserId,
      },
    });
    if (returned.greaterThan(0)) {
      const remarks = `Worked on approved leave, ${input.date}: the leave for this day was released by HR. ${input.reason}`;
      const entryDate = date;
      if (c.leaveTypeCode === "COF") {
        await restoreCompOffDays(tx, { leaveRequestId: c.requestId, releaseId: release.id, employeeId: input.employeeId, amount: returned, leaveYear: entryDate.getUTCFullYear(), entryDate, remarks, actorUserId: input.actorUserId });
      } else {
        await writeLedgerEntry(tx, {
          employeeId: input.employeeId,
          leaveTypeId: c.leaveTypeId,
          leaveYear: entryDate.getUTCFullYear(),
          entryDate,
          entryType: "REVERSAL",
          days: returned,
          referenceType: "LEAVE_DAY_RELEASE",
          referenceId: release.id,
          remarks,
          createdByUserId: input.actorUserId,
        });
      }
    }
    out.push({ releaseId: release.id, requestId: c.requestId, leaveTypeCode: c.leaveTypeCode, part: c.part, daysReturned: returned.toNumber() });
  }
  return out;
}

/** The days of a request already returned by releases: what a later cancellation must not return twice. */
export async function releasedDaysOf(db: Db, requestId: string): Promise<Prisma.Decimal> {
  const rows = await db.leaveDayRelease.findMany({ where: { leaveRequestId: requestId }, select: { days: true } });
  return rows.reduce((sum, r) => sum.plus(r.days), new Prisma.Decimal(0));
}

/** Dates (YYYY-MM-DD) of a request that HR released, for the calendar and request views. */
export async function releasedDatesOf(db: Db, requestIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (requestIds.length === 0) return out;
  for (const r of await db.leaveDayRelease.findMany({ where: { leaveRequestId: { in: requestIds } }, select: { leaveRequestId: true, date: true }, orderBy: { date: "asc" } })) {
    out.set(r.leaveRequestId, [...(out.get(r.leaveRequestId) ?? []), iso(r.date)]);
  }
  return out;
}

