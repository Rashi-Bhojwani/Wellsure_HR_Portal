import { Prisma, type CompOffCredit } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { addCalendarDays, businessToday } from "../../lib/businessDate";
import { HttpError } from "../../middleware/errorHandler";
import { withEmployeeLeaveLock } from "./concurrency";
import { writeLedgerEntry, InsufficientLeaveBalanceError } from "./ledger";

// Extends HttpError, same reasoning as InsufficientLeaveBalanceError
// (ledger.ts) — a 400 the global error handler maps automatically.
export class InsufficientHoursForCompOffError extends HttpError {
  constructor(
    public readonly hoursWorked: number,
    public readonly minHoursRequired: number,
  ) {
    super(400, `${hoursWorked}h worked is below the ${minHoursRequired}h minimum required to earn a comp-off`, "INSUFFICIENT_HOURS");
    this.name = "InsufficientHoursForCompOffError";
  }
}

interface CreditCompOffInput {
  employeeId: string;
  earnedDate: Date;
  hoursWorked: number;
  source: "MANUAL_GRANT" | "ATTENDANCE";
  grantedByUserId?: string | null;
}

// Phase 4 calls this only from Leave Granter (source: "MANUAL_GRANT").
// Phase 2's attendance rules engine will call the exact same function with
// source: "ATTENDANCE" once it detects a qualifying holiday/week-off
// punch (spec §4.4) — reusing this eligibility check, expiry computation
// and ledger GRANT entry rather than reimplementing any of it.
export async function creditCompOff(input: CreditCompOffInput): Promise<CompOffCredit> {
  const cofType = await prisma.leaveType.findUniqueOrThrow({ where: { code: "COF" }, include: { policy: true } });
  const minHours = cofType.policy?.compOffMinHoursWorked ? Number(cofType.policy.compOffMinHoursWorked) : 4;
  if (input.hoursWorked < minHours) {
    throw new InsufficientHoursForCompOffError(input.hoursWorked, minHours);
  }
  const expiryDays = cofType.policy?.compOffExpiryDays ?? 60;
  const expiresOn = addCalendarDays(input.earnedDate, expiryDays);
  const earnedDays = new Prisma.Decimal(1); // Phase 4 always grants a full day — partial-day comp-off
  // (e.g. 0.5 for a short shift worked) is a future refinement, not asked for here

  return withEmployeeLeaveLock(input.employeeId, async (tx) => {
    const ledgerEntry = await writeLedgerEntry(tx, {
      employeeId: input.employeeId,
      leaveTypeId: cofType.id,
      leaveYear: input.earnedDate.getUTCFullYear(),
      entryDate: input.earnedDate,
      entryType: "GRANT",
      days: earnedDays,
      referenceType: input.source === "MANUAL_GRANT" ? "MANUAL_GRANT" : "ATTENDANCE",
      createdByUserId: input.grantedByUserId ?? null,
      remarks: `Comp-off earned ${input.earnedDate.toISOString().slice(0, 10)} (${input.hoursWorked}h worked)`,
    });

    return tx.compOffCredit.create({
      data: {
        employeeId: input.employeeId,
        earnedDate: input.earnedDate,
        earnedDays,
        remainingDays: earnedDays,
        expiresOn,
        source: input.source,
        grantedByUserId: input.grantedByUserId ?? null,
        ledgerEntryId: ledgerEntry.id,
      },
    });
  });
}

