import { writeAuditLogs } from "../../lib/audit";
import { businessToday } from "../../lib/businessDate";
import { loadCycleRules, recentCycles } from "../../lib/attendanceCycle";
import { assignmentsBetween, namesOn, notifyPayrollInputsChanged, payrollConsumedBetween } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { computeAttendance } from "./compute";
import { employeesInRange } from "./jobs";
import type { Meta } from "./processService";

// Period finalisation's gate (user, 2026-10-09, after the P2-C review):
// "nobody should be able to finalise a period while the thresholds are still
// marked as placeholders — make that a hard block with a clear message, so
// these numbers can't reach payroll unconfirmed."
//
// Finalisation itself (the screen, unlock, payroll's lock check) is Phase 3.
// The gate is built now so it exists before anything can lock a day:
// `finalisePeriod` below is the ONLY code allowed to set `is_locked`
// (a guard test enforces that), and it refuses while any blocker remains.
//
// Blockers, all in the period:
//  - a shift or policy in use whose values are still HR placeholders
//    (any placeholder field, not only the day thresholds — fail safe);
//  - an NM ("not marked") day (plan §4.3: paid days are never guessed);
//  - an NS ("no shift") day;
//  - a day that isn't up to date: re-running the engine now (a dry run, no
//    writes) would change it — a rule value edited since it was computed
//    (e.g. HR's confirmed threshold replacing the placeholder), a punch,
//    leave or holiday not yet processed, a day never computed, or one still
//    provisional;
//  - a forgot-to-punch request still waiting for a decision (P2-E);
//  - a punch with an implausible time (flagged) still waiting for HR's decision (Phase 3): it could change a day once decided;
//  - the period hasn't ended yet.

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const LIST_LIMIT = 50;

const FIELD_LABELS: Record<string, string> = {
  fullDayMinMinutes: "full-day minimum",
  halfDayMinMinutes: "half-day minimum",
  graceInMinutes: "grace in",
  graceOutMinutes: "grace out",
};

export type FinalisationBlocker =
  | { code: "PERIOD_NOT_OVER"; message: string }
  | { code: "FLAGGED_PUNCHES"; message: string; count: number; punches: Array<{ id: string; deviceUserId: string; employeeId: string | null; employeeName: string | null; date: string; flag: string }> }
  | { code: "PENDING_REGULARIZATIONS"; message: string; count: number; days: Array<{ employeeId: string; employeeName: string; date: string }> }
  | { code: "PLACEHOLDER_RULES"; message: string; rules: Array<{ kind: "SHIFT" | "POLICY"; id: string; code: string; name: string; fields: string[] }> }
  | { code: "NOT_MARKED" | "NO_SHIFT" | "NOT_UP_TO_DATE"; message: string; count: number; days: Array<{ employeeId: string; employeeName: string; date: string }> };

function joinAnd(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

const CHUNK = 50;

/** Days the engine would change if the period were processed now (dry run). */
async function staleDays(ids: string[], fromDate: string, toDate: string) {
  let count = 0;
  const found: Array<{ employeeId: string; date: string }> = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const r = await computeAttendance(ids.slice(i, i + CHUNK), fromDate, toDate, { dryRun: true, maxChanges: Math.max(0, LIST_LIMIT - found.length) });
    count += r.changed;
    found.push(...r.changes.map((c) => ({ employeeId: c.employeeId, date: c.date })));
  }
  const names = await namesOn([...new Set(found.map((r) => r.employeeId))], day(toDate));
  return { count, days: found.map((r) => ({ ...r, employeeName: names.get(r.employeeId) ?? r.employeeId })) };
}

async function dayList(where: { status?: string }, from: Date, to: Date) {
  const filter = { date: { gte: from, lte: to }, ...where };
  const [count, rows] = await Promise.all([
    prisma.dailyAttendance.count({ where: filter }),
    prisma.dailyAttendance.findMany({ where: filter, select: { employeeId: true, date: true }, orderBy: [{ date: "asc" }, { employeeId: "asc" }], take: LIST_LIMIT }),
  ]);
  const names = await namesOn([...new Set(rows.map((r) => r.employeeId))], to);
  return { count, days: rows.map((r) => ({ employeeId: r.employeeId, employeeName: names.get(r.employeeId) ?? r.employeeId, date: iso(r.date) })) };
}

/** Everything standing in the way of finalising `from`..`to` (ISO dates, inclusive). Empty = ready. */
/** A period is at most a year: the check dry-runs the engine over every day of it. */
export const MAX_FINALISATION_DAYS = 366;

