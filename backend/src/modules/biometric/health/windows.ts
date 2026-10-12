import { isWeekOff, type WeekOffRule } from "@shared/utils/attendance";
import { assignmentsOn, deviceMappingPeriods, placementsOn } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { shiftDef } from "../../attendance/compute";
import { addDays, dayStartMs, IST_OFFSET_MS, shiftTimeline } from "../../attendance/engine/time";
import { employeesInRange } from "../../attendance/jobs";

// Working hours, per branch, from the shifts of the people expected there
// (docs/plans/PHASE_2.md "P2-H build design", decision 2): a device is
// "supposed to be hearing from people" between the earliest shift start and the
// latest shift end of those who are expected at its branch that day. Nobody
// expected (a Sunday, a holiday, everyone on leave) means no window, so nothing
// is alarmed. Because it is derived from shifts and assignments as they are, it
// stays right when shifts change, with no watch window for anyone to keep up.
//
// "Expected" = employed that day, a device mapping in force, placed at the
// branch, not on a company holiday, not on their week-off, not on a full day of
// approved leave. All read through the effective-dating readers, as the
// engine does.

export interface BranchWindow {
  locationId: string;
  /** Epoch ms. A night shift's end is the next morning. */
  start: number;
  end: number;
  employeeIds: string[];
}

const utcDay = (date: string) => new Date(`${date}T00:00:00Z`);

export async function branchWindows(date: string): Promise<Map<string, BranchWindow>> {
  const out = new Map<string, BranchWindow>();
  const day = utcDay(date);
  if (await prisma.holiday.findUnique({ where: { date: day }, select: { id: true } })) return out;

  const employed = await employeesInRange(date, date);
  if (employed.length === 0) return out;
  const periods = await deviceMappingPeriods(employed, day, day);
  const mapped = employed.filter((id) => (periods.get(id) ?? []).some((p) => p.from <= day && (!p.to || p.to > day)));
  if (mapped.length === 0) return out;

  const [placements, assignments, leaves] = await Promise.all([
    placementsOn(mapped, day),
    assignmentsOn(mapped, day),
    prisma.leaveRequest.findMany({
      where: { employeeId: { in: mapped }, status: "APPROVED", fromDate: { lte: day }, toDate: { gte: day } },
      select: { employeeId: true, fromDate: true, toDate: true, fromDayPart: true, toDayPart: true },
    }),
  ]);
  const onFullLeave = new Set(
    leaves
      .filter((l) => {
        const sameDay = l.fromDate.getTime() === l.toDate.getTime();
        const part = sameDay || l.fromDate.getTime() === day.getTime() ? l.fromDayPart : l.toDate.getTime() === day.getTime() ? l.toDayPart : "FULL";
        return part === "FULL";
      })
      .map((l) => l.employeeId),
  );

  const base = dayStartMs(date);
  for (const id of mapped) {
    const placement = placements.get(id);
    const assignment = assignments.get(id);
    if (!placement || !assignment || onFullLeave.has(id)) continue;
    if (isWeekOff(assignment.weekOffPattern.rules as unknown as WeekOffRule[], day)) continue;
    const tl = shiftTimeline(shiftDef(assignment));
    const w = out.get(placement.locationId) ?? { locationId: placement.locationId, start: Infinity, end: -Infinity, employeeIds: [] };
    w.start = Math.min(w.start, base + tl.start * 1000);
    w.end = Math.max(w.end, base + tl.end * 1000);
    w.employeeIds.push(id);
    out.set(placement.locationId, w);
  }
  return out;
}

/** The business date (IST) an instant falls on. */
export const businessDateAt = (at: Date): string => new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

/** Windows that could contain `at`: yesterday's (a night shift runs into this morning) and today's. */
export async function windowsAround(at: Date): Promise<{ today: string; byDate: Map<string, Map<string, BranchWindow>> }> {
  const today = businessDateAt(at);
  const byDate = new Map<string, Map<string, BranchWindow>>();
  for (const d of [addDays(today, -1), today]) byDate.set(d, await branchWindows(d));
  return { today, byDate };
}

/** The window of `locationId` that contains `at`, if any. */
export function windowContaining(byDate: Map<string, Map<string, BranchWindow>>, locationId: string, at: Date): BranchWindow | null {
  for (const windows of byDate.values()) {
    const w = windows.get(locationId);
    if (w && w.start <= at.getTime() && at.getTime() <= w.end) return w;
  }
  return null;
}

/**
 * The start of the widened window (`marginMs` each side) of any of these branches that contains `at`: the latest such
 * start, or null when none does. How an agent's "working hours" are told from its devices' branches.
 */
export function widenedWindowStart(byDate: Map<string, Map<string, BranchWindow>>, locationIds: string[], at: Date, marginMs: number): number | null {
  let latest: number | null = null;
  for (const windows of byDate.values()) {
    for (const locationId of locationIds) {
      const w = windows.get(locationId);
      if (!w || w.start - marginMs > at.getTime() || at.getTime() > w.end + marginMs) continue;
      latest = latest === null ? w.start - marginMs : Math.max(latest, w.start - marginMs);
    }
  }
  return latest;
}

/**
 * The start of the next working day at any of these branches after `after`: the
 * first window that opens later. Looks up to two weeks ahead (null: none, so
 * an incident then has no escalation). The incident's "still open at the start
 * of the next working day" moment.
 */
export async function nextWindowStart(locationIds: string[], after: Date): Promise<Date | null> {
  if (locationIds.length === 0) return null;
  let date = businessDateAt(after);
  for (let i = 0; i < 14; i++, date = addDays(date, 1)) {
    const windows = await branchWindows(date);
    const starts = locationIds.flatMap((l) => {
      const w = windows.get(l);
      return w && w.start > after.getTime() ? [w.start] : [];
    });
    if (starts.length) return new Date(Math.min(...starts));
  }
  return null;
}