// FIFO consumption (oldest earnedDate first), called from leave-request
// approval for a COF-type request, inside the same employee-locked
// transaction as the approval. One LeaveLedger CONSUMED row is written
// PER LOT TOUCHED (not one combined row), each carrying compOffCreditId —
// this is what makes reversal exact rather than a guess (see
// reverseCompOffConsumption below). Throws InsufficientLeaveBalanceError
// (reusing the same error the generic balance check uses) if the total
// AVAILABLE remainingDays can't cover the request.
export async function consumeCompOffFifo(
  tx: Prisma.TransactionClient,
  employeeId: string,
  leaveRequestId: string,
  totalDays: Prisma.Decimal.Value,
  leaveYear: number,
  entryDate: Date,
): Promise<void> {
  const cofType = await tx.leaveType.findUniqueOrThrow({ where: { code: "COF" } });
  let need = new Prisma.Decimal(totalDays);

  const credits = await tx.compOffCredit.findMany({
    where: { employeeId, status: "AVAILABLE" },
    orderBy: { earnedDate: "asc" },
  });

  const totalAvailable = credits.reduce((sum, c) => sum.plus(c.remainingDays), new Prisma.Decimal(0));
  if (totalAvailable.lessThan(need)) {
    throw new InsufficientLeaveBalanceError(totalAvailable, need);
  }

  for (const credit of credits) {
    if (need.lessThanOrEqualTo(0)) break;
    const take = need.lessThan(credit.remainingDays) ? need : credit.remainingDays;
    const newRemaining = credit.remainingDays.minus(take);

    await tx.compOffCredit.update({
      where: { id: credit.id },
      data: { remainingDays: newRemaining, status: newRemaining.equals(0) ? "CONSUMED" : "AVAILABLE" },
    });
    await writeLedgerEntry(tx, {
      employeeId,
      leaveTypeId: cofType.id,
      leaveYear,
      entryDate,
      entryType: "CONSUMED",
      days: take.negated(),
      referenceType: "LEAVE_REQUEST",
      referenceId: leaveRequestId,
      compOffCreditId: credit.id,
    });
    need = need.minus(take);
  }
}

// Cancel-after-approval reversal: reads the exact lots a COF request's
// approval touched straight off the ledger (every CONSUMED row for this
// leaveRequestId with a compOffCreditId set) and credits each one back —
// no guessing which lot to restore. A lot whose expiresOn has already
// passed by the time a late cancellation arrives is restored AVAILABLE
// regardless; the next daily expiry job run sweeps it up naturally (its
// expiresOn is already in the past), so no special-casing is needed here.
export async function reverseCompOffConsumption(tx: Prisma.TransactionClient, leaveRequestId: string, leaveYear: number, entryDate: Date): Promise<void> {
  // Per lot: what the approval consumed, less what HR already gave back by releasing single days (Phase 3), so a
  // cancellation after a release never returns the same days twice.
  const cofType = await tx.leaveType.findUniqueOrThrow({ where: { code: "COF" } });
  for (const [creditId, net] of await consumedPerLot(tx, leaveRequestId)) {
    if (!net.greaterThan(0)) continue;
    const credit = await tx.compOffCredit.findUniqueOrThrow({ where: { id: creditId } });
    const newRemaining = credit.remainingDays.plus(net);

    await tx.compOffCredit.update({
      where: { id: credit.id },
      data: { remainingDays: newRemaining, status: newRemaining.greaterThan(0) ? "AVAILABLE" : credit.status },
    });
    await writeLedgerEntry(tx, {
      employeeId: credit.employeeId,
      leaveTypeId: cofType.id,
      leaveYear,
      entryDate,
      entryType: "REVERSAL",
      days: net,
      referenceType: "LEAVE_REQUEST",
      referenceId: leaveRequestId,
      compOffCreditId: credit.id,
    });
  }
}

/** Per comp-off lot, the days of this request still consumed: its CONSUMED rows less the reversals of releases. */
async function consumedPerLot(tx: Prisma.TransactionClient, leaveRequestId: string): Promise<Map<string, Prisma.Decimal>> {
  const releaseIds = (await tx.leaveDayRelease.findMany({ where: { leaveRequestId }, select: { id: true } })).map((r) => r.id);
  const rows = await tx.leaveLedger.findMany({
    where: {
      compOffCreditId: { not: null },
      OR: [
        { referenceType: "LEAVE_REQUEST", referenceId: leaveRequestId, entryType: "CONSUMED" },
        ...(releaseIds.length ? [{ referenceType: "LEAVE_DAY_RELEASE", referenceId: { in: releaseIds }, entryType: "REVERSAL" as const }] : []),
      ],
    },
    select: { compOffCreditId: true, days: true },
  });
  const net = new Map<string, Prisma.Decimal>();
  for (const r of rows) net.set(r.compOffCreditId!, (net.get(r.compOffCreditId!) ?? new Prisma.Decimal(0)).minus(r.days)); // CONSUMED is negative
  return net;
}

