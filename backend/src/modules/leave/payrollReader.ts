import { prisma } from "../../lib/prisma";

// What payroll may read from the leave module: year-end encashments that HR has COMMITTED (the leave balance was already debited), nothing else. Payroll never
// queries the year-end tables itself (currentRowGuard.test.ts), so a preview that was never committed can never be paid.

export interface CommittedEncashment {
  itemId: string;
  employeeId: string;
  leaveYear: number;
  days: string;
  dailyRate: string;
  amount: string;
  rateSource: string;
  committedAt: Date;
}

/** Committed year-end items, optionally for some people. Each is paid once: the unique (source, source ref) on the adjustment the payroll run makes from it. */
export async function committedEncashments(employeeIds?: string[]): Promise<CommittedEncashment[]> {
  const items = await prisma.yearEndRunItem.findMany({
    where: { yearEndRun: { status: "COMMITTED" }, ledgerEncashmentEntryId: { not: null }, ...(employeeIds ? { employeeId: { in: employeeIds } } : {}) },
    include: { yearEndRun: { select: { leaveYear: true, committedAt: true } } },
    orderBy: { id: "asc" },
  });
  return items
    .filter((i) => i.encashedAmount.greaterThan(0) && i.yearEndRun.committedAt !== null)
    .map((i) => ({
      itemId: i.id,
      employeeId: i.employeeId,
      leaveYear: i.yearEndRun.leaveYear,
      days: i.encashedDays.toString(),
      dailyRate: i.dailyRate.toString(),
      amount: i.encashedAmount.toString(),
      rateSource: i.rateSource,
      committedAt: i.yearEndRun.committedAt!,
    }));
}
