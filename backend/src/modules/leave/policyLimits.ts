import { Prisma } from "@prisma/client";
import { addCalendarDays, businessToday } from "../../lib/businessDate";
import { HttpError } from "../../middleware/errorHandler";
import { parseLeaveLimitLine, policyInForce } from "../policySettings/service";
import { computeTotalLeaveDays, type DayPart } from "./dayCount";

// M session block 2: two leave rules that change leave, so each has no effect until two directors turn it on (policy settings).
//   LV-20 sandwich rule: for the listed leave types, week-offs and holidays lying between two leave days of the same request are counted.
//   LV-19 request limits: per leave type, the most days in one request and the least notice for one's own request.
// Neither touches attendance: the engine still marks a sandwiched week-off as a week-off; only the days taken from the balance change.

/** Like computeTotalLeaveDays, but a week-off or holiday between the first and the last leave day of the range counts as a full day. */
export function sandwichTotal(fromDate: Date, toDate: Date, fromDayPart: DayPart, toDayPart: DayPart, holidayDates: ReadonlySet<string>, weekOffDays: readonly number[]): Prisma.Decimal {
  const days: Array<{ excluded: boolean }> = [];
  for (let c = fromDate; c.getTime() <= toDate.getTime(); c = addCalendarDays(c, 1)) {
    days.push({ excluded: holidayDates.has(c.toISOString().slice(0, 10)) || weekOffDays.includes(c.getUTCDay()) });
  }
  const first = days.findIndex((x) => !x.excluded);
  let last = -1;
  for (let i = days.length - 1; i >= 0; i -= 1) if (!days[i]!.excluded) { last = i; break; }
  const between = first < 0 ? 0 : days.slice(first, last + 1).filter((x) => x.excluded).length;
  return computeTotalLeaveDays(fromDate, toDate, fromDayPart, toDayPart, holidayDates, weekOffDays).plus(between);
}

/** The days a request takes from the balance: the sandwich rule when it is on for this type, else the plain count (unchanged). */
export async function leaveDaysFor(leaveTypeCode: string, fromDate: Date, toDate: Date, fromDayPart: DayPart, toDayPart: DayPart, holidayDates: ReadonlySet<string>, weekOffDays: readonly number[]): Promise<Prisma.Decimal> {
  const sandwich = await policyInForce<{ leaveTypes: string[] }>("policy.sandwich");
  return sandwich?.leaveTypes.includes(leaveTypeCode) ? sandwichTotal(fromDate, toDate, fromDayPart, toDayPart, holidayDates, weekOffDays) : computeTotalLeaveDays(fromDate, toDate, fromDayPart, toDayPart, holidayDates, weekOffDays);
}

/** LV-19: refuses a request over the type's most days, or (for one's own request) with less notice than the type needs. */
export async function assertLeaveLimits(leaveTypeCode: string, totalDays: Prisma.Decimal, fromDate: Date, ownRequest: boolean): Promise<void> {
  const limits = await policyInForce<{ rules: string[] }>("policy.leaveLimits");
  if (!limits) return;
  const rule = limits.rules.map(parseLeaveLimitLine).find((r) => r?.code === leaveTypeCode);
  if (!rule) return;
  if (totalDays.greaterThan(rule.maxDays)) throw new HttpError(400, `${leaveTypeCode}: at most ${rule.maxDays} day(s) in one request.`, "LEAVE_LIMIT_DAYS");
  if (ownRequest && rule.noticeDays > 0) {
    const earliest = addCalendarDays(businessToday(), rule.noticeDays);
    if (fromDate.getTime() < earliest.getTime()) throw new HttpError(400, `${leaveTypeCode}: ask at least ${rule.noticeDays} day(s) ahead (from ${earliest.toISOString().slice(0, 10)}).`, "LEAVE_LIMIT_NOTICE");
  }
}
