import { createHash, randomUUID } from "node:crypto";
import { writeAuditLogs } from "../../../lib/audit";
import { businessToday } from "../../../lib/businessDate";
import { assignmentsBetween, maxScheduleAheadDays, namesOn, rowInForce } from "../../../lib/effectiveDating";
import { getRegularizationSettings } from "../../../lib/regularizationSettings";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { notifyEmployee } from "../../notifications/notifyEmployee";
import { computeAttendance } from "../compute";
import { resolveTargets, spanDays, type Selection } from "../dayTargets";
import { addDays } from "../engine/time";
import type { Viewer } from "../manual/scope";
import { overrideKey } from "../overrides";
import type { Meta } from "../processService";
import { earliestAllowedDate } from "../regularization/service";
import { shiftOverrideKey, shiftWithSessions } from "../shiftOverrides";

// Shift Override (Phase 3 commit 2, docs/plans/PHASE_3.md): a shift for specific dates for one or many employees, read
// by the engine ahead of the assignment's shift. Same machinery as Manual Override — HR with attendance.override.manage,
// a preview, a fingerprint-checked confirmation, caps, one audit row per employee-day in the same transaction, never
// one's own, never a finalised day — with two differences: it can look forward (a swap next Tuesday is the common
// case; the engine reads it when the day arrives, up to the same horizon as scheduled assignment changes), and it
// changes the shift only: the week-off pattern and the policy stay the assignment's.

export interface ShiftOverrideInput {
  selection: Selection;
  from: string;
  to: string;
  shiftId: string;
  note: string;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const CHUNK = 50;

export const SHIFT_PROBLEM_LABEL: Record<string, string> = {
  TOO_OLD: "Older than overrides reach",
  TOO_FAR: "Further ahead than shifts can be scheduled",
  LOCKED: "Finalised",
  PENDING_EXISTS: "A correction request is waiting: decide it first",
  SAME_SHIFT: "Already on that shift that day",
  NO_ASSIGNMENT: "No attendance assignment that day (assign a shift first)",
};

function requireHr(viewer: Viewer): void {
  if (!viewer.permissions.has("attendance.override.manage") || viewer.dataScope !== "ALL") {
    throw new HttpError(403, "Overriding a shift is for HR, across the whole company.", "FORBIDDEN");
  }
}

async function plan(viewer: Viewer, input: ShiftOverrideInput) {
  requireHr(viewer);
  const shift = await prisma.shift.findUnique({ where: { id: input.shiftId }, include: shiftWithSessions });
  if (!shift || !shift.isActive) throw new HttpError(400, "Choose an active shift.", "VALIDATION_ERROR");
  const settings = await getRegularizationSettings();
  const span = spanDays(input.from, input.to);
  if (span > settings.bulkMaxRangeDays) {
    throw new HttpError(400, `A shift override covers at most ${settings.bulkMaxRangeDays} days at a time (this is ${span}). Narrow the dates and do it in parts.`, "TOO_WIDE");
  }
  const { candidateIds, targeted } = await resolveTargets(input.selection, input.from, input.to);
  const today = iso(businessToday());
  const [rows, pendingRows, assignments, earliest, ahead] = await Promise.all([
    prisma.dailyAttendance.findMany({ where: { employeeId: { in: candidateIds }, date: { gte: day(input.from), lte: day(input.to) } } }),
    prisma.regularizationRequest.findMany({ where: { employeeId: { in: candidateIds }, date: { gte: day(input.from), lte: day(input.to) }, status: "PENDING" }, select: { employeeId: true, date: true } }),
    assignmentsBetween(candidateIds, day(input.from), day(input.to)),
    earliestAllowedDate(settings),
    maxScheduleAheadDays(),
  ]);
  const rowOf = new Map(rows.map((r) => [overrideKey(r.employeeId, iso(r.date)), r]));
  const pending = new Set(pendingRows.map((r) => overrideKey(r.employeeId, iso(r.date))));
  const latest = iso(new Date(day(today).getTime() + ahead * 86_400_000));

  const eligible: Array<{ employeeId: string; date: string; before: string | null }> = [];
  const problems = new Map<string, Array<{ employeeId: string; date: string }>>();
  let ownLeftOut = 0;
  for (const employeeId of candidateIds) {
    for (let date = input.from; date <= input.to; date = addDays(date, 1)) {
      if (!targeted(employeeId, date)) continue;
      if (employeeId === viewer.employeeId) {
        ownLeftOut += 1;
        continue;
      }
      const key = overrideKey(employeeId, date);
      const row = rowOf.get(key);
      const a = assignments.filter((x) => x.employeeId === employeeId).find((x) => rowInForce(x, day(date)));
      const problem =
        date < earliest ? "TOO_OLD"
        : date > latest ? "TOO_FAR"
        : row?.isLocked ? "LOCKED"
        : pending.has(key) ? "PENDING_EXISTS"
        : !a ? "NO_ASSIGNMENT"
        : a.shift.id === input.shiftId && !row?.shiftOverrideRef ? "SAME_SHIFT"
        : null;
      if (problem) problems.set(problem, [...(problems.get(problem) ?? []), { employeeId, date }]);
      else eligible.push({ employeeId, date, before: row?.shiftCode ?? a!.shift.code });
    }
  }
  if (eligible.length > settings.bulkMaxEmployeeDays) {
    throw new HttpError(400, `That is ${eligible.length} employee-days; a shift override covers at most ${settings.bulkMaxEmployeeDays} at once. Narrow it and do it in parts.`, "TOO_MANY");
  }

  // What each day (that has happened) would become: a dry run with the shift in place. Future days are computed when they arrive.
  const hypotheticalShifts = new Map(eligible.map((e) => [shiftOverrideKey(e.employeeId, e.date), shift]));
  const after = new Map<string, string | null>();
  const withDays = [...new Set(eligible.filter((e) => e.date <= today).map((e) => e.employeeId))];
  for (let i = 0; i < withDays.length; i += CHUNK) {
    const r = await computeAttendance(withDays.slice(i, i + CHUNK), input.from, input.to, { dryRun: true, collect: true, hypotheticalShifts });
    for (const ev of r.evaluated ?? []) after.set(overrideKey(ev.employeeId, ev.date), ev.after);
  }
  const planned = eligible
    .map((e) => ({ ...e, statusBefore: rowOf.get(overrideKey(e.employeeId, e.date))?.status ?? null, statusAfter: e.date <= today ? (after.get(overrideKey(e.employeeId, e.date)) ?? null) : null }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.employeeId.localeCompare(b.employeeId));
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ k: planned.map((p) => `${p.employeeId}|${p.date}`).sort(), s: input.shiftId, f: input.from, t: input.to }))
    .digest("hex");
  return { planned, problems, ownLeftOut, fingerprint, settings, shift };
}

