import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";

// Workforce Overview dashboard (docs/UI_REFERENCE.md §2.3) — org-wide
// aggregates only (no SELF/TEAM scoping, gated by leave.view same as the
// rest of the admin leave surface). One fetch per selected year returns
// every (month, leaveTypeCode) total for the whole year so the frontend
// can slice both the month-strip donut and the "Category: All" filters
// on each card without extra round trips.
//
// Both leave-day aggregates bucket by the request's `fromDate` — the same
// convention writeLedgerEntry uses for a CONSUMED row's entryDate (see
// requests.ts), so a multi-day/multi-month request is attributed whole to
// the month it started in, consistent with what the ledger itself shows.

export interface WorkforceDashboardResult {
  year: number;
  leaveTypes: string[]; // active leave type codes, so the frontend can render a full legend/filter list even for zero-value types
  byMonthAndType: { month: number; leaveTypeCode: string; days: number }[]; // non-zero combos only
  rhBreakdown: { date: string; name: string; employeeCount: number }[]; // restricted holidays actually taken this year, non-zero only
}

export async function getWorkforceDashboard(year: number): Promise<WorkforceDashboardResult> {
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year, 11, 31));

  const types = await prisma.leaveType.findMany({ where: { isActive: true }, orderBy: { code: "asc" }, select: { code: true } });

  const requests = await prisma.leaveRequest.findMany({
    where: { status: "APPROVED", fromDate: { gte: yearStart, lte: yearEnd } },
    select: { fromDate: true, totalDays: true, leaveType: { select: { code: true } } },
  });

  const totals = new Map<string, Prisma.Decimal>(); // key: `${month}:${code}`
  for (const r of requests) {
    const month = r.fromDate.getUTCMonth() + 1;
    const key = `${month}:${r.leaveType.code}`;
    totals.set(key, (totals.get(key) ?? new Prisma.Decimal(0)).plus(r.totalDays));
  }
  const byMonthAndType = [...totals.entries()].map(([key, days]) => {
    const [month, leaveTypeCode] = key.split(":");
    return { month: Number(month), leaveTypeCode: leaveTypeCode as string, days: days.toNumber() };
  });

  const rhRequests = await prisma.leaveRequest.findMany({
    where: { status: "APPROVED", leaveType: { code: "RH" }, fromDate: { gte: yearStart, lte: yearEnd } },
    select: { fromDate: true },
  });
  const rhCounts = new Map<string, number>();
  for (const r of rhRequests) {
    const key = r.fromDate.toISOString().slice(0, 10);
    rhCounts.set(key, (rhCounts.get(key) ?? 0) + 1);
  }
  const rhCatalog = await prisma.restrictedHoliday.findMany({ where: { date: { gte: yearStart, lte: yearEnd } } });
  const rhBreakdown = rhCatalog
    .map((rh) => ({ date: rh.date.toISOString().slice(0, 10), name: rh.name, employeeCount: rhCounts.get(rh.date.toISOString().slice(0, 10)) ?? 0 }))
    .filter((rh) => rh.employeeCount > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  return { year, leaveTypes: types.map((t) => t.code), byMonthAndType, rhBreakdown };
}
