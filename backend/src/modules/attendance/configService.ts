import { Prisma } from "@prisma/client";
import { describeWeekOff, sessionProblems, sessionTotals, weekOffRuleProblems, type SessionInput, type WeekOffRule } from "@shared/utils/attendance";
import { prisma } from "../../lib/prisma";
import { writeAuditLog } from "../../lib/audit";
import { addCalendarDays, businessToday } from "../../lib/businessDate";
import { ATTENDANCE_SETTING_KEYS, getAttendanceDefaults, type AttendanceDefaults } from "../../lib/attendanceSettings";
import { cycleChangeProblem, cycleForRules, loadCycleRules, recentCycles } from "../../lib/attendanceCycle";
import { setSetting } from "../../lib/settings";
import { activeUsersHoldingPermission, resolveAccess } from "../../lib/permissions";
import {
  assignmentHistory,
  assignmentUsage,
  assignmentsOn,
  cancelScheduledAssignment,
  deviceCapturedOn,
  employedOn,
  namesOn,
  nextAssignmentChanges,
  placementsOn,
  rowStatus,
  writeAssignmentChange,
  type AssignmentWithRules,
} from "../../lib/effectiveDating";
import { HttpError } from "../../middleware/errorHandler";
import { POLICY_PLACEHOLDER_FIELDS, SHIFT_PLACEHOLDER_FIELDS } from "./configValidators";
import { requestRecomputeRange } from "./recompute";

// Attendance Settings (Phase 2 commit P2-A, docs/plans/PHASE_2.md §2.1,
// §4.6). Company-wide configuration: shifts with their sessions, week-off
// patterns, policies, the company default, the attendance cycle, who works
// which shift from when (effective-dated, through lib/effectiveDating.ts),
// and which branches each manual-entry holder may mark. Every change is
// audited. Deactivated, never deleted.

export interface Meta {
  actorUserId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const placeholders = (v: Prisma.JsonValue): string[] => (Array.isArray(v) ? (v as string[]) : []);

/** Placeholders left after an update: a field is confirmed when its value changes, or HR confirms it as it is. */
function remainingPlaceholders(current: string[], before: Record<string, unknown>, input: Record<string, unknown>, confirm: readonly string[] = []): string[] {
  return current.filter((f) => !confirm.includes(f) && !(f in input && input[f] !== undefined && input[f] !== before[f]));
}

async function conflictSafe<T>(fn: () => Promise<T>, what: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new HttpError(409, `A ${what} with this code already exists.`, "CONFLICT");
    if (err instanceof Prisma.PrismaClientUnknownRequestError && err.message.includes("_no_overlap")) {
      throw new HttpError(409, "That would give this person two overlapping assignments for the same days.", "CONFLICT");
    }
    throw err;
  }
}

// ── Shifts ────────────────────────────────────────────────────────────────

type ShiftWithSessions = Prisma.ShiftGetPayload<{ include: { sessions: true } }>;

function shiftView(s: ShiftWithSessions, inUse: number, defaults: AttendanceDefaults) {
  const sessions = [...s.sessions].sort((a, b) => a.sortOrder - b.sortOrder);
  const totals = sessionTotals(s.startTime, sessions);
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    startTime: s.startTime,
    endTime: s.endTime,
    crossesMidnight: s.endTime <= s.startTime,
    graceInMinutes: s.graceInMinutes,
    graceOutMinutes: s.graceOutMinutes,
    windowBeforeMinutes: s.windowBeforeMinutes,
    windowAfterMinutes: s.windowAfterMinutes,
    sessions: sessions.map((x) => ({ kind: x.kind, label: x.label, startTime: x.startTime, endTime: x.endTime })),
    workMinutes: totals.workMinutes,
    breakMinutes: totals.breakMinutes,
    placeholderFields: placeholders(s.placeholderFields),
    isActive: s.isActive,
    isDefault: s.code === defaults.shiftCode,
    employeeCount: inUse,
  };
}

function assertSessions(startTime: string, endTime: string, sessions: SessionInput[]): void {
  const problems = sessionProblems(startTime, endTime, sessions);
  if (problems.length) throw new HttpError(400, problems.join(" "), "INVALID_SESSIONS");
}

