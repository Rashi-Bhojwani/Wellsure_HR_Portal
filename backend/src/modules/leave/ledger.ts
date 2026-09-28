import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";

// Any Prisma client/transaction handle — every function here accepts
// either the top-level `prisma` or a `tx` from withEmployeeLeaveLock, so
// balance reads/writes can happen either standalone or inside the same
// locked transaction as the write that depends on them.
type Queryable = typeof prisma | Prisma.TransactionClient;

// The source of truth (spec §5.3): balance for (employee, leaveType) as of
// any date = SUM(days) over every ledger entry with entry_date <= asOfDate
// — full history, never scoped by leave_year (that column is a reporting/
// filter tag only — see schema.prisma's comment on LeaveLedger). This is
// also what makes "carry forward with no cap" free: there is no separate
// carry-forward operation, just the absence of any entry that would
// reduce the running balance.
export async function getLeaveBalance(db: Queryable, employeeId: string, leaveTypeId: string, asOfDate: Date = new Date()): Promise<Prisma.Decimal> {
  const result = await db.leaveLedger.aggregate({
    _sum: { days: true },
    where: { employeeId, leaveTypeId, entryDate: { lte: asOfDate } },
  });
  return result._sum.days ?? new Prisma.Decimal(0);
}

export interface LeaveBalanceDetail {
  granted: Prisma.Decimal; // sum of positive entries only (ACCRUAL/GRANT/CARRY_FORWARD/OPENING) — the "Granted"
  // figure the Leave Balances cards show, distinct from the net running balance
  balance: Prisma.Decimal;
}

// Same balance as getLeaveBalance, plus the cumulative "granted" total —
// small enough a dataset per (employee, leaveType) over a career that
// summing in JS after one fetch is simpler and just as correct as a
// conditional-aggregate raw query.
export async function getLeaveBalanceDetail(db: Queryable, employeeId: string, leaveTypeId: string, asOfDate: Date = new Date()): Promise<LeaveBalanceDetail> {
  const rows = await db.leaveLedger.findMany({
    where: { employeeId, leaveTypeId, entryDate: { lte: asOfDate } },
    select: { days: true },
  });
  let granted = new Prisma.Decimal(0);
  let balance = new Prisma.Decimal(0);
  for (const row of rows) {
    balance = balance.plus(row.days);
    if (row.days.greaterThan(0)) granted = granted.plus(row.days);
  }
  return { granted, balance };
}

// Every type's balance for one employee in a single query — used by the
// Leave Balances screen.
export async function getLeaveBalancesForEmployee(db: Queryable, employeeId: string, asOfDate: Date = new Date()): Promise<Map<string, Prisma.Decimal>> {
  const rows = await db.leaveLedger.groupBy({
    by: ["leaveTypeId"],
    where: { employeeId, entryDate: { lte: asOfDate } },
    _sum: { days: true },
  });
  return new Map(rows.map((r) => [r.leaveTypeId, r._sum.days ?? new Prisma.Decimal(0)]));
}

// Extends HttpError (same convention separations.ts uses) so the global
// error handler maps this to a proper 400 automatically, rather than
// falling through to a generic 500 — every throw site (apply, approve,
// comp-off FIFO consumption) gets this for free without its own try/catch.
export class InsufficientLeaveBalanceError extends HttpError {
  constructor(
    public readonly available: Prisma.Decimal,
    public readonly requested: Prisma.Decimal,
  ) {
    super(400, `Insufficient balance: available ${available.toFixed(2)}, requested ${requested.toFixed(2)}`, "INSUFFICIENT_BALANCE");
    this.name = "InsufficientLeaveBalanceError";
  }
}

interface BalancePolicyFields {
  skipBalanceCheck: boolean;
  negativeBalanceAllowed: boolean;
}

// The generic balance gate used by any ledger-tracked type EXCEPT comp-off
// (COF's authoritative check is its own FIFO lot sum in compOff.ts, not
// this aggregate — see that file's comment for why). LOP's
// skipBalanceCheck bypasses this entirely: it has no balance concept at
// all, rather than an "unlimited" number run through the same machinery.
export async function assertSufficientBalance(
  db: Queryable,
  employeeId: string,
  leaveTypeId: string,
  policy: BalancePolicyFields,
  requestedDays: Prisma.Decimal.Value,
  asOfDate: Date = new Date(),
): Promise<void> {
  if (policy.skipBalanceCheck) return;
  if (policy.negativeBalanceAllowed) return;
  const balance = await getLeaveBalance(db, employeeId, leaveTypeId, asOfDate);
  const requested = new Prisma.Decimal(requestedDays);
  if (balance.lessThan(requested)) {
    throw new InsufficientLeaveBalanceError(balance, requested);
  }
}

interface WriteLedgerEntryInput {
  employeeId: string;
  leaveTypeId: string;
  leaveYear: number;
  entryDate: Date;
  accrualMonth?: Date | null;
  entryType: Prisma.LeaveLedgerCreateInput["entryType"];
  days: Prisma.Decimal.Value;
  referenceType?: string | null;
  referenceId?: string | null;
  compOffCreditId?: string | null;
  remarks?: string | null;
  createdByUserId?: string | null;
}

// The only function that should insert a leave_ledger row — not enforced
// by a DB trigger (unlike audit_logs, whose redaction genuinely can't be
// skipped this way without one), but every write path in this module goes
// through it so the shape stays consistent (signed `days`, correct
// accrualMonth-only-on-ACCRUAL discipline) in one place.
export async function writeLedgerEntry(db: Queryable, input: WriteLedgerEntryInput) {
  return db.leaveLedger.create({
    data: {
      employeeId: input.employeeId,
      leaveTypeId: input.leaveTypeId,
      leaveYear: input.leaveYear,
      entryDate: input.entryDate,
      accrualMonth: input.accrualMonth ?? null,
      entryType: input.entryType,
      days: new Prisma.Decimal(input.days),
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      compOffCreditId: input.compOffCreditId ?? null,
      remarks: input.remarks ?? null,
      createdByUserId: input.createdByUserId ?? null,
    },
  });
}