export async function finalisationBlockers(fromDate: string, toDate: string): Promise<FinalisationBlocker[]> {
  const from = day(fromDate);
  const to = day(toDate);
  if (fromDate > toDate) throw new HttpError(400, "The start date must be on or before the end date.", "VALIDATION_ERROR");
  if ((to.getTime() - from.getTime()) / 86_400_000 + 1 > MAX_FINALISATION_DAYS) throw new HttpError(400, `Check at most ${MAX_FINALISATION_DAYS} days at a time.`, "VALIDATION_ERROR");
  const blockers: FinalisationBlocker[] = [];

  if (toDate >= iso(businessToday())) {
    blockers.push({ code: "PERIOD_NOT_OVER", message: `The period runs to ${toDate}; it can be finalised only once every day in it has passed.` });
  }

  // Rules in use: what each computed day recorded, plus every assignment in
  // force in the period (so a day not computed yet can't slip through).
  const ids = await employeesInRange(fromDate, toDate);
  const [assignments, usedOnDays] = await Promise.all([
    assignmentsBetween(ids, from, to),
    prisma.dailyAttendance.findMany({ where: { date: { gte: from, lte: to } }, distinct: ["shiftId", "policyId"], select: { shiftId: true, policyId: true } }),
  ]);
  const shiftIds = new Set<string>(assignments.map((a) => a.shiftId));
  const policyIds = new Set<string>(assignments.map((a) => a.policyId));
  for (const d of usedOnDays) {
    if (d.shiftId) shiftIds.add(d.shiftId);
    if (d.policyId) policyIds.add(d.policyId);
  }
  const [shifts, policies] = await Promise.all([
    prisma.shift.findMany({ where: { id: { in: [...shiftIds] } }, select: { id: true, code: true, name: true, placeholderFields: true }, orderBy: { code: "asc" } }),
    prisma.attendancePolicy.findMany({ where: { id: { in: [...policyIds] } }, select: { id: true, code: true, name: true, placeholderFields: true }, orderBy: { code: "asc" } }),
  ]);
  const fieldsOf = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);
  const rules = [
    ...policies.filter((p) => fieldsOf(p.placeholderFields).length).map((p) => ({ kind: "POLICY" as const, id: p.id, code: p.code, name: p.name, fields: fieldsOf(p.placeholderFields) })),
    ...shifts.filter((s) => fieldsOf(s.placeholderFields).length).map((s) => ({ kind: "SHIFT" as const, id: s.id, code: s.code, name: s.name, fields: fieldsOf(s.placeholderFields) })),
  ];
  if (rules.length) {
    const what = joinAnd(rules.map((r) => `${r.kind === "POLICY" ? "policy" : "shift"} "${r.name}" (${joinAnd(r.fields.map((f) => FIELD_LABELS[f] ?? f))})`));
    blockers.push({
      code: "PLACEHOLDER_RULES",
      message:
        `Rule values used in this period are still placeholders, not HR-confirmed: ${what}. ` +
        "Enter HR's values (or confirm the current ones) in Attendance Settings, run Process Attendance for the period, then finalise.",
      rules,
    });
  }

  const nm = await dayList({ status: "NM" }, from, to);
  if (nm.count) blockers.push({ code: "NOT_MARKED", message: `${plural(nm.count, "day")} at manual-capture branches ${nm.count === 1 ? "is" : "are"} not marked. Mark them in the Attendance Muster.`, ...nm });
  const ns = await dayList({ status: "NS" }, from, to);
  if (ns.count) blockers.push({ code: "NO_SHIFT", message: `${plural(ns.count, "day")} had no shift assigned. Assign a shift, then run Process Attendance.`, ...ns });
  // A forgot-to-punch request still waiting would change its day once decided (P2-E).
  const pendingRequests = await prisma.regularizationRequest.findMany({ where: { status: "PENDING", date: { gte: from, lte: to } }, select: { employeeId: true, date: true }, orderBy: { date: "asc" }, take: 500 });
  if (pendingRequests.length) {
    const names = await namesOn([...new Set(pendingRequests.map((r) => r.employeeId))], to);
    blockers.push({
      code: "PENDING_REGULARIZATIONS",
      message: `${plural(pendingRequests.length, "regularization request")} in this period ${pendingRequests.length === 1 ? "is" : "are"} still waiting for a decision. Approve or reject ${pendingRequests.length === 1 ? "it" : "them"} first.`,
      count: pendingRequests.length,
      days: pendingRequests.slice(0, LIST_LIMIT).map((r) => ({ employeeId: r.employeeId, employeeName: names.get(r.employeeId) ?? r.employeeId, date: iso(r.date) })),
    });
  }

  // A flagged punch nobody has decided could change a day when it is: HR decides first (Phase 3).
  const flaggedWhere = { businessDate: { gte: from, lte: to }, flag: { not: null }, flagResolution: null } as const;
  const flaggedCount = await prisma.rawPunch.count({ where: flaggedWhere });
  if (flaggedCount) {
    const rows = await prisma.rawPunch.findMany({ where: flaggedWhere, select: { id: true, deviceUserId: true, employeeId: true, businessDate: true, flag: true }, orderBy: [{ businessDate: "asc" }, { punchedAt: "asc" }], take: LIST_LIMIT });
    const names = await namesOn([...new Set(rows.map((r) => r.employeeId).filter((x): x is string => !!x))], to);
    blockers.push({
      code: "FLAGGED_PUNCHES",
      message: `${plural(flaggedCount, "punch", "punches")} with an implausible time ${flaggedCount === 1 ? "is" : "are"} still waiting for a decision. Accept or discard ${flaggedCount === 1 ? "it" : "them"} in Devices → Flagged.`,
      count: flaggedCount,
      punches: rows.map((r) => ({ id: r.id, deviceUserId: r.deviceUserId, employeeId: r.employeeId, employeeName: r.employeeId ? (names.get(r.employeeId) ?? null) : null, date: iso(r.businessDate), flag: r.flag as string })),
    });
  }

  const stale = await staleDays(ids, fromDate, toDate);
  if (stale.count) {
    blockers.push({
      code: "NOT_UP_TO_DATE",
      message: `${plural(stale.count, "day")} would change if processed now (a rule value, punch, leave or holiday changed since ${stale.count === 1 ? "it was" : "they were"} computed, or ${stale.count === 1 ? "it was" : "they were"} never computed). Run Process Attendance for the period.`,
      ...stale,
    });
  }

  return blockers;
}

