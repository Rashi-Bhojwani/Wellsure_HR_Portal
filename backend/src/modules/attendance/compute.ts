import { Prisma, type DailyAttendance } from "@prisma/client";
import { isWeekOff, type WeekOffRule } from "@shared/utils/attendance";
import { businessToday } from "../../lib/businessDate";
import { assignmentsBetween, deviceMappingPeriods, placementsOn, rowInForce, type AssignmentWithRules } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";
import { emitAttendanceUpdated } from "../../realtime/emit";
import { evaluateDay } from "./engine/engine";
import { addDays, businessDateOf, dayStartMs } from "./engine/time";
import { ENGINE_VERSION, type DayInput, type DayResult, type HalfLeave, type ManualEntry, type PunchRef, type ShiftDef } from "./engine/types";
import { attributePunches } from "./engine/windows";
import { loadManualEntries } from "./manual/entries";

// The engine's loader and writer (docs/plans/PHASE_2.md §4.1). The loader
// gathers each employee-day's inputs — through the effective-dating readers
// for anything time-varying (assignment, device mapping), never a history
// table directly — and the writer stores only what changed. A locked day
// (Phase 3 finalisation) is never rewritten. Re-running with the same inputs
// changes nothing, so a wrong rule value is fixed by correcting it and
// recomputing.

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utcDate = (s: string) => new Date(`${s}T00:00:00Z`);

export interface DayChange {
  employeeId: string;
  date: string;
  before: string | null; // status, or null when there was no record
  after: string | null;
}

export interface ComputeResult {
  processed: number; // employee-days evaluated
  changed: number; // written because something differed
  locked: number; // left alone: finalised
  deleted: number; // a record that should no longer exist (e.g. not employed that day)
  changes: DayChange[];
}

/** Manual entries (P2-D): the real query by default; tests may substitute a loader. */
type ManualLoader = (employeeIds: string[], from: string, to: string) => Promise<Map<string, ManualEntry>>;
let loadManual: ManualLoader = loadManualEntries;
export function setManualEntryLoader(loader: ManualLoader | null): void {
  loadManual = loader ?? loadManualEntries;
}

function shiftDef(a: AssignmentWithRules): ShiftDef {
  const s = a.shift;
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    startTime: s.startTime,
    endTime: s.endTime,
    graceInMinutes: s.graceInMinutes,
    graceOutMinutes: s.graceOutMinutes,
    windowBeforeMinutes: s.windowBeforeMinutes,
    windowAfterMinutes: s.windowAfterMinutes,
    sessions: s.sessions.map((x) => ({ kind: x.kind, label: x.label, startTime: x.startTime, endTime: x.endTime })),
  };
}

/** The fields that make up a day; two equal shapes mean nothing changed. */
function rowData(employeeId: string, date: string, r: DayResult, a: AssignmentWithRules | null, outside: number) {
  return {
    employeeId,
    date: utcDate(date),
    shiftId: a?.shift.id ?? null,
    shiftCode: r.shiftCode,
    shiftStart: a?.shift.startTime ?? null,
    shiftEnd: a?.shift.endTime ?? null,
    policyId: a?.policy.id ?? null,
    firstIn: r.firstIn === null ? null : new Date(r.firstIn),
    lastOut: r.lastOut === null ? null : new Date(r.lastOut),
    totalMinutes: r.totalMinutes,
    breakMinutes: r.breakMinutes,
    actualMinutes: r.actualMinutes,
    inShiftMinutes: r.inShiftMinutes,
    lateInMinutes: r.lateInMinutes,
    earlyOutMinutes: r.earlyOutMinutes,
    shortfallMinutes: r.shortfallMinutes,
    excessMinutes: r.excessMinutes,
    status: r.status,
    firstHalfStatus: r.firstHalfStatus,
    secondHalfStatus: r.secondHalfStatus,
    lopDays: new Prisma.Decimal(r.lopDays),
    exceptionFlags: r.flags,
    source: r.source,
    capture: r.capture,
    leaveTypeCode: r.leaveTypeCode,
    holidayName: r.holidayName,
    workedOnOffDay: r.workedOnOffDay,
    provisional: r.provisional,
    punchCount: r.punchCount,
    computedFrom: { punchIds: r.usedPunchIds, manualEntryId: r.manualEntryId, collapsedPunches: r.collapsedPunches, outsideWindowPunches: outside } as Prisma.InputJsonValue,
    engineVersion: ENGINE_VERSION,
  };
}
type RowData = ReturnType<typeof rowData>;

