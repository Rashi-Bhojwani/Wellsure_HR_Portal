import { prisma } from "../../lib/prisma";
import { getDefaultWeekOffDays } from "./weekOff";

// Resolves the plain inputs computeTotalLeaveDays (dayCount.ts) needs: the
// employee's current location's holiday dates within the range, and the
// current default week-off days (Phase-2-pending stub — see weekOff.ts).
export async function resolveDayCountContext(employeeId: string, fromDate: Date, toDate: Date): Promise<{ holidayDates: Set<string>; weekOffDays: number[] }> {
  const jobHistory = await prisma.employeeJobHistory.findFirst({
    where: { employeeId, effectiveTo: null },
    select: { locationId: true },
  });

  const [holidays, weekOffDays] = await Promise.all([
    jobHistory
      ? prisma.holiday.findMany({
          where: { locationId: jobHistory.locationId, date: { gte: fromDate, lte: toDate } },
          select: { date: true },
        })
      : Promise.resolve([]),
    getDefaultWeekOffDays(),
  ]);

  return {
    holidayDates: new Set(holidays.map((h) => h.date.toISOString().slice(0, 10))),
    weekOffDays,
  };
}
