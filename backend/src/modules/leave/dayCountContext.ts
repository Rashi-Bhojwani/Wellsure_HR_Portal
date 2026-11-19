import { isWeekOff, type WeekOffRule } from "@shared/utils/attendance";
import { getAttendanceDefaults } from "../../lib/attendanceSettings";
import { assignmentsBetween, rowInForce } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { loadCalendar } from "../workforce/calendar";

// Resolves the plain inputs computeTotalLeaveDays (dayCount.ts) needs, from the SAME settings attendance uses (audit fix, 2026-11-18): for each date, the person's
// own attendance assignment's week-off pattern (shared isWeekOff, so alternate Saturdays work), a weekend override for their branch if one applies, and the holidays
// that apply at their location (A-10 G4). A company working Monday to Saturday therefore counts a Saturday as a leave day. Where the person has no assignment on a
// date, the company's default week-off pattern (Attendance Settings, the one a new hire gets) is used; if that is missing, the request is refused, never guessed.
// (Before: one built-in Saturday-and-Sunday default for everybody, setting leave.defaultWeekOffDays.)
export async function resolveDayCountContext(employeeId: string, fromDate: Date, toDate: Date): Promise<{ holidayDates: Set<string>; weekOffDates: Set<string>; excludedDates: Set<string> }> {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const [calendar, assignments] = await Promise.all([loadCalendar([employeeId], iso(fromDate), iso(toDate)), assignmentsBetween([employeeId], fromDate, toDate)]);
  let fallback: WeekOffRule[] | null | undefined;
  const companyDefault = async (): Promise<WeekOffRule[]> => {
    if (fallback === undefined) {
      const code = (await getAttendanceDefaults()).weekOffPatternCode;
      const pattern = await prisma.weekOffPattern.findUnique({ where: { code }, select: { rules: true, isActive: true } });
      fallback = pattern?.isActive ? (pattern.rules as unknown as WeekOffRule[]) : null;
    }
    if (!fallback) throw new HttpError(409, "This person has no week-off pattern for some of these days, and the company's default week-off pattern is missing. Set it in Attendance Settings, or assign one to the person, before applying for leave.", "WEEK_OFF_PATTERN_MISSING");
    return fallback;
  };
  const holidayDates = new Set<string>();
  const weekOffDates = new Set<string>();
  for (let d = new Date(fromDate); d <= toDate; d = new Date(d.getTime() + 86_400_000)) {
    const day = iso(d);
    if (calendar.holidayFor(employeeId, day) !== null) holidayDates.add(day);
    const row = assignments.find((a) => rowInForce(a, d));
    const rules = calendar.weekOffOverrideFor(employeeId, day) ?? (row ? (row.weekOffPattern.rules as unknown as WeekOffRule[]) : await companyDefault());
    if (isWeekOff(rules, d)) weekOffDates.add(day);
  }
  return { holidayDates, weekOffDates, excludedDates: new Set([...holidayDates, ...weekOffDates]) };
}