export async function listShifts() {
  const [rows, usage, defaults] = await Promise.all([
    prisma.shift.findMany({ include: { sessions: true }, orderBy: [{ isActive: "desc" }, { code: "asc" }] }),
    assignmentUsage(),
    getAttendanceDefaults(),
  ]);
  return rows.map((s) => shiftView(s, usage.shift.get(s.id) ?? 0, defaults));
}

interface ShiftInput {
  code?: string;
  name?: string;
  startTime?: string;
  endTime?: string;
  graceInMinutes?: number;
  graceOutMinutes?: number;
  windowBeforeMinutes?: number;
  windowAfterMinutes?: number;
  sessions?: SessionInput[];
  isActive?: boolean;
  confirmPlaceholders?: Array<(typeof SHIFT_PLACEHOLDER_FIELDS)[number]>;
}

export async function createShift(input: Required<Omit<ShiftInput, "isActive" | "confirmPlaceholders">>, meta: Meta) {
  assertSessions(input.startTime, input.endTime, input.sessions);
  const { sessions, ...fields } = input;
  const shift = await conflictSafe(
    () =>
      prisma.shift.create({
        data: { ...fields, code: fields.code.toUpperCase(), sessions: { create: sessions.map((s, i) => ({ ...s, sortOrder: i + 1 })) } },
        include: { sessions: true },
      }),
    "shift",
  );
  await writeAuditLog({ ...meta, action: "attendance.shift.created", entityType: "Shift", entityId: shift.id, after: shift });
  return shiftView(shift, 0, await getAttendanceDefaults());
}

export async function updateShift(id: string, input: ShiftInput, meta: Meta) {
  const before = await prisma.shift.findUnique({ where: { id }, include: { sessions: true } });
  if (!before) throw new HttpError(404, "Shift not found.", "NOT_FOUND");
  const startTime = input.startTime ?? before.startTime;
  const endTime = input.endTime ?? before.endTime;
  const sessions = input.sessions ?? [...before.sessions].sort((a, b) => a.sortOrder - b.sortOrder);
  if (input.startTime || input.endTime || input.sessions) assertSessions(startTime, endTime, sessions);
  if (input.isActive === false && before.isActive) await assertNotInUse("shift", before.id, before.code);

  const { sessions: newSessions, confirmPlaceholders, code: _code, ...fields } = input;
  const placeholderFields = remainingPlaceholders(placeholders(before.placeholderFields), before as unknown as Record<string, unknown>, fields, confirmPlaceholders);
  const after = await prisma.$transaction(async (tx) => {
    if (newSessions) {
      await tx.shiftSession.deleteMany({ where: { shiftId: id } });
      await tx.shiftSession.createMany({ data: newSessions.map((s, i) => ({ ...s, shiftId: id, sortOrder: i + 1 })) });
    }
    return tx.shift.update({ where: { id }, data: { ...fields, placeholderFields }, include: { sessions: true } });
  });
  const action = input.isActive === false && before.isActive ? "attendance.shift.deactivated" : input.isActive === true && !before.isActive ? "attendance.shift.reactivated" : "attendance.shift.updated";
  await writeAuditLog({ ...meta, action, entityType: "Shift", entityId: id, before, after });
  const usage = await assignmentUsage();
  return shiftView(after, usage.shift.get(id) ?? 0, await getAttendanceDefaults());
}

/** Deactivating something still applied to someone (today or scheduled), or the company default, would strand them. */
async function assertNotInUse(kind: "shift" | "weekOffPattern" | "policy", id: string, code: string): Promise<void> {
  const defaults = await getAttendanceDefaults();
  const label = { shift: "shift", weekOffPattern: "week-off pattern", policy: "policy" }[kind];
  const isDefault = { shift: defaults.shiftCode, weekOffPattern: defaults.weekOffPatternCode, policy: defaults.policyCode }[kind] === code;
  if (isDefault) throw new HttpError(409, `This is the company default ${label} for new joiners. Choose another default first.`, "IN_USE");
  const n = (await assignmentUsage())[kind].get(id) ?? 0;
  if (n > 0) throw new HttpError(409, `${n} ${n === 1 ? "person is" : "people are"} on this ${label} now or from a scheduled date. Move them to another one first.`, "IN_USE");
}

// ── Week-off patterns ─────────────────────────────────────────────────────

function asRules(v: Prisma.JsonValue): WeekOffRule[] {
  return Array.isArray(v) ? (v as unknown as WeekOffRule[]) : [];
}

