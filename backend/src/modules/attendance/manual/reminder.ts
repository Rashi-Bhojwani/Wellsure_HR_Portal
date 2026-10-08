import { businessToday } from "../../../lib/businessDate";
import { deviceMappingPeriods, placementPeriods } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { notifyEmployee } from "../../notifications/notifyEmployee";
import { computeAttendance } from "../compute";
import { employeesInRange } from "../jobs";

// The daily "still not marked" reminder (Phase 2 P2-D, docs/plans/PHASE_2.md
// §5.3): at attendance.manualReminderHour (default 18:00 IST) everyone
// assigned to mark a branch hears how many of today's days there are still
// NM. Nothing is sent when there are none (a Sunday is OFF, not NM).

export const MANUAL_REMINDER_HOUR_KEY = "attendance.manualReminderHour";

export async function runManualReminder(): Promise<{ notified: number }> {
  const today = businessToday();
  const date = today.toISOString().slice(0, 10);
  const assignments = await prisma.attendanceManualBranch.findMany({ select: { locationId: true, location: { select: { name: true } }, user: { select: { employeeId: true, status: true } } } });
  if (assignments.length === 0) return { notified: 0 };
  const branches = new Set(assignments.map((a) => a.locationId));

  const all = await employeesInRange(date, date);
  const [placements, mappings] = await Promise.all([placementPeriods(all, today, today), deviceMappingPeriods(all, today, today)]);
  const locationOf = new Map(all.map((id) => [id, placements.get(id)?.[0]?.locationId ?? null]));
  const manual = all.filter((id) => branches.has(locationOf.get(id) ?? "") && !(mappings.get(id)?.length));
  if (manual.length === 0) return { notified: 0 };
  await computeAttendance(manual, date, date); // today's rows may not exist yet
  const notMarked = await prisma.dailyAttendance.findMany({ where: { employeeId: { in: manual }, date: today, status: { contains: "NM" } }, select: { employeeId: true } });
  const countAt = new Map<string, number>();
  for (const r of notMarked) {
    const loc = locationOf.get(r.employeeId)!;
    countAt.set(loc, (countAt.get(loc) ?? 0) + 1);
  }

  const byMarker = new Map<string, Array<{ name: string; count: number }>>();
  for (const a of assignments) {
    const count = countAt.get(a.locationId) ?? 0;
    if (count === 0 || a.user.status !== "ACTIVE") continue;
    byMarker.set(a.user.employeeId, [...(byMarker.get(a.user.employeeId) ?? []), { name: a.location.name, count }]);
  }
  for (const [employeeId, list] of byMarker) {
    const total = list.reduce((n, b) => n + b.count, 0);
    await notifyEmployee(employeeId, {
      type: "attendance.manual.reminder",
      title: `${total === 1 ? "1 person" : `${total} people`} not marked today`,
      body: `Today's attendance is still not marked for ${list.map((b) => `${b.count} at ${b.name}`).join(" and ")}.`,
      link: "/app/attendance/mark",
      payload: { date, branches: list },
    });
  }
  return { notified: byMarker.size };
}
