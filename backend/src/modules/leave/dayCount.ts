import { Prisma } from "@prisma/client";
import { addCalendarDays } from "../../lib/businessDate";

export type DayPart = "FULL" | "FIRST_HALF" | "SECOND_HALF";

// Pure calculation, no DB access — the caller resolves the employee's
// location's holidays and the current week-off days (see
// modules/leave/weekOff.ts for the Phase-2-pending stub that supplies the
// latter) and passes them in as plain data. A day that's a holiday or a
// week-off contributes 0 — leave shouldn't cost balance on a day the
// employee wouldn't have worked anyway. fromDate is checked before toDate
// so a single-day request (fromDate === toDate) always uses fromDayPart,
// regardless of toDayPart's value.
export function computeTotalLeaveDays(fromDate: Date, toDate: Date, fromDayPart: DayPart, toDayPart: DayPart, holidayDates: ReadonlySet<string>, weekOffDays: readonly number[]): Prisma.Decimal {
  let total = new Prisma.Decimal(0);
  let cursor = fromDate;

  while (cursor.getTime() <= toDate.getTime()) {
    const isoDate = cursor.toISOString().slice(0, 10);
    const isExcluded = holidayDates.has(isoDate) || weekOffDays.includes(cursor.getUTCDay());

    if (!isExcluded) {
      const isFromDay = cursor.getTime() === fromDate.getTime();
      const isToDay = cursor.getTime() === toDate.getTime();
      const dayPart = isFromDay ? fromDayPart : isToDay ? toDayPart : "FULL";
      total = total.plus(dayPart === "FULL" ? 1 : 0.5);
    }

    cursor = addCalendarDays(cursor, 1);
  }

  return total;
}
