import { prisma } from "../../lib/prisma";
import { getDefaultWeekOffDays } from "./weekOff";
import { loadCalendar } from "../workforce/calendar";

// Resolves the plain inputs computeTotalLeaveDays (dayCount.ts) needs: the
// company-wide holiday dates within the range (holidays don't vary by
// branch — see schema.prisma's comment on the Holiday model) and the
// current default week-off days (Phase-2-pending stub — see weekOff.ts).
// A-10 G4: a holiday limited to some locations counts only for someone placed at one of them (the same calendar the engine reads).
// Weekend overrides are not read here: leave counting still uses the one company default (weekOff.ts), as before.
export async function resolveDayCountContext(employeeId: string, fromDate: Date, toDate: Date): Promise<{ holidayDates: Set<string>; weekOffDays: number[] }> {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const [holidays, weekOffDays] = await Promise.all([
    prisma.holiday.findMany({
      where: { date: { gte: fromDate, lte: toDate } },
      select: { date: true },
    }),
    getDefaultWeekOffDays(),
  ]);
  const calendar = holidays.length ? await loadCalendar([employeeId], iso(fromDate), iso(toDate)) : null;
  return {
    holidayDates: new Set(holidays.map((h) => iso(h.date)).filter((d) => calendar?.holidayFor(employeeId, d) !== null)),
    weekOffDays,
  };
}
