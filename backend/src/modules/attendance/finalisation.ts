import { writeAuditLog } from "../../lib/audit";
import { businessToday } from "../../lib/businessDate";
import { assignmentsBetween, namesOn } from "../../lib/effectiveDating";
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
export async function finalisationBlockers(fromDate: string, toDate: string): Promise<FinalisationBlocker[]> {
  const from = day(fromDate);
  const to = day(toDate);
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

export async function finalisationReadiness(fromDate: string, toDate: string) {
  if (fromDate > toDate) throw new HttpError(400, "The start date must be on or before the end date.", "VALIDATION_ERROR");
  const blockers = await finalisationBlockers(fromDate, toDate);
  return { from: fromDate, to: toDate, ready: blockers.length === 0, blockers };
}

/**
 * Lock every computed day in the period. The single writer of `is_locked`;
 * Phase 3 puts the Period Finalisation screen, unlock and the payroll lock
 * check on top of it. Refuses while `finalisationBlockers` reports anything.
 */
export async function finalisePeriod(fromDate: string, toDate: string, meta: Meta): Promise<{ locked: number }> {
  await assertCanFinalise(fromDate, toDate);
  const { count } = await prisma.dailyAttendance.updateMany({ where: { date: { gte: day(fromDate), lte: day(toDate) }, isLocked: false }, data: { isLocked: true } });
  await writeAuditLog({ ...meta, action: "attendance.period.finalised", entityType: "DailyAttendance", entityId: `${fromDate}..${toDate}`, after: { from: fromDate, to: toDate, locked: count } });
  return { locked: count };
}