export async function listWeekOffPatterns() {
  const [rows, usage, defaults] = await Promise.all([
    prisma.weekOffPattern.findMany({ orderBy: [{ isActive: "desc" }, { code: "asc" }] }),
    assignmentUsage(),
    getAttendanceDefaults(),
  ]);
  return rows.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    rules: asRules(p.rules),
    summary: describeWeekOff(asRules(p.rules)),
    isActive: p.isActive,
    isDefault: p.code === defaults.weekOffPatternCode,
    employeeCount: usage.weekOffPattern.get(p.id) ?? 0,
  }));
}

function assertRules(rules: WeekOffRule[]): void {
  const problems = weekOffRuleProblems(rules);
  if (problems.length) throw new HttpError(400, problems.join(" "), "INVALID_WEEK_OFF_RULES");
}

export async function createWeekOffPattern(input: { code: string; name: string; rules: WeekOffRule[] }, meta: Meta) {
  assertRules(input.rules);
  const row = await conflictSafe(
    () => prisma.weekOffPattern.create({ data: { code: input.code.toUpperCase(), name: input.name, rules: input.rules as unknown as Prisma.InputJsonValue } }),
    "week-off pattern",
  );
  await writeAuditLog({ ...meta, action: "attendance.weekoff_pattern.created", entityType: "WeekOffPattern", entityId: row.id, after: row });
  return row;
}

export async function updateWeekOffPattern(id: string, input: { name?: string; rules?: WeekOffRule[]; isActive?: boolean }, meta: Meta) {
  const before = await prisma.weekOffPattern.findUnique({ where: { id } });
  if (!before) throw new HttpError(404, "Week-off pattern not found.", "NOT_FOUND");
  if (input.rules) assertRules(input.rules);
  if (input.isActive === false && before.isActive) await assertNotInUse("weekOffPattern", id, before.code);
  const after = await prisma.weekOffPattern.update({
    where: { id },
    data: { name: input.name, isActive: input.isActive, rules: input.rules ? (input.rules as unknown as Prisma.InputJsonValue) : undefined },
  });
  await writeAuditLog({ ...meta, action: "attendance.weekoff_pattern.updated", entityType: "WeekOffPattern", entityId: id, before, after });
  return after;
}

// ── Policies ──────────────────────────────────────────────────────────────

type PolicyRow = Prisma.AttendancePolicyGetPayload<object>;

function policyView(p: PolicyRow, inUse: number, defaults: AttendanceDefaults) {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    fullDayMinMinutes: p.fullDayMinMinutes,
    halfDayMinMinutes: p.halfDayMinMinutes,
    halfDayMinNotMetLopDays: Number(p.halfDayMinNotMetLopDays),
    nearDuplicateSeconds: p.nearDuplicateSeconds,
    inferBreakPairing: p.inferBreakPairing,
    // HR 2026-10-08: no late or early penalty. Recorded and visible, never charged.
    penaltyRules: Array.isArray(p.penaltyRules) ? p.penaltyRules : [],
    futureToleranceMinutes: p.futureToleranceMinutes,
    maxPunchAgeDays: p.maxPunchAgeDays,
    placeholderFields: placeholders(p.placeholderFields),
    isActive: p.isActive,
    isDefault: p.code === defaults.policyCode,
    employeeCount: inUse,
  };
}

function assertThresholds(full: number, half: number): void {
  if (half > full) throw new HttpError(400, "The half-day minimum can't be more than the full-day minimum.", "INVALID_THRESHOLDS");
}

export async function listPolicies() {
  const [rows, usage, defaults] = await Promise.all([
    prisma.attendancePolicy.findMany({ orderBy: [{ isActive: "desc" }, { code: "asc" }] }),
    assignmentUsage(),
    getAttendanceDefaults(),
  ]);
  return rows.map((p) => policyView(p, usage.policy.get(p.id) ?? 0, defaults));
}

interface PolicyInput {
  code?: string;
  name?: string;
  fullDayMinMinutes?: number;
  halfDayMinMinutes?: number;
  halfDayMinNotMetLopDays?: number;
  nearDuplicateSeconds?: number;
  inferBreakPairing?: boolean;
  futureToleranceMinutes?: number;
  maxPunchAgeDays?: number;
  isActive?: boolean;
  confirmPlaceholders?: Array<(typeof POLICY_PLACEHOLDER_FIELDS)[number]>;
}