const COMPARED: Array<keyof RowData> = [
  "shiftId", "shiftCode", "shiftStart", "shiftEnd", "policyId", "firstIn", "lastOut", "totalMinutes", "breakMinutes", "actualMinutes", "inShiftMinutes",
  "lateInMinutes", "earlyOutMinutes", "shortfallMinutes", "excessMinutes", "status", "firstHalfStatus", "secondHalfStatus", "lopDays", "exceptionFlags",
  "source", "capture", "leaveTypeCode", "holidayName", "workedOnOffDay", "provisional", "punchCount", "computedFrom", "engineVersion",
];
function canonical(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Prisma.Decimal) return v.toFixed(2);
  if (v !== null && typeof v === "object" && "toFixed" in (v as object)) return (v as Prisma.Decimal).toFixed(2);
  return JSON.stringify(v ?? null);
}
export function sameDay(existing: DailyAttendance, next: RowData): boolean {
  return COMPARED.every((k) => canonical((existing as unknown as Record<string, unknown>)[k]) === canonical(next[k]));
}

/**
 * Recompute [from, to] (business dates, inclusive) for these employees. Days
 * after today are never computed. Callers chunk large employee sets.
 */
export async function computeAttendance(employeeIds: string[], from: string, to: string, opts: { now?: Date; maxChanges?: number; dryRun?: boolean } = {}): Promise<ComputeResult> {
  const result: ComputeResult = { processed: 0, changed: 0, locked: 0, deleted: 0, changes: [] };
  const today = iso(businessToday());
  const last = to > today ? today : to;
  if (employeeIds.length === 0 || from > last) return result;
  const now = (opts.now ?? new Date()).getTime();
  const maxChanges = opts.maxChanges ?? 500;

  const fromD = utcDate(from);
  const lastD = utcDate(last);
  const [employees, assignments, mappings, holidays, leaves, existing, manual] = await Promise.all([
    prisma.employee.findMany({ where: { id: { in: employeeIds } }, select: { id: true, dateOfJoining: true, lastWorkingDate: true } }),
    assignmentsBetween(employeeIds, utcDate(addDays(from, -1)), utcDate(addDays(last, 1))),
    deviceMappingPeriods(employeeIds, fromD, lastD),
    prisma.holiday.findMany({ where: { date: { gte: fromD, lte: lastD } }, select: { date: true, name: true } }),
    prisma.leaveRequest.findMany({
      where: { employeeId: { in: employeeIds }, status: "APPROVED", fromDate: { lte: lastD }, toDate: { gte: fromD } },
      select: { employeeId: true, fromDate: true, toDate: true, fromDayPart: true, toDayPart: true, leaveType: { select: { code: true, isPaid: true } } },
    }),
    prisma.dailyAttendance.findMany({ where: { employeeId: { in: employeeIds }, date: { gte: fromD, lte: lastD } } }),
    loadManual(employeeIds, from, last),
  ]);
  const punches = await prisma.rawPunch.findMany({
    where: { employeeId: { in: employeeIds }, punchedAt: { gte: new Date(dayStartMs(addDays(from, -1))), lt: new Date(dayStartMs(addDays(last, 2))) } },
    select: { id: true, employeeId: true, punchedAt: true, flag: true, flagResolution: { select: { decision: true } } },
  });

  const holidayOn = new Map(holidays.map((h) => [iso(h.date), h.name]));
  const existingBy = new Map(existing.map((e) => [`${e.employeeId}|${iso(e.date)}`, e]));
  const changedByEmployee = new Map<string, string[]>();

  for (const emp of employees) {
    const rows = assignments.filter((a) => a.employeeId === emp.id);
    const assignmentOnDate = (date: string) => rows.find((a) => rowInForce(a, utcDate(date))) ?? null;
    const periods = mappings.get(emp.id) ?? [];
    const captured = (date: string) => periods.some((p) => p.from <= utcDate(date) && (!p.to || p.to > utcDate(date)));

    // Leave per date and half.
    const leaveOn = new Map<string, { first: HalfLeave | null; second: HalfLeave | null }>();
    for (const l of leaves.filter((x) => x.employeeId === emp.id)) {
      for (let d = iso(l.fromDate); d <= iso(l.toDate); d = addDays(d, 1)) {
        const part = d === iso(l.fromDate) ? l.fromDayPart : d === iso(l.toDate) ? l.toDayPart : "FULL";
        const half: HalfLeave = { code: l.leaveType.code, unpaid: !l.leaveType.isPaid };
        const cur = leaveOn.get(d) ?? { first: null, second: null };
        if (part !== "SECOND_HALF") cur.first = half;
        if (part !== "FIRST_HALF") cur.second = half;
        leaveOn.set(d, cur);
      }
    }

    // Punches → business dates through the shift windows (night shifts stay on their start date).
    const around: string[] = [];
    for (let d = addDays(from, -1); d <= addDays(last, 1); d = addDays(d, 1)) around.push(d);
    const dayShifts = around.map((date) => {
      const a = assignmentOnDate(date);
      return { date, shift: a ? shiftDef(a) : null };
    });
    const mine = punches.filter((p) => p.employeeId === emp.id);
    const usable: PunchRef[] = mine.filter((p) => !p.flag || p.flagResolution?.decision === "ACCEPTED").map((p) => ({ id: p.id, at: p.punchedAt.getTime() }));
    const pending: PunchRef[] = mine.filter((p) => p.flag && !p.flagResolution).map((p) => ({ id: p.id, at: p.punchedAt.getTime() }));
    const attributed = attributePunches(usable, dayShifts);
    const pendingAttributed = attributePunches(pending, dayShifts);
    const outsideOn = new Map<string, number>();
    for (const p of attributed.outside) outsideOn.set(businessDateOf(p.at), (outsideOn.get(businessDateOf(p.at)) ?? 0) + 1);

    for (let date = from; date <= last; date = addDays(date, 1)) {
      result.processed += 1;
      const key = `${emp.id}|${date}`;
      const before = existingBy.get(key) ?? null;
      if (before?.isLocked) {
        result.locked += 1;
        continue;
      }
      const a = assignmentOnDate(date);
      const employed = emp.dateOfJoining <= utcDate(date) && (!emp.lastWorkingDate || emp.lastWorkingDate >= utcDate(date));
      const input: DayInput = {
        date,
        employed,
        holiday: holidayOn.get(date) ?? null,
        shift: a ? shiftDef(a) : null,
        weekOff: a ? isWeekOff(a.weekOffPattern.rules as unknown as WeekOffRule[], utcDate(date)) : false,
        leave: leaveOn.get(date) ?? { first: null, second: null },
        capture: captured(date) ? "DEVICE" : "MANUAL",
        manual: manual.get(key) ?? null,
        punches: attributed.byDate.get(date) ?? [],
        flaggedExcluded: (pendingAttributed.byDate.get(date) ?? []).length,
        policy: a ? { id: a.policy.id, fullDayMinMinutes: a.policy.fullDayMinMinutes, halfDayMinMinutes: a.policy.halfDayMinMinutes, halfDayMinNotMetLopDays: Number(a.policy.halfDayMinNotMetLopDays), nearDuplicateSeconds: a.policy.nearDuplicateSeconds, inferBreakPairing: a.policy.inferBreakPairing } : null,
        now,
      };
      const r = evaluateDay(input);
      const note = (after: string | null) => {
        result.changed += 1;
        changedByEmployee.set(emp.id, [...(changedByEmployee.get(emp.id) ?? []), date]);
        if (result.changes.length < maxChanges) result.changes.push({ employeeId: emp.id, date, before: before?.status ?? null, after });
      };
      if (!r) {
        if (before) {
          if (!opts.dryRun) await prisma.dailyAttendance.delete({ where: { id: before.id } });
          result.deleted += 1;
          note(null);
        }
        continue;
      }
      const data = rowData(emp.id, date, r, a, outsideOn.get(date) ?? 0);
      if (before && sameDay(before, data)) continue;
      if (!opts.dryRun) await prisma.dailyAttendance.upsert({ where: { employeeId_date: { employeeId: emp.id, date: data.date } }, create: data, update: { ...data, processedAt: new Date() } });
      note(r.status);
    }
  }

  if (changedByEmployee.size && !opts.dryRun) {
    const placements = await placementsOn([...changedByEmployee.keys()], utcDate(today));
    // Whoever marks a branch's manual attendance sees its changes live too (P2-D).
    const markers = await prisma.attendanceManualBranch.findMany({
      where: { locationId: { in: [...new Set([...placements.values()].map((p) => p.locationId))] } },
      select: { locationId: true, user: { select: { employeeId: true } } },
    });
    const markersAt = (locationId: string | undefined) => markers.filter((m) => m.locationId === locationId).map((m) => m.user.employeeId);
    for (const [employeeId, dates] of changedByEmployee) {
      const placement = placements.get(employeeId);
      emitAttendanceUpdated(employeeId, dates, placement?.reportingManagerId ?? null, markersAt(placement?.locationId));
    }
  }
  return result;
}