/** Throws 409 FINALISATION_BLOCKED, listing every blocker, unless the period is ready. */
export async function assertCanFinalise(fromDate: string, toDate: string): Promise<void> {
  const blockers = await finalisationBlockers(fromDate, toDate);
  if (blockers.length === 0) return;
  throw new HttpError(409, `This period can't be finalised yet. ${blockers.map((b) => b.message).join(" ")}`, "FINALISATION_BLOCKED", { blockers });
}

/** Things worth knowing that do not stop a period being finalised. */
export interface FinalisationWarning {
  code: "UNMAPPED_PUNCHES";
  message: string;
  count: number;
  deviceUserIds: string[];
}

async function finalisationWarnings(fromDate: string, toDate: string): Promise<FinalisationWarning[]> {
  const where = { businessDate: { gte: day(fromDate), lte: day(toDate) }, employeeId: null } as const;
  const count = await prisma.rawPunch.count({ where });
  if (!count) return [];
  const ids = await prisma.rawPunch.findMany({ where, distinct: ["deviceUserId"], select: { deviceUserId: true }, orderBy: { deviceUserId: "asc" }, take: 20 });
  return [
    {
      code: "UNMAPPED_PUNCHES",
      message: `${plural(count, "punch", "punches")} in this period belong${count === 1 ? "s" : ""} to device IDs that match no employee. They don't change anyone's attendance, but check nobody is missing a day (Attendance Exceptions, or Devices → Unmapped).`,
      count,
      deviceUserIds: ids.map((r) => r.deviceUserId),
    },
  ];
}

export async function finalisationReadiness(fromDate: string, toDate: string) {
  const blockers = await finalisationBlockers(fromDate, toDate);
  return { from: fromDate, to: toDate, ready: blockers.length === 0, blockers, warnings: await finalisationWarnings(fromDate, toDate) };
}

/**
 * Lock every computed day in the period. The single writer of `is_locked = true`; refuses while `finalisationBlockers` reports
 * anything. The lock and its record (who, when) are one transaction. Callers go through `finaliseCycle`, which also insists
 * the period is a whole attendance cycle.
 */
export async function finalisePeriod(fromDate: string, toDate: string, meta: Meta, note = ""): Promise<{ locked: number }> {
  await assertCanFinalise(fromDate, toDate);
  const locked = await prisma.$transaction(async (tx) => {
    const { count } = await tx.dailyAttendance.updateMany({ where: { date: { gte: day(fromDate), lte: day(toDate) }, isLocked: false }, data: { isLocked: true } });
    await tx.attendancePeriodLock.create({ data: { periodStart: day(fromDate), periodEnd: day(toDate), action: "FINALISE", reason: note, lockedDays: count, actorUserId: meta.actorUserId } });
    await writeAuditLogs([{ ...meta, action: "attendance.period.finalised", entityType: "DailyAttendance", entityId: `${fromDate}..${toDate}`, after: { from: fromDate, to: toDate, locked: count, note } }], tx);
    return count;
  });
  return { locked };
}

