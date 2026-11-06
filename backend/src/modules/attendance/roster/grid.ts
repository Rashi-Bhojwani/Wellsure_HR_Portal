import { isWeekOff, type WeekOffRule } from "@shared/utils/attendance";
import { cycleFor, type Cycle } from "../../../lib/attendanceCycle";
import { buildEmployeeScopeWhere } from "../../../lib/dataScope";
import { businessToday } from "../../../lib/businessDate";
import { assignmentsBetween, namesOn, placementPeriods, rowInForce } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { buildXlsx, type XlsxColumn } from "../../../lib/xlsx";
import { HttpError } from "../../../middleware/errorHandler";
import { addDays } from "../engine/time";
import { employeesInRange } from "../jobs";
import type { Viewer } from "../manual/scope";
import { loadShiftOverrides } from "../shiftOverrides";
import { loadCalendar } from "../../workforce/calendar";

// A-10 G2 (docs/plans/GREYTHR_PARITY_WORKFORCE.md item 4): the roster as a read-only month grid. For each person in the viewer's scope and each day of the
// attendance cycle: the shift code that applies (a Shift Override for the day, else the effective-dated assignment's shift), and whether the day is a working
// day, a week-off or a holiday. It reads the same sources the engine reads (compute.ts), so what it shows is what attendance is computed with. No money.

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);

export type RosterDayKind = "WORK" | "OFF" | "HOLIDAY" | "NOT_EMPLOYED" | "NO_ASSIGNMENT";
export interface RosterGridCell {
  date: string;
  kind: RosterDayKind;
  shiftCode: string | null;
  /** The shift came from a Shift Override for this one day. */
  overridden: boolean;
}
export interface RosterGridRow {
  employeeId: string;
  employeeCode: string;
  name: string;
  cells: RosterGridCell[];
  workDays: number;
  offDays: number;
}

export interface RosterGridQuery {
  cycleStart?: string;
  locationId?: string;
  departmentId?: string;
}

/** Who the viewer may see in the grid: `attendance.view` or `attendance.roster.manage`, always within the viewer's data scope; never themselves excluded. */
async function visibleIds(viewer: Viewer, candidates: string[]): Promise<string[]> {
  if (!viewer.permissions.has("attendance.view") && !viewer.permissions.has("attendance.roster.manage")) throw new HttpError(403, "You don't have access to the roster.", "FORBIDDEN");
  if (viewer.dataScope === "ALL") return candidates;
  const where = await buildEmployeeScopeWhere(viewer.employeeId, viewer.dataScope);
  const rows = await prisma.employee.findMany({ where: { AND: [where, { id: { in: candidates } }] }, select: { id: true } });
  const ok = new Set(rows.map((r) => r.id));
  return candidates.filter((id) => ok.has(id));
}

async function cycleFromStart(cycleStart: string | undefined): Promise<Cycle> {
  if (!cycleStart) return cycleFor(businessToday());
  const cycle = await cycleFor(day(cycleStart));
  if (iso(cycle.start) !== cycleStart) throw new HttpError(400, "That isn't the start of an attendance cycle.", "VALIDATION_ERROR");
  return cycle;
}

/** The pure part: one cell from what applies on the day. Exported for the tests' independent check. */
export function cellOf(input: {
  date: string;
  employed: boolean;
  holiday: boolean;
  assignment: { shiftCode: string; weekOffRules: WeekOffRule[] } | null;
  overrideShiftCode: string | null;
}): RosterGridCell {
  const { date } = input;
  if (!input.employed) return { date, kind: "NOT_EMPLOYED", shiftCode: null, overridden: false };
  if (!input.assignment && !input.overrideShiftCode) return { date, kind: "NO_ASSIGNMENT", shiftCode: null, overridden: false };
  const shiftCode = input.overrideShiftCode ?? input.assignment!.shiftCode;
  const overridden = input.overrideShiftCode !== null;
  // The engine's order: a holiday before a week-off (spec §4.4).
  if (input.holiday) return { date, kind: "HOLIDAY", shiftCode, overridden };
  if (input.assignment && isWeekOff(input.assignment.weekOffRules, day(date))) return { date, kind: "OFF", shiftCode, overridden };
  return { date, kind: "WORK", shiftCode, overridden };
}

