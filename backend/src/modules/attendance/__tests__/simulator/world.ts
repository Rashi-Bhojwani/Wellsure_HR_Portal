import type { MonthPlan, Roster, SimHoliday } from "@shared/attendance/simulator";
import { deleteEmployeesAndDependents, deleteWithDependents } from "../../../../lib/__tests__/cleanup";
import { prisma } from "../../../../lib/prisma";
import { cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, type TestOrgMasters } from "../../../employee/__tests__/employeeTestHelpers";

// The simulated organisation, in the TEST database (docs/plans/PHASE_2.md
// "P2-G build design", "The replay"). Bulk inserts, so 500 people take seconds;
// torn down with the schema-driven cleanup helpers, never a hand-ordered list.
// The harness is the only thing that touches the database: the simulator
// library itself is pure.

const day = (s: string) => new Date(`${s}T00:00:00Z`);
const dayAfter = (s: string) => new Date(day(s).getTime() + 86_400_000);

export interface SimWorld {
  tag: string;
  roster: Roster;
  /** roster employee code → database id */
  employeeId: Map<string, string>;
  /** database id → roster employee code */
  codeOf: Map<string, string>;
  deviceId: string;
  /** every database employee id in the roster */
  employeeIds: string[];
  cleanup(): Promise<void>;
}

/** Company holidays already in the database for the month: the simulated organisation adopts them rather than colliding with them. */
export async function existingHolidays(month: string): Promise<SimHoliday[]> {
  const from = day(`${month}-01`);
  const to = new Date(from);
  to.setUTCMonth(to.getUTCMonth() + 1);
  const rows = await prisma.holiday.findMany({ where: { date: { gte: from, lt: to } }, orderBy: { date: "asc" } });
  return rows.map((r) => ({ date: r.date.toISOString().slice(0, 10), name: r.name }));
}

