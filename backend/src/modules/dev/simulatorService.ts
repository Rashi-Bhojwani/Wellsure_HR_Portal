import type { DailyAttendance } from "@prisma/client";
import { instantToLocalTime } from "@shared/attendance/attlog";
import type { ExpectedDay, Masters, Roster, SimEmployee, SimLeave, SimShift } from "@shared/attendance/simulator";
import { assignmentsBetween, deviceMappingPeriods, type AssignmentWithRules } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";

// What the punch simulator needs to know about this installation, read-only
// (docs/plans/PHASE_2.md "P2-G, commit G2 build design"). The simulator sends
// punches through the three real routes and never writes to the database; to
// plan a day it needs each person's shift, policy, week-off pattern, leave and
// the holidays, and to check the result it reads back the stored days.
//
// Only people the simulator's model fully describes are returned. Anyone it
// cannot describe is listed under `skipped` with the reason, never silently
// dropped and never planned wrongly.

const IST = "Asia/Kolkata";
const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const addDays = (s: string, n: number) => iso(new Date(day(s).getTime() + n * 86_400_000));

export interface SimulatorRosterResult {
  appEnv: string;
  roster: Roster;
  skipped: Array<{ employeeCode: string; reason: string }>;
}

export async function buildSimulatorRoster(from: string, to: string, seed: number, appEnv: string): Promise<SimulatorRosterResult> {
  const fromD = day(from);
  const toD = day(to);
  // Everyone employed at some point in the range; history is then read through the effective-dating readers (lib/effectiveDating.ts).
  const employed = await prisma.employee.findMany({
    where: { dateOfJoining: { lte: toD }, OR: [{ lastWorkingDate: null }, { lastWorkingDate: { gte: fromD } }] },
    select: {
      id: true,
      employeeCode: true,
      dateOfJoining: true,
      lastWorkingDate: true,
      leaveRequests: { where: { status: "APPROVED", fromDate: { lte: toD }, toDate: { gte: fromD } }, include: { leaveType: true } },
    },
    orderBy: { employeeCode: "asc" },
  });
  const ids = employed.map((e) => e.id);
  const periods = await deviceMappingPeriods(ids, fromD, toD);
  const assignments = new Map<string, AssignmentWithRules[]>();
  for (const a of await assignmentsBetween(ids, fromD, toD)) assignments.set(a.employeeId, [...(assignments.get(a.employeeId) ?? []), a]);
  // The device user ID for each period (the reader gives the periods; the ID is a plain column of the same rows).
  const mappingRows = await prisma.deviceUserMapping.findMany({ where: { employeeId: { in: [...periods.keys()] } }, select: { employeeId: true, deviceUserId: true, validFrom: true, validTo: true }, orderBy: { validFrom: "asc" } });
  const people = employed
    .filter((e) => periods.has(e.id))
    .map((e) => ({
      ...e,
      // Half-open [validFrom, validTo): the same rows the reader found.
      deviceMappings: mappingRows.filter((m) => m.employeeId === e.id && m.validFrom <= toD && (!m.validTo || m.validTo > fromD)),
      attendanceAssignments: assignments.get(e.id) ?? [],
    }));

  const skipped: SimulatorRosterResult["skipped"] = [];
  const masters: Masters = { shifts: [], policies: [], weekOffs: [], leaveTypes: [], holidays: [] };
  const seen = {
    shift: new Set<string>(),
    policy: new Set<string>(),
    weekOff: new Set<string>(),
    leave: new Set<string>(),
  };
  const employees: SimEmployee[] = [];

  for (const p of people) {
    const skip = (reason: string) => skipped.push({ employeeCode: p.employeeCode, reason });
    if (p.deviceMappings.length !== 1) {
      skip("more than one device user ID in force in this range");
      continue;
    }
    const mapping = p.deviceMappings[0]!;
    // Half-open: a mapping ending on `validTo` last covers the day before. Ending with the person's employment is not a change.
    if (mapping.validTo && iso(mapping.validTo) <= to && !(p.lastWorkingDate && iso(mapping.validTo) > iso(p.lastWorkingDate))) {
      skip("the device mapping ends inside this range");
      continue;
    }
    if (iso(mapping.validFrom) > from && iso(mapping.validFrom) > iso(p.dateOfJoining)) {
      skip("the device mapping starts inside this range (before it the person is marked by hand)");
      continue;
    }
    if (p.attendanceAssignments.length !== 1) {
      skip("shift, week-off pattern or policy changes inside this range");
      continue;
    }
    const a = p.attendanceAssignments[0]!;
    if (a.policy.inferBreakPairing || (Array.isArray(a.policy.penaltyRules) && a.policy.penaltyRules.length > 0)) {
      skip(`policy ${a.policy.code} uses break pairing or penalty rules, which the simulator does not model`);
      continue;
    }
    // A leaver's assignment ends the day after the last working day, as Add Employee and separations leave it: that is not a change.
    const endsWithEmployment = !!a.effectiveTo && !!p.lastWorkingDate && iso(a.effectiveTo) === addDays(iso(p.lastWorkingDate), 1);
    if (a.effectiveTo && iso(a.effectiveTo) <= to && !endsWithEmployment) {
      skip("the assignment ends inside this range");
      continue;
    }

    if (!seen.shift.has(a.shift.code)) {
      seen.shift.add(a.shift.code);
      const shift: SimShift = {
        code: a.shift.code,
        name: a.shift.name,
        start: a.shift.startTime,
        end: a.shift.endTime,
        graceInMinutes: a.shift.graceInMinutes,
        graceOutMinutes: a.shift.graceOutMinutes,
        windowBeforeMinutes: a.shift.windowBeforeMinutes,
        windowAfterMinutes: a.shift.windowAfterMinutes,
        sessions: a.shift.sessions.map((s) => ({
          kind: s.kind,
          label: s.label,
          start: s.startTime,
          end: s.endTime,
        })),
      };
      masters.shifts.push(shift);
    }
    if (!seen.policy.has(a.policy.code)) {
      seen.policy.add(a.policy.code);
      masters.policies.push({
        code: a.policy.code,
        name: a.policy.name,
        fullDayMinMinutes: a.policy.fullDayMinMinutes,
        halfDayMinMinutes: a.policy.halfDayMinMinutes,
        halfDayMinNotMetLopDays: Number(a.policy.halfDayMinNotMetLopDays),
        nearDuplicateSeconds: a.policy.nearDuplicateSeconds,
      });
    }
    if (!seen.weekOff.has(a.weekOffPattern.code)) {
      seen.weekOff.add(a.weekOffPattern.code);
      masters.weekOffs.push({
        code: a.weekOffPattern.code,
        name: a.weekOffPattern.name,
        rules: a.weekOffPattern.rules as Array<{ weekday: number; weeks?: number[] }>,
      });
    }

    const leaves: SimLeave[] = [];
    for (const l of p.leaveRequests) {
      if (!seen.leave.has(l.leaveType.code)) {
        seen.leave.add(l.leaveType.code);
        masters.leaveTypes.push({
          code: l.leaveType.code,
          name: l.leaveType.name,
          paid: l.leaveType.isPaid,
        });
      }
      const first = iso(l.fromDate);
      const last = iso(l.toDate);
      for (let d = first; d <= last; d = addDays(d, 1)) {
        if (d < from || d > to) continue;
        const part = first === last ? l.fromDayPart : d === first ? l.fromDayPart : d === last ? l.toDayPart : "FULL";
        leaves.push({ date: d, part, type: l.leaveType.code });
      }
    }
    employees.push({
      code: p.employeeCode,
      deviceUserId: mapping.deviceUserId,
      archetype: "day-std",
      shift: a.shift.code,
      policy: a.policy.code,
      weekOff: a.weekOffPattern.code,
      joined: iso(p.dateOfJoining),
      lastWorking: p.lastWorkingDate ? iso(p.lastWorkingDate) : null,
      capture: "DEVICE",
      mappingFrom: iso(mapping.validFrom),
      leaves,
    });
  }

  const holidays = await prisma.holiday.findMany({
    where: { date: { gte: fromD, lte: toD } },
    orderBy: { date: "asc" },
  });
  masters.holidays = holidays.map((h) => ({ date: iso(h.date), name: h.name }));
  return {
    appEnv,
    roster: {
      seed,
      month: from.slice(0, 7),
      from,
      to,
      masters,
      employees,
      unmappedDeviceUserIds: [],
    },
    skipped,
  };
}