export async function createPolicy(input: Required<Omit<PolicyInput, "isActive" | "confirmPlaceholders">>, meta: Meta) {
  assertThresholds(input.fullDayMinMinutes, input.halfDayMinMinutes);
  const row = await conflictSafe(
    () => prisma.attendancePolicy.create({ data: { ...input, code: input.code.toUpperCase(), halfDayMinNotMetLopDays: new Prisma.Decimal(input.halfDayMinNotMetLopDays) } }),
    "policy",
  );
  const view = policyView(row, 0, await getAttendanceDefaults());
  // The view, not the row: audit JSON can't hold a Decimal.
  await writeAuditLog({ ...meta, action: "attendance.policy.created", entityType: "AttendancePolicy", entityId: row.id, after: view });
  return view;
}

export async function updatePolicy(id: string, input: PolicyInput, meta: Meta) {
  const before = await prisma.attendancePolicy.findUnique({ where: { id } });
  if (!before) throw new HttpError(404, "Policy not found.", "NOT_FOUND");
  assertThresholds(input.fullDayMinMinutes ?? before.fullDayMinMinutes, input.halfDayMinMinutes ?? before.halfDayMinMinutes);
  if (input.isActive === false && before.isActive) await assertNotInUse("policy", id, before.code);
  const { confirmPlaceholders, code: _code, halfDayMinNotMetLopDays, ...fields } = input;
  const placeholderFields = remainingPlaceholders(placeholders(before.placeholderFields), before as unknown as Record<string, unknown>, fields, confirmPlaceholders);
  const after = await prisma.attendancePolicy.update({
    where: { id },
    data: { ...fields, placeholderFields, halfDayMinNotMetLopDays: halfDayMinNotMetLopDays === undefined ? undefined : new Prisma.Decimal(halfDayMinNotMetLopDays) },
  });
  const defaults = await getAttendanceDefaults();
  const usage = (await assignmentUsage()).policy.get(id) ?? 0;
  const view = policyView(after, usage, defaults);
  await writeAuditLog({ ...meta, action: "attendance.policy.updated", entityType: "AttendancePolicy", entityId: id, before: policyView(before, usage, defaults), after: view });
  return view;
}

// ── Company default (new joiners) ─────────────────────────────────────────

export async function getDefaults() {
  const d = await getAttendanceDefaults();
  const [shift, weekOffPattern, policy] = await Promise.all([
    prisma.shift.findUnique({ where: { code: d.shiftCode }, select: { id: true, code: true, name: true } }),
    prisma.weekOffPattern.findUnique({ where: { code: d.weekOffPatternCode }, select: { id: true, code: true, name: true } }),
    prisma.attendancePolicy.findUnique({ where: { code: d.policyCode }, select: { id: true, code: true, name: true } }),
  ]);
  return { shift, weekOffPattern, policy };
}

export async function setDefaults(input: { shiftId: string; weekOffPatternId: string; policyId: string }, meta: Meta) {
  const [shift, weekOffPattern, policy] = await Promise.all([
    prisma.shift.findUnique({ where: { id: input.shiftId } }),
    prisma.weekOffPattern.findUnique({ where: { id: input.weekOffPatternId } }),
    prisma.attendancePolicy.findUnique({ where: { id: input.policyId } }),
  ]);
  if (!shift?.isActive || !weekOffPattern?.isActive || !policy?.isActive) throw new HttpError(400, "Choose an active shift, week-off pattern and policy.", "VALIDATION_ERROR");
  const before = await getAttendanceDefaults();
  const after: AttendanceDefaults = { shiftCode: shift.code, weekOffPatternCode: weekOffPattern.code, policyCode: policy.code };
  await setSetting(ATTENDANCE_SETTING_KEYS.defaults, after, meta.actorUserId);
  await writeAuditLog({ ...meta, action: "attendance.defaults.updated", entityType: "SystemSetting", entityId: ATTENDANCE_SETTING_KEYS.defaults, before, after });
  return getDefaults();
}

// ── Attendance cycle ──────────────────────────────────────────────────────