// ── Periods: the attendance cycles and what has been done to them (Phase 3 commit 3) ──────────

export type PeriodStatus = "OPEN" | "FINALISED" | "UNLOCKED";

export interface PeriodRow {
  from: string;
  to: string;
  label: string;
  isOver: boolean;
  /** OPEN: never finalised. FINALISED: locked. UNLOCKED: was finalised, then opened again by a Super Admin, not yet finalised again. */
  status: PeriodStatus;
  lockedDays: number;
  last: { action: "FINALISE" | "UNLOCK"; at: string; by: string | null; reason: string; payrollConsumed: boolean } | null;
  /**
   * Finalised cycles only: people employed in the cycle who have days in it that are not locked (days that did not exist
   * when it was finalised, such as a joiner dated inside it). The engine does not write inside a finalised cycle, so these
   * wait for an unlock, a reprocess and a fresh finalise. Null for a cycle that is not finalised.
   */
  unprocessed: { employees: number; days: number; people: Array<{ employeeId: string; employeeCode: string; name: string | null; days: number }> } | null;
}

const UNPROCESSED_LIST = 10;

async function unprocessedIn(from: Date, to: Date): Promise<NonNullable<PeriodRow["unprocessed"]>> {
  const today = businessToday();
  const lastDay = to < today ? to : today;
  const employees = await prisma.employee.findMany({
    where: { dateOfJoining: { lte: lastDay }, OR: [{ lastWorkingDate: null }, { lastWorkingDate: { gte: from } }] },
    select: { id: true, employeeCode: true, dateOfJoining: true, lastWorkingDate: true },
    orderBy: { employeeCode: "asc" },
  });
  const locked = await prisma.dailyAttendance.groupBy({ by: ["employeeId"], where: { date: { gte: from, lte: to }, isLocked: true }, _count: { _all: true } });
  const lockedBy = new Map(locked.map((l) => [l.employeeId, l._count._all]));
  const missing: Array<{ id: string; code: string; days: number }> = [];
  for (const e of employees) {
    const first = e.dateOfJoining > from ? e.dateOfJoining : from;
    const end = e.lastWorkingDate && e.lastWorkingDate < lastDay ? e.lastWorkingDate : lastDay;
    if (end < first) continue;
    const expected = Math.round((end.getTime() - first.getTime()) / 86_400_000) + 1;
    const days = expected - (lockedBy.get(e.id) ?? 0);
    if (days > 0) missing.push({ id: e.id, code: e.employeeCode, days });
  }
  const shown = missing.slice(0, UNPROCESSED_LIST);
  const names = await namesOn(shown.map((m) => m.id), lastDay);
  return {
    employees: missing.length,
    days: missing.reduce((n, m) => n + m.days, 0),
    people: shown.map((m) => ({ employeeId: m.id, employeeCode: m.code, name: names.get(m.id) ?? null, days: m.days })),
  };
}

async function userNames(userIds: string[]) {
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(userIds)] } }, select: { id: true, employeeId: true } });
  const names = await namesOn(users.map((u) => u.employeeId), businessToday());
  return new Map(users.map((u) => [u.id, names.get(u.employeeId) ?? null]));
}

/** The latest cycles (the current one and the twelve before), newest first, each with its status. */
/** The 13 cycles ending at or before `asOf` (default today) — newest first. */
export async function listPeriods(asOf?: string): Promise<PeriodRow[]> {
  const cycles = recentCycles(await loadCycleRules(), asOf ? day(asOf) : businessToday(), 13);
  const today = iso(businessToday());
  const rows = await Promise.all(
    cycles.map(async (c) => {
      const [last, lockedDays] = await Promise.all([
        prisma.attendancePeriodLock.findFirst({ where: { periodStart: c.start, periodEnd: c.end }, orderBy: { seq: "desc" } }),
        prisma.dailyAttendance.count({ where: { date: { gte: c.start, lte: c.end }, isLocked: true } }),
      ]);
      return { c, last, lockedDays };
    }),
  );
  const names = await userNames(rows.flatMap((r) => (r.last ? [r.last.actorUserId] : [])));
  const unprocessed = await Promise.all(rows.map(({ c, last }) => (last?.action === "FINALISE" ? unprocessedIn(c.start, c.end) : Promise.resolve(null))));
  return rows.map(({ c, last, lockedDays }, i) => ({
    from: iso(c.start),
    to: iso(c.end),
    label: c.label,
    isOver: iso(c.end) < today,
    status: !last ? "OPEN" : last.action === "FINALISE" ? "FINALISED" : "UNLOCKED",
    lockedDays,
    last: last ? { action: last.action, at: last.createdAt.toISOString(), by: names.get(last.actorUserId) ?? null, reason: last.reason, payrollConsumed: last.payrollConsumed } : null,
    unprocessed: unprocessed[i] ?? null,
  }));
}