export async function createWorld(roster: Roster, tag: string, manualEntries: Array<{ employee: string; date: string; kind: "TIMED" | "STATUS_ONLY"; inTime?: string | null; outTime?: string | null; status?: string | null }>): Promise<SimWorld> {
  const m = roster.masters;
  const org: TestOrgMasters = await createEmployeeTestOrgMasters();
  const admin = await createFullTestEmployee(org); // a user for the "created by" columns
  const created = { shifts: [] as string[], policies: [] as string[], patterns: [] as string[], leaveTypes: [] as string[], holidays: [] as string[] };

  const device = await prisma.device.create({ data: { serialNumber: `SIM-${tag}`, name: `Simulator device ${tag}`, locationId: org.locationId, isSimulated: true } });

  const shiftId = new Map<string, string>();
  for (const s of m.shifts) {
    const row = await prisma.shift.create({
      data: {
        code: `${s.code}-${tag}`,
        name: s.name,
        startTime: s.start,
        endTime: s.end,
        graceInMinutes: s.graceInMinutes,
        graceOutMinutes: s.graceOutMinutes,
        windowBeforeMinutes: s.windowBeforeMinutes,
        windowAfterMinutes: s.windowAfterMinutes,
        sessions: { create: s.sessions.map((x, i) => ({ sortOrder: i + 1, kind: x.kind, label: x.label, startTime: x.start, endTime: x.end })) },
      },
    });
    shiftId.set(s.code, row.id);
    created.shifts.push(row.id);
  }
  const policyId = new Map<string, string>();
  for (const p of m.policies) {
    const row = await prisma.attendancePolicy.create({
      data: { code: `${p.code}-${tag}`, name: p.name, fullDayMinMinutes: p.fullDayMinMinutes, halfDayMinMinutes: p.halfDayMinMinutes, halfDayMinNotMetLopDays: p.halfDayMinNotMetLopDays, nearDuplicateSeconds: p.nearDuplicateSeconds },
    });
    policyId.set(p.code, row.id);
    created.policies.push(row.id);
  }
  const patternId = new Map<string, string>();
  for (const w of m.weekOffs) {
    const row = await prisma.weekOffPattern.create({ data: { code: `${w.code}-${tag}`, name: w.name, rules: w.rules } });
    patternId.set(w.code, row.id);
    created.patterns.push(row.id);
  }
  const leaveTypeId = new Map<string, string>();
  // A leave type's code is what the engine writes into the day's status ("SIMPL:P"), so it must be exactly the roster's:
  // clear any left behind by a crashed earlier run first.
  const leftovers = await prisma.leaveType.findMany({ where: { code: { in: m.leaveTypes.map((l) => l.code) } }, select: { id: true } });
  if (leftovers.length) {
    await prisma.leaveRequest.deleteMany({ where: { leaveTypeId: { in: leftovers.map((x) => x.id) } } });
    await deleteWithDependents("LeaveType", leftovers.map((x) => x.id));
  }
  for (const l of m.leaveTypes) {
    const row = await prisma.leaveType.create({ data: { code: l.code, name: l.name, isPaid: l.paid } });
    leaveTypeId.set(l.code, row.id);
    created.leaveTypes.push(row.id);
  }
  const have = new Set((await existingHolidays(roster.month)).map((h) => h.date));
  for (const h of m.holidays) {
    if (have.has(h.date)) continue;
    created.holidays.push((await prisma.holiday.create({ data: { date: day(h.date), name: h.name } })).id);
  }

  // The people, in bulk.
  const rows = await prisma.employee.createManyAndReturn({
    data: roster.employees.map((e) => ({ employeeCode: `${e.code}-${tag}`, dateOfJoining: day(e.joined), lastWorkingDate: e.lastWorking ? day(e.lastWorking) : null, employmentType: "PERMANENT" as const })),
    select: { id: true, employeeCode: true },
  });
  const byCode = new Map(rows.map((r) => [r.employeeCode, r.id]));
  const employeeId = new Map(roster.employees.map((e) => [e.code, byCode.get(`${e.code}-${tag}`)!]));
  const codeOf = new Map([...employeeId].map(([code, id]) => [id, code]));

  await prisma.deviceUserMapping.createMany({
    data: roster.employees.filter((e) => e.mappingFrom !== null).map((e) => ({ employeeId: employeeId.get(e.code)!, deviceUserId: e.deviceUserId, validFrom: day(e.mappingFrom!), createdByUserId: admin.userId })),
  });
  await prisma.attendanceAssignment.createMany({
    data: roster.employees.map((e) => ({
      employeeId: employeeId.get(e.code)!,
      shiftId: shiftId.get(e.shift)!,
      weekOffPatternId: patternId.get(e.weekOff)!,
      policyId: policyId.get(e.policy)!,
      // As Add Employee gives: from the joining date; ended the day after the last working day.
      effectiveFrom: day(e.archetype === "joiner" ? e.joined : "2024-01-01"),
      effectiveTo: e.lastWorking ? dayAfter(e.lastWorking) : null,
      createdByUserId: admin.userId,
    })),
  });
  const leaves = roster.employees.flatMap((e) => e.leaves.map((l) => ({ e, l })));
  await prisma.leaveRequest.createMany({
    data: leaves.map(({ e, l }) => ({
      employeeId: employeeId.get(e.code)!,
      leaveTypeId: leaveTypeId.get(l.type)!,
      fromDate: day(l.date),
      toDate: day(l.date),
      fromDayPart: l.part,
      toDayPart: l.part,
      totalDays: l.part === "FULL" ? 1 : 0.5,
      status: "APPROVED" as const,
      appliedByUserId: admin.userId,
    })),
  });
  if (manualEntries.length) {
    await prisma.manualAttendanceEntry.createMany({
      data: manualEntries.map((x) => ({
        employeeId: employeeId.get(x.employee)!,
        date: day(x.date),
        kind: x.kind,
        inTime: x.inTime ?? null,
        outTime: x.outTime ?? null,
        status: x.status ?? null,
        via: "SCREEN" as const,
        enteredByUserId: admin.userId,
      })),
    });
  }

  const employeeIds = [...employeeId.values()];
  return {
    tag,
    roster,
    employeeId,
    codeOf,
    deviceId: device.id,
    employeeIds,
    async cleanup() {
      await deleteEmployeesAndDependents(employeeIds);
      await deleteWithDependents("Device", [device.id]);
      await deleteWithDependents("Shift", created.shifts);
      await deleteWithDependents("AttendancePolicy", created.policies);
      await deleteWithDependents("WeekOffPattern", created.patterns);
      await deleteWithDependents("LeaveType", created.leaveTypes);
      await deleteWithDependents("Holiday", created.holidays);
      await cleanupFullTestEmployee(admin.employeeId);
      await cleanupEmployeeTestOrgMasters(org);
    },
  };
}

/** The manual entries the plan says were typed in, as rows. */
export function manualEntriesOf(plan: MonthPlan) {
  return plan.days.flatMap((d) =>
    d.manual
      ? [d.manual.kind === "TIMED" ? { employee: d.employee, date: d.date, kind: "TIMED" as const, inTime: d.manual.inTime, outTime: d.manual.outTime } : { employee: d.employee, date: d.date, kind: "STATUS_ONLY" as const, status: d.manual.status }]
      : [],
  );
}