export async function getCycle() {
  const today = businessToday();
  const rules = await prisma.attendanceCycleRule.findMany({ orderBy: { effectiveFrom: "asc" } });
  const plain = rules.map((r) => ({ effectiveFrom: r.effectiveFrom, startDay: r.startDay }));
  const view = (c: ReturnType<typeof cycleForRules>) => ({ start: iso(c.start), end: iso(c.end), startDay: c.startDay, label: c.label });
  return {
    current: view(cycleForRules(plain, today)),
    recent: recentCycles(plain, today, 6).map(view),
    rules: rules.map((r) => ({ id: r.id, effectiveFrom: iso(r.effectiveFrom), startDay: r.startDay, status: r.effectiveFrom > today ? "scheduled" : "in force or past" })),
  };
}

export async function scheduleCycleChange(input: { effectiveFrom: string; startDay: number }, meta: Meta) {
  const from = new Date(input.effectiveFrom);
  const rules = await loadCycleRules();
  const today = businessToday();
  const problem = cycleChangeProblem(rules, from, input.startDay, today);
  if (problem) throw new HttpError(400, problem, "CYCLE_CHANGE_REFUSED");
  // One scheduled change at a time: a new one replaces any not yet in force.
  const result = await prisma.$transaction(async (tx) => {
    const replaced = await tx.attendanceCycleRule.findMany({ where: { effectiveFrom: { gt: today } } });
    await tx.attendanceCycleRule.deleteMany({ where: { effectiveFrom: { gt: today } } });
    const created = await tx.attendanceCycleRule.create({ data: { effectiveFrom: from, startDay: input.startDay, createdByUserId: meta.actorUserId } });
    return { replaced, created };
  });
  await writeAuditLog({ ...meta, action: "attendance.cycle.scheduled", entityType: "AttendanceCycleRule", entityId: result.created.id, before: result.replaced, after: result.created });
  return getCycle();
}

export async function cancelCycleChange(id: string, meta: Meta) {
  const row = await prisma.attendanceCycleRule.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, "That cycle change wasn't found.", "NOT_FOUND");
  if (row.effectiveFrom <= businessToday()) throw new HttpError(409, "This cycle rule is already in force, so it can't be cancelled — schedule a new change instead.", "HISTORY_IN_FORCE");
  await prisma.attendanceCycleRule.delete({ where: { id } });
  await writeAuditLog({ ...meta, action: "attendance.cycle.cancelled", entityType: "AttendanceCycleRule", entityId: id, before: row });
  return getCycle();
}

// ── Assignments (effective-dated, lib/effectiveDating.ts) ─────────────────

function assignmentView(a: AssignmentWithRules) {
  return {
    id: a.id,
    shift: { id: a.shift.id, code: a.shift.code, name: a.shift.name, startTime: a.shift.startTime, endTime: a.shift.endTime },
    weekOffPattern: { id: a.weekOffPattern.id, code: a.weekOffPattern.code, name: a.weekOffPattern.name, summary: describeWeekOff(asRules(a.weekOffPattern.rules)) },
    policy: { id: a.policy.id, code: a.policy.code, name: a.policy.name },
    effectiveFrom: iso(a.effectiveFrom),
    effectiveTo: a.effectiveTo ? iso(a.effectiveTo) : null,
    lastDay: a.effectiveTo ? iso(addCalendarDays(a.effectiveTo, -1)) : null,
    status: rowStatus(a.effectiveFrom, a.effectiveTo),
    changeReason: a.changeReason,
  };
}

/** An assignment change dated today or earlier recomputes those days (capped at today; locked days are left alone). */
async function recomputeFromAssignment(employeeIds: string[], from: Date): Promise<void> {
  const today = businessToday();
  if (from <= today) await requestRecomputeRange(employeeIds, from, today);
}