/** The cycle that is exactly [from, to]; a part of one, or two, is refused (a half-locked cycle helps nobody). */
async function cycleExactly(fromDate: string, toDate: string) {
  const cycle = recentCycles(await loadCycleRules(), day(toDate), 1)[0]!;
  if (iso(cycle.start) !== fromDate || iso(cycle.end) !== toDate) {
    throw new HttpError(400, "That isn't a whole attendance cycle. A period is finalised and unlocked a whole cycle at a time.", "NOT_A_CYCLE");
  }
  return cycle;
}

async function latestAction(fromDate: string, toDate: string) {
  return prisma.attendancePeriodLock.findFirst({ where: { periodStart: day(fromDate), periodEnd: day(toDate) }, orderBy: { seq: "desc" } });
}

/** Finalise a whole attendance cycle once nothing blocks it (the server enforces every blocker). */
export async function finaliseCycle(fromDate: string, toDate: string, meta: Meta, note = "") {
  await cycleExactly(fromDate, toDate);
  if ((await latestAction(fromDate, toDate))?.action === "FINALISE") throw new HttpError(409, "This period is already finalised.", "ALREADY_FINALISED");
  return finalisePeriod(fromDate, toDate, meta, note);
}

/**
 * Open a finalised cycle again (Super Admin only, with a reason). If payroll has used the period the answer is a 409 that
 * names it, and the unlock goes ahead only when the caller confirms they know. Payroll doesn't exist until Phase 6, so
 * the check answers "not used" until then (lib/effectiveDating's payroll lock hook). The days stay as they were computed;
 * they are open to changes and to Process Attendance again, and the cycle must be finalised again before payroll reads it.
 */
export async function unlockCycle(fromDate: string, toDate: string, input: { reason: string; confirmPayrollConsumed: boolean }, actor: { roleCodes: string[] }, meta: Meta) {
  if (!actor.roleCodes.includes("SUPER_ADMIN")) throw new HttpError(403, "Only a Super Admin can unlock a finalised period.", "SUPER_ADMIN_ONLY");
  await cycleExactly(fromDate, toDate);
  const reason = input.reason.trim();
  if (reason.length < 5) throw new HttpError(400, "Say why the period is being unlocked (a few words).", "VALIDATION_ERROR");
  const last = await latestAction(fromDate, toDate);
  if (last?.action !== "FINALISE") throw new HttpError(409, "This period isn't finalised, so there is nothing to unlock.", "NOT_FINALISED");
  const payroll = await payrollConsumedBetween(day(fromDate), day(toDate));
  if (payroll.consumed && !input.confirmPayrollConsumed) {
    const stage = payroll.stage === "FINALISED" ? "has already used" : payroll.stage === "APPROVED" ? "has had a run approved on" : "has a run waiting for approval on";
    throw new HttpError(409, `Payroll for ${payroll.period} ${stage} this period's attendance. Unlocking it lets attendance change under a payroll that was run on the old figures${payroll.stage === "FINALISED" ? "" : ", and voids that run's approval"}. Confirm that you understand, or leave it locked.`, "PAYROLL_CONSUMED", { period: payroll.period, stage: payroll.stage });
  }
  const unlocked = await prisma.$transaction(async (tx) => {
    const { count } = await tx.dailyAttendance.updateMany({ where: { date: { gte: day(fromDate), lte: day(toDate) }, isLocked: true }, data: { isLocked: false } });
    await tx.attendancePeriodLock.create({ data: { periodStart: day(fromDate), periodEnd: day(toDate), action: "UNLOCK", reason, lockedDays: count, payrollConsumed: payroll.consumed, actorUserId: meta.actorUserId } });
    await writeAuditLogs([{ ...meta, action: "attendance.period.unlocked", entityType: "DailyAttendance", entityId: `${fromDate}..${toDate}`, after: { from: fromDate, to: toDate, unlocked: count, reason, payrollConsumed: payroll.consumed, payrollPeriod: payroll.period ?? null } }], tx);
    return count;
  });
  if (payroll.consumed) await notifyPayrollInputsChanged(`attendance for ${fromDate} to ${toDate} was unlocked`, meta.actorUserId ?? null);
  return { unlocked };
}