// Phase 3 (leave day worked): give `amount` days of a COF request back to its lots, newest lot first, exactly the
// lots the approval drew on and never more than each still has consumed. Same expiry note as above: a lot already
// past its expiry is restored AVAILABLE and the next expiry run sweeps it.
export async function restoreCompOffDays(
  tx: Prisma.TransactionClient,
  p: { leaveRequestId: string; releaseId: string; employeeId: string; amount: Prisma.Decimal; leaveYear: number; entryDate: Date; remarks: string; actorUserId: string },
): Promise<void> {
  const cofType = await tx.leaveType.findUniqueOrThrow({ where: { code: "COF" } });
  const perLot = await consumedPerLot(tx, p.leaveRequestId);
  const credits = await tx.compOffCredit.findMany({ where: { id: { in: [...perLot.keys()] } }, orderBy: { earnedDate: "desc" } });
  let left = p.amount;
  for (const credit of credits) {
    if (left.lessThanOrEqualTo(0)) break;
    const available = perLot.get(credit.id) ?? new Prisma.Decimal(0);
    if (!available.greaterThan(0)) continue;
    const give = left.lessThan(available) ? left : available;
    await tx.compOffCredit.update({ where: { id: credit.id }, data: { remainingDays: credit.remainingDays.plus(give), status: "AVAILABLE" } });
    await writeLedgerEntry(tx, {
      employeeId: p.employeeId,
      leaveTypeId: cofType.id,
      leaveYear: p.leaveYear,
      entryDate: p.entryDate,
      entryType: "REVERSAL",
      days: give,
      referenceType: "LEAVE_DAY_RELEASE",
      referenceId: p.releaseId,
      compOffCreditId: credit.id,
      remarks: p.remarks,
      createdByUserId: p.actorUserId,
    });
    left = left.minus(give);
  }
}

// The daily expiry job (spec §5.5), simplified from an earlier draft of
// this design: because remainingDays is FIFO-tracked precisely per lot,
// expiry needs no defensive re-check against an aggregate ledger balance
// — it just debits whatever remainingDays is left on a lot past
// expiresOn. Structurally idempotent (no separate DB constraint needed,
// unlike accrual): once a credit's status flips to EXPIRED, the
// `status: "AVAILABLE"` filter excludes it from every future run.
export async function expireCompOffCredits(asOfDate: Date = businessToday()): Promise<{ expired: number }> {
  const cofType = await prisma.leaveType.findUniqueOrThrow({ where: { code: "COF" } });
  const candidates = await prisma.compOffCredit.findMany({
    where: { status: "AVAILABLE", expiresOn: { lt: asOfDate } },
  });

  let expired = 0;
  for (const candidate of candidates) {
    await withEmployeeLeaveLock(candidate.employeeId, async (tx) => {
      // Re-read inside the lock in case a concurrent consumption/reversal
      // changed this credit since the outer query ran.
      const fresh = await tx.compOffCredit.findUniqueOrThrow({ where: { id: candidate.id } });
      if (fresh.status !== "AVAILABLE" || fresh.remainingDays.lessThanOrEqualTo(0)) return;

      await tx.compOffCredit.update({
        where: { id: fresh.id },
        data: { remainingDays: new Prisma.Decimal(0), status: "EXPIRED" },
      });
      await writeLedgerEntry(tx, {
        employeeId: fresh.employeeId,
        leaveTypeId: cofType.id,
        leaveYear: asOfDate.getUTCFullYear(),
        entryDate: asOfDate,
        entryType: "EXPIRY",
        days: fresh.remainingDays.negated(),
        referenceType: "COMP_OFF_EXPIRY",
        compOffCreditId: fresh.id,
      });
      expired += 1;
    });
  }
  return { expired };
}