/** Everyone currently employed or joining soon, with the assignment in force today and any scheduled change. */
export async function listAssignments(filter: { search?: string; locationId?: string; departmentId?: string; shiftId?: string; capture?: "DEVICE" | "MANUAL" }) {
  const today = businessToday();
  const employees = await prisma.employee.findMany({
    where: { OR: [employedOn(today), { dateOfJoining: { gt: today }, lastWorkingDate: null }] },
    select: { id: true, employeeCode: true, dateOfJoining: true },
    orderBy: { employeeCode: "asc" },
  });
  const ids = employees.map((e) => e.id);
  const [names, placements, current, next, devices] = await Promise.all([
    namesOn(ids, today),
    placementsOn(ids, today),
    assignmentsOn(ids, today),
    nextAssignmentChanges(ids, today),
    deviceCapturedOn(ids, today),
  ]);
  const q = filter.search?.toLowerCase();
  return employees
    .map((e) => {
      const p = placements.get(e.id);
      const a = current.get(e.id);
      const n = next.get(e.id);
      return {
        employeeId: e.id,
        employeeCode: e.employeeCode,
        fullName: names.get(e.id) ?? e.employeeCode,
        department: p?.department ?? null,
        departmentId: p?.departmentId ?? null,
        location: p?.location ?? null,
        locationId: p?.locationId ?? null,
        capture: devices.has(e.id) ? ("DEVICE" as const) : ("MANUAL" as const),
        current: a ? assignmentView(a) : null,
        scheduled: n ? assignmentView(n) : null,
      };
    })
    .filter(
      (r) =>
        (!q || r.fullName.toLowerCase().includes(q) || r.employeeCode.toLowerCase().includes(q)) &&
        (!filter.locationId || r.locationId === filter.locationId) &&
        (!filter.departmentId || r.departmentId === filter.departmentId) &&
        (!filter.shiftId || r.current?.shift.id === filter.shiftId) &&
        (!filter.capture || r.capture === filter.capture),
    );
}

async function assertEmployee(employeeId: string) {
  const e = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, employeeCode: true } });
  if (!e) throw new HttpError(404, "Employee not found.", "NOT_FOUND");
  return e;
}

export async function getAssignmentHistory(employeeId: string) {
  await assertEmployee(employeeId);
  return (await assignmentHistory(employeeId)).map(assignmentView);
}

interface AssignmentChangeInput {
  shiftId?: string;
  weekOffPatternId?: string;
  policyId?: string;
  effectiveFrom: string;
  changeReason?: string | null;
}

/** The chosen shift / pattern / policy must exist and be active. */
async function assertActiveChoices(input: AssignmentChangeInput): Promise<void> {
  const [shift, pattern, policy] = await Promise.all([
    input.shiftId ? prisma.shift.findUnique({ where: { id: input.shiftId }, select: { isActive: true } }) : null,
    input.weekOffPatternId ? prisma.weekOffPattern.findUnique({ where: { id: input.weekOffPatternId }, select: { isActive: true } }) : null,
    input.policyId ? prisma.attendancePolicy.findUnique({ where: { id: input.policyId }, select: { isActive: true } }) : null,
  ]);
  if ((input.shiftId && !shift?.isActive) || (input.weekOffPatternId && !pattern?.isActive) || (input.policyId && !policy?.isActive)) {
    throw new HttpError(400, "Choose an active shift, week-off pattern and policy.", "VALIDATION_ERROR");
  }
}

function fieldsOf(input: AssignmentChangeInput) {
  return { shiftId: input.shiftId, weekOffPatternId: input.weekOffPatternId, policyId: input.policyId };
}

export async function changeAssignment(employeeId: string, input: AssignmentChangeInput, meta: Meta) {
  await assertEmployee(employeeId);
  await assertActiveChoices(input);
  const write = await conflictSafe(
    () =>
      prisma.$transaction((tx) =>
        writeAssignmentChange(tx, employeeId, new Date(input.effectiveFrom), fieldsOf(input), { createdByUserId: meta.actorUserId, changeReason: input.changeReason ?? null }),
      ),
    "assignment",
  );
  await writeAuditLog({ ...meta, action: "attendance.assignment.changed", entityType: "Employee", entityId: employeeId, before: write.before, after: { ...write.after, timeline: write.plan } });
  await recomputeFromAssignment([employeeId], write.after.effectiveFrom);
  return getAssignmentHistory(employeeId);
}

/**
 * The same change for many people (by branch, department or a hand-picked
 * list) in one transaction: all of them, or — if any one is refused (closed
 * history, a later change already scheduled) — none, with who and why.
 */