export async function previewShiftOverride(viewer: Viewer, input: ShiftOverrideInput) {
  const p = await plan(viewer, input);
  const ids = [...new Set([...p.planned.map((x) => x.employeeId), ...[...p.problems.values()].flat().map((x) => x.employeeId)])];
  const [names, people] = await Promise.all([namesOn(ids, day(input.to)), prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, employeeCode: true } })]);
  const code = new Map(people.map((x) => [x.id, x.employeeCode]));
  const who = (id: string) => ({ employeeId: id, employeeCode: code.get(id) ?? "", name: names.get(id) ?? code.get(id) ?? id });
  return {
    count: p.planned.length,
    employees: new Set(p.planned.map((x) => x.employeeId)).size,
    shift: `${p.shift.code} ${p.shift.startTime}–${p.shift.endTime}`,
    ownLeftOut: p.ownLeftOut,
    fingerprint: p.fingerprint,
    caps: { maxRangeDays: p.settings.bulkMaxRangeDays, maxEmployeeDays: p.settings.bulkMaxEmployeeDays },
    rows: p.planned.map((x) => ({ ...who(x.employeeId), date: x.date, shiftBefore: x.before, statusBefore: x.statusBefore, statusAfter: x.statusAfter })),
    cannotOverride: [...p.problems].map(([codeKey, list]) => ({
      code: codeKey,
      label: SHIFT_PROBLEM_LABEL[codeKey] ?? codeKey,
      count: list.length,
      examples: list.slice(0, 5).map((x) => ({ ...who(x.employeeId), date: x.date })),
    })),
  };
}

export async function confirmShiftOverride(viewer: Viewer, input: ShiftOverrideInput & { fingerprint: string }, meta: Meta) {
  const p = await plan(viewer, input);
  if (p.planned.length === 0) throw new HttpError(409, "Nothing in that selection can be changed any more. Review it again.", "SELECTION_CHANGED");
  if (p.fingerprint !== input.fingerprint) {
    throw new HttpError(409, "The set changed since you looked at it (a request was raised, a day was finalised, or an assignment changed). Review it again before confirming.", "SELECTION_CHANGED");
  }
  const rows = p.planned.map((x) => ({ ...x, id: randomUUID() }));
  await prisma.$transaction(
    async (tx) => {
      await tx.shiftOverride.createMany({
        data: rows.map((r) => ({ id: r.id, employeeId: r.employeeId, date: day(r.date), shiftId: input.shiftId, reason: input.note, createdByUserId: viewer.userId })),
      });
      await writeAuditLogs(
        rows.map((r) => ({
          ...meta,
          action: "attendance.shift_override.set",
          entityType: "ShiftOverride",
          entityId: r.id,
          after: { employeeId: r.employeeId, date: r.date, shift: p.shift.code, shiftBefore: r.before, note: input.note, dayBefore: r.statusBefore, dayAfter: r.statusAfter },
        })),
        tx,
      );
    },
    { timeout: 120_000, maxWait: 20_000 },
  );
  const today = iso(businessToday());
  const span = new Map<string, { from: string; to: string; days: number }>();
  for (const r of rows) {
    const s = span.get(r.employeeId);
    span.set(r.employeeId, { from: s && s.from < r.date ? s.from : r.date, to: s && s.to > r.date ? s.to : r.date, days: (s?.days ?? 0) + 1 });
  }
  for (const [employeeId, s] of span) {
    if (s.from <= today) await computeAttendance([employeeId], s.from, s.to < today ? s.to : today);
    await notifyEmployee(employeeId, {
      type: "attendance.shift_changed",
      title: s.days === 1 ? "Your shift changed for a day" : `Your shift changed for ${s.days} days`,
      body: `${p.shift.code} (${p.shift.startTime}–${p.shift.endTime})${s.days === 1 ? ` on ${s.from}` : ` from ${s.from} to ${s.to}`}. ${input.note}`,
      link: `/app/attendance/info?date=${s.from}`,
      payload: {},
    });
  }
  return { days: rows.length, employees: span.size, ownLeftOut: p.ownLeftOut };
}