/** A stored day, in the plan's vocabulary (the fields the replay compares). */
export function observedDay(row: DailyAttendance, shiftCodeOf: (code: string) => string = (c) => c): Record<keyof ExpectedDay, unknown> {
  const from = (row.computedFrom ?? {}) as {
    collapsedPunches?: number;
    outsideWindowPunches?: number;
  };
  const local = (d: Date | null) => (d ? instantToLocalTime(d, IST) : null);
  return {
    status: row.status,
    firstHalf: row.firstHalfStatus,
    secondHalf: row.secondHalfStatus,
    source: row.source,
    capture: row.capture,
    lopDays: Number(row.lopDays),
    flags: [...row.exceptionFlags].sort(),
    workedOnOffDay: row.workedOnOffDay,
    provisional: row.provisional,
    shiftCode: row.shiftCode ? shiftCodeOf(row.shiftCode) : null,
    holidayName: row.holidayName,
    leaveTypeCode: row.leaveTypeCode,
    punchCount: row.punchCount,
    collapsedPunches: from.collapsedPunches ?? 0,
    outsideWindowPunches: from.outsideWindowPunches ?? 0,
    firstIn: local(row.firstIn),
    lastOut: local(row.lastOut),
    totalMinutes: row.totalMinutes,
    breakMinutes: row.breakMinutes,
    actualMinutes: row.actualMinutes,
    inShiftMinutes: row.inShiftMinutes,
    lateInMinutes: row.lateInMinutes,
    earlyOutMinutes: row.earlyOutMinutes,
    shortfallMinutes: row.shortfallMinutes,
    excessMinutes: row.excessMinutes,
  };
}

/** The stored days for some employee codes in a range, keyed "code|date". */
export async function storedDays(codes: string[], from: string, to: string): Promise<Record<string, Record<keyof ExpectedDay, unknown>>> {
  const rows = await prisma.dailyAttendance.findMany({
    where: { employee: { employeeCode: { in: codes } }, date: { gte: day(from), lte: day(to) } },
    include: { employee: { select: { employeeCode: true } } },
  });
  return Object.fromEntries(rows.map((r) => [`${r.employee.employeeCode}|${iso(r.date)}`, observedDay(r)]));
}