export async function bulkChangeAssignment(input: AssignmentChangeInput & { employeeIds: string[] }, meta: Meta) {
  await assertActiveChoices(input);
  const ids = [...new Set(input.employeeIds)];
  const found = await prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, employeeCode: true } });
  if (found.length !== ids.length) throw new HttpError(404, "Some of those employees weren't found.", "NOT_FOUND");
  const code = new Map(found.map((e) => [e.id, e.employeeCode]));
  const day = new Date(input.effectiveFrom);
  const writes = await prisma.$transaction(
    async (tx) => {
      const out = [];
      for (const id of ids) {
        try {
          out.push({ employeeId: id, write: await writeAssignmentChange(tx, id, day, fieldsOf(input), { createdByUserId: meta.actorUserId, changeReason: input.changeReason ?? null }) });
        } catch (err) {
          if (err instanceof HttpError) throw new HttpError(err.status, `${code.get(id)}: ${err.message} Nothing was changed.`, err.code);
          throw err;
        }
      }
      return out;
    },
    { timeout: 60_000 },
  );
  await recomputeFromAssignment(ids, day);
  for (const w of writes) {
    await writeAuditLog({ ...meta, action: "attendance.assignment.changed", entityType: "Employee", entityId: w.employeeId, before: w.write.before, after: { ...w.write.after, timeline: w.write.plan, bulk: true } });
  }
  return { changed: writes.length };
}

export async function cancelAssignmentChange(employeeId: string, rowId: string, meta: Meta) {
  await assertEmployee(employeeId);
  const { removed, reopened } = await prisma.$transaction((tx) => cancelScheduledAssignment(tx, employeeId, rowId));
  // A cancelled change was in the future, so no computed day used it.
  await writeAuditLog({ ...meta, action: "attendance.assignment.scheduled_change_cancelled", entityType: "Employee", entityId: employeeId, before: removed, after: { reopenedRowId: reopened.id } });
  return getAssignmentHistory(employeeId);
}

// ── Manual-entry branches (D4: attendance.manual.enter is branch-scoped) ──

/**
 * Everyone who holds attendance.manual.enter, and which branches they may
 * mark. A holder with company-wide (ALL) data scope marks every branch;
 * anyone else marks only the branches assigned here — none until HR picks.
 */
export async function listManualBranchHolders() {
  const holders = await activeUsersHoldingPermission("attendance.manual.enter");
  const today = businessToday();
  const users = await prisma.user.findMany({
    where: { id: { in: holders.map((h) => h.userId) } },
    select: { id: true, employeeId: true, employee: { select: { employeeCode: true } }, attendanceManualBranches: { include: { location: { select: { id: true, name: true, code: true } } } } },
  });
  const names = await namesOn(users.map((u) => u.employeeId), today);
  const out = [];
  for (const u of users) {
    const access = await resolveAccess(u.id);
    out.push({
      userId: u.id,
      employeeId: u.employeeId,
      employeeCode: u.employee.employeeCode,
      fullName: names.get(u.employeeId) ?? u.employee.employeeCode,
      roles: access.roleCodes,
      allBranches: access.dataScope === "ALL",
      branches: u.attendanceManualBranches.map((b) => b.location).sort((a, b) => a.name.localeCompare(b.name)),
    });
  }
  return out.sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export async function setManualBranches(userId: string, locationIds: string[], meta: Meta) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new HttpError(404, "User not found.", "NOT_FOUND");
  const access = await resolveAccess(userId);
  if (!access.permissions.has("attendance.manual.enter")) {
    throw new HttpError(409, "This person can't mark attendance. Grant them \"Mark attendance manually\" first.", "PERMISSION_NOT_HELD");
  }
  const ids = [...new Set(locationIds)];
  const locations = await prisma.location.findMany({ where: { id: { in: ids } }, select: { id: true, isActive: true } });
  if (locations.length !== ids.length || locations.some((l) => !l.isActive)) throw new HttpError(400, "Choose active branches.", "VALIDATION_ERROR");
  const before = await prisma.attendanceManualBranch.findMany({ where: { userId }, select: { locationId: true } });
  await prisma.$transaction([
    prisma.attendanceManualBranch.deleteMany({ where: { userId, locationId: { notIn: ids } } }),
    ...ids.map((locationId) => prisma.attendanceManualBranch.upsert({ where: { userId_locationId: { userId, locationId } }, create: { userId, locationId, assignedByUserId: meta.actorUserId }, update: {} })),
  ]);
  await writeAuditLog({ ...meta, action: "attendance.manual_branches.updated", entityType: "User", entityId: userId, before: before.map((b) => b.locationId).sort(), after: ids.sort() });
  return (await listManualBranchHolders()).find((h) => h.userId === userId) ?? null;
}
