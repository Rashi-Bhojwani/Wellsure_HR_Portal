import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";

// Any code path that writes to leave_ledger or leave_requests for a given
// employee — apply, approve (balance check + FIFO comp-off consumption),
// cancel/reversal, manual grant, the per-employee step of the accrual job
// and the recalculator — must hold that employee's row lock for the
// duration of its transaction. Without this, two concurrent writes (two
// approvals racing each other, or an approval racing a cancellation) can
// both read a stale balance and both proceed, pushing it negative. One
// small, consistently-used primitive rather than bespoke locking per call
// site.
export async function withEmployeeLeaveLock<T>(employeeId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM employees WHERE id = ${employeeId} FOR UPDATE`;
    return fn(tx);
  });
}
