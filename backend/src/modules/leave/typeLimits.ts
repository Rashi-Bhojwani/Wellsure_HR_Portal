import { Prisma, type LeaveDayPart, type LeavePolicy } from "@prisma/client";
import { HttpError } from "../../middleware/errorHandler";
import { computeTotalLeaveDays } from "./dayCount";
import { resolveDayCountContext } from "./dayCountContext";

// Audit fix 2026-11-18 (docs/plans/AUDIT_FIXES.md item 3): the WFH monthly and yearly limits and the restricted-holiday yearly quota on Leave Types and Policies
// are enforced when someone applies, for whichever leave type's policy sets them (no type name is assumed). Empty means no limit. Pending and approved requests of
// that type count; a request spanning months counts its days in each month.

type Req = { fromDate: Date; toDate: Date; fromDayPart: LeaveDayPart; toDayPart: LeaveDayPart };
const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);

/** The leave days of a request that fall inside [from, to] (inclusive), on the person's own calendar. */
async function daysWithin(employeeId: string, r: Req, from: Date, to: Date): Promise<Prisma.Decimal> {
  const a = r.fromDate > from ? r.fromDate : from;
  const b = r.toDate < to ? r.toDate : to;
  if (a > b) return new Prisma.Decimal(0);
  const ctx = await resolveDayCountContext(employeeId, a, b);
  const single = a.getTime() === b.getTime();
  const startPart = a.getTime() === r.fromDate.getTime() ? r.fromDayPart : "FULL";
  const endPart = b.getTime() === r.toDate.getTime() ? r.toDayPart : "FULL";
  const part = single ? (a.getTime() === r.fromDate.getTime() ? r.fromDayPart : endPart) : null;
  return computeTotalLeaveDays(a, b, part ?? startPart, part ?? endPart, ctx.excludedDates, []);
}

export async function assertTypeLimits(tx: Prisma.TransactionClient, employeeId: string, leaveType: { id: string; name: string; policy: LeavePolicy | null }, req: Req): Promise<void> {
  const p = leaveType.policy;
  if (!p || (p.wfhMonthlyLimit === null && p.wfhYearlyLimit === null && p.rhYearlyQuota === null)) return;
  const existing = await tx.leaveRequest.findMany({ where: { employeeId, leaveTypeId: leaveType.id, status: { in: ["PENDING", "APPROVED"] } }, select: { fromDate: true, toDate: true, fromDayPart: true, toDayPart: true } });
  const used = async (from: Date, to: Date) => {
    let total = new Prisma.Decimal(0);
    for (const r of existing) total = total.plus(await daysWithin(employeeId, r, from, to));
    return total;
  };
  const check = async (limit: number | null, from: Date, to: Date, what: string) => {
    if (limit === null) return;
    const mine = await daysWithin(employeeId, req, from, to);
    if (mine.isZero()) return;
    const already = await used(from, to);
    if (already.plus(mine).greaterThan(limit)) {
      throw new HttpError(409, `${leaveType.name}: at most ${limit} day${limit === 1 ? "" : "s"} ${what} (Leave Types and Policies). ${already.toString()} already requested or approved; this request adds ${mine.toString()}.`, "LEAVE_TYPE_LIMIT", { limit, used: already.toNumber(), requested: mine.toNumber() });
    }
  };
  for (let y = req.fromDate.getUTCFullYear(); y <= req.toDate.getUTCFullYear(); y += 1) {
    await check(p.wfhYearlyLimit, day(`${y}-01-01`), day(`${y}-12-31`), `a year (${y})`);
    await check(p.rhYearlyQuota, day(`${y}-01-01`), day(`${y}-12-31`), `a year (${y})`);
  }
  if (p.wfhMonthlyLimit !== null) {
    for (let m = new Date(Date.UTC(req.fromDate.getUTCFullYear(), req.fromDate.getUTCMonth(), 1)); m <= req.toDate; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) {
      const end = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 0));
      await check(p.wfhMonthlyLimit, m, end, `a month (${iso(m).slice(0, 7)})`);
    }
  }
}