/** Take a day back to the assignment's shift. */
export async function clearShiftOverride(viewer: Viewer, input: { employeeId: string; date: string; note: string }, meta: Meta) {
  requireHr(viewer);
  if (input.employeeId === viewer.employeeId) throw new HttpError(403, "You can't change your own shift. Another administrator does it.", "OWN_ATTENDANCE");
  const settings = await getRegularizationSettings();
  const [active, row, earliest] = await Promise.all([
    prisma.shiftOverride.findFirst({ where: { employeeId: input.employeeId, date: day(input.date) }, orderBy: { seq: "desc" } }),
    prisma.dailyAttendance.findUnique({ where: { employeeId_date: { employeeId: input.employeeId, date: day(input.date) } } }),
    earliestAllowedDate(settings),
  ]);
  if (!active || !active.shiftId) throw new HttpError(409, "This day has no shift override.", "NOTHING_TO_CLEAR");
  if (row?.isLocked) throw new HttpError(409, "This day's attendance is finalised.", "LOCKED");
  if (input.date < earliest) throw new HttpError(409, "Overrides reach back to the start of the previous attendance cycle only.", "TOO_OLD");
  const created = await prisma.$transaction(async (tx) => {
    const o = await tx.shiftOverride.create({ data: { employeeId: input.employeeId, date: day(input.date), shiftId: null, reason: input.note, createdByUserId: viewer.userId } });
    await writeAuditLogs([{ ...meta, action: "attendance.shift_override.cleared", entityType: "ShiftOverride", entityId: o.id, after: { employeeId: input.employeeId, date: input.date, note: input.note } }], tx);
    return o;
  });
  if (input.date <= iso(businessToday())) await computeAttendance([input.employeeId], input.date, input.date);
  await notifyEmployee(input.employeeId, {
    type: "attendance.shift_changed",
    title: "Your shift went back to normal for a day",
    body: `The shift override on ${input.date} was removed. ${input.note}`,
    link: `/app/attendance/info?date=${input.date}`,
    payload: {},
  });
  return { id: created.id };
}

export async function listShiftOverrides(q: { employeeId?: string; from?: string; to?: string; page: number; pageSize: number }) {
  const where = {
    ...(q.employeeId ? { employeeId: q.employeeId } : {}),
    ...(q.from || q.to ? { date: { ...(q.from ? { gte: day(q.from) } : {}), ...(q.to ? { lte: day(q.to) } : {}) } } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.shiftOverride.count({ where }),
    prisma.shiftOverride.findMany({ where, orderBy: { seq: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { employee: { select: { employeeCode: true } }, shift: { select: { code: true, name: true, startTime: true, endTime: true } } } }),
  ]);
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdByUserId))] } }, select: { id: true, employeeId: true } });
  const [empNames, byNames] = await Promise.all([namesOn([...new Set(rows.map((r) => r.employeeId))], businessToday()), namesOn(users.map((u) => u.employeeId), businessToday())]);
  const userEmp = new Map(users.map((u) => [u.id, u.employeeId]));
  const newest = new Map<string, number>();
  if (rows.length) {
    for (const r of await prisma.shiftOverride.groupBy({ by: ["employeeId", "date"], where: { OR: rows.map((r) => ({ employeeId: r.employeeId, date: r.date })) }, _max: { seq: true } })) {
      newest.set(shiftOverrideKey(r.employeeId, iso(r.date)), r._max.seq ?? 0);
    }
  }
  return {
    total,
    entries: rows.map((r) => ({
      id: r.id,
      employeeId: r.employeeId,
      employeeCode: r.employee.employeeCode,
      employeeName: empNames.get(r.employeeId) ?? r.employee.employeeCode,
      date: iso(r.date),
      shift: r.shift ? `${r.shift.code} ${r.shift.startTime}–${r.shift.endTime}` : "Removed (back to the assignment's shift)",
      cleared: !r.shiftId,
      reason: r.reason,
      by: byNames.get(userEmp.get(r.createdByUserId) ?? "") ?? "someone",
      at: r.createdAt.toISOString(),
      inForce: newest.get(shiftOverrideKey(r.employeeId, iso(r.date))) === r.seq && !!r.shiftId,
    })),
  };
}