export async function rosterGrid(viewer: Viewer, q: RosterGridQuery) {
  const cycle = await cycleFromStart(q.cycleStart);
  const start = iso(cycle.start);
  const end = iso(cycle.end);
  const days: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);

  let ids = await visibleIds(viewer, await employeesInRange(start, end));
  if (q.locationId || q.departmentId) {
    const placements = await placementPeriods(ids, cycle.start, cycle.end);
    ids = ids.filter((id) => (placements.get(id) ?? []).some((p) => (!q.locationId || p.locationId === q.locationId) && (!q.departmentId || p.departmentId === q.departmentId)));
  }
  const [employees, assignments, calendar, overrides, names] = await Promise.all([
    prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, employeeCode: true, dateOfJoining: true, lastWorkingDate: true }, orderBy: { employeeCode: "asc" } }),
    assignmentsBetween(ids, cycle.start, cycle.end),
    loadCalendar(ids, start, end),
    loadShiftOverrides(ids, start, end),
    namesOn(ids, cycle.end),
  ]);
  const shiftCodes = new Map((await prisma.shift.findMany({ select: { id: true, code: true, name: true, startTime: true, endTime: true } })).map((s) => [s.id, s]));

  const rows: RosterGridRow[] = employees.map((e) => {
    const mine = assignments.filter((a) => a.employeeId === e.id);
    const cells = days.map((date) => {
      const a = mine.find((r) => rowInForce(r, day(date))) ?? null;
      const o = overrides.get(`${e.id}|${date}`);
      return cellOf({
        date,
        employed: iso(e.dateOfJoining) <= date && (!e.lastWorkingDate || iso(e.lastWorkingDate) >= date),
        holiday: calendar.holidayFor(e.id, date) !== null,
        assignment: a ? { shiftCode: shiftCodes.get(a.shiftId)?.code ?? a.shift.code, weekOffRules: calendar.weekOffOverrideFor(e.id, date) ?? (a.weekOffPattern.rules as unknown as WeekOffRule[]) } : null,
        overrideShiftCode: o ? o.shift.code : null,
      });
    });
    return {
      employeeId: e.id,
      employeeCode: e.employeeCode,
      name: names.get(e.id) ?? e.employeeCode,
      cells,
      workDays: cells.filter((c) => c.kind === "WORK").length,
      offDays: cells.filter((c) => c.kind === "OFF").length,
    };
  });
  const usedCodes = new Set(rows.flatMap((r) => r.cells.map((c) => c.shiftCode).filter((c): c is string => !!c)));
  const legend = [...shiftCodes.values()].filter((s) => usedCodes.has(s.code)).map((s) => ({ code: s.code, name: s.name, startTime: s.startTime, endTime: s.endTime }));
  return { cycle: { start, end, label: cycle.label }, days, rows, legend };
}

const KIND_TEXT: Record<RosterDayKind, string> = { WORK: "", OFF: "Off", HOLIDAY: "Holiday", NOT_EMPLOYED: "", NO_ASSIGNMENT: "No shift" };
export function cellText(c: RosterGridCell): string {
  if (c.kind === "NOT_EMPLOYED") return "";
  if (c.kind === "NO_ASSIGNMENT") return KIND_TEXT.NO_ASSIGNMENT;
  const code = `${c.shiftCode ?? ""}${c.overridden ? "*" : ""}`;
  return c.kind === "WORK" ? code : `${KIND_TEXT[c.kind]} (${code})`;
}

export async function exportRosterGrid(viewer: Viewer, q: RosterGridQuery): Promise<{ filename: string; buffer: Buffer }> {
  const g = await rosterGrid(viewer, q);
  const columns: XlsxColumn[] = [
    { key: "code", header: "Employee no.", width: 14 },
    { key: "name", header: "Name", width: 28 },
    ...g.days.map((d) => ({ key: d, header: d.slice(5), width: 10 })),
    { key: "work", header: "Working days", type: "number" as const, width: 14 },
    { key: "off", header: "Week-offs", type: "number" as const, width: 12 },
  ];
  const rows = g.rows.map((r) => ({ code: r.employeeCode, name: r.name, work: r.workDays, off: r.offDays, ...Object.fromEntries(r.cells.map((c) => [c.date, cellText(c)])) }));
  const footer = [`Cycle ${g.cycle.start} to ${g.cycle.end}. * = a Shift Override for that day.`, ...g.legend.map((l) => `${l.code}: ${l.name} ${l.startTime}–${l.endTime}`)];
  return { filename: `roster-${g.cycle.start}.xlsx`, buffer: await buildXlsx([{ name: "Roster", columns, rows, footer }]) };
}
