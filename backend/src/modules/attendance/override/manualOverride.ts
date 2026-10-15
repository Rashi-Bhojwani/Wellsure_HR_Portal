import { createHash, randomUUID } from "node:crypto";
import { Prisma, type DailyAttendance, type RegularizationReasonCode } from "@prisma/client";
import { writeAuditLogs } from "../../../lib/audit";
import { businessToday } from "../../../lib/businessDate";
import { assignmentsBetween, namesOn, rowInForce } from "../../../lib/effectiveDating";
import { getRegularizationSettings } from "../../../lib/regularizationSettings";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { emitLeaveBalanceChanged } from "../../../realtime/emit";
import { leaveCoverOn, releaseLeaveOnDay, type LeaveCover } from "../../leave/releases";
import { notifyEmployee } from "../../notifications/notifyEmployee";
import { computeAttendance, shiftDef } from "../compute";
import { resolveTargets, spanDays, type Selection } from "../dayTargets";
import { addDays } from "../engine/time";
import type { DayOverride, ShiftDef } from "../engine/types";
import type { Viewer } from "../manual/scope";
import { overrideKey } from "../overrides";
import type { Meta } from "../processService";
import { correctionProblem, describeCorrection, overrideShape, PROBLEM_LABEL, REASON_LABEL, type Correction, type Problem } from "../regularization/correction";
import { earliestAllowedDate } from "../regularization/service";
import { loadShiftOverrides, shiftDefOf } from "../shiftOverrides";

// Manual Override (Phase 3 commit 2, docs/plans/PHASE_3.md): HR sets a day's status or times directly, for one person or
// many, after a preview. It is the regularization machinery without the request: the same override table (latest
// wins, history kept), the same caps and backdating limit, the same fingerprint-checked confirmation, one audit row per
// employee-day in the same transaction as the change, raw punches never altered, and never one's own days.
//
// Three things are special here:
//   - "worked" on a holiday or week-off (the only thing an off day accepts);
//   - a day on approved leave that the person actually worked: with the explicit "release the leave" option, the leave
//     for that day is released and its days go back to the balance in the SAME transaction (modules/leave/releases);
//   - it supersedes: a day that already carries a correction gets a newer row.

export interface OverrideInput extends Correction {
  selection: Selection;
  from: string;
  to: string;
  reasonCode: RegularizationReasonCode;
  /** The written reason; required. */
  note: string;
  /** "They worked on a day of approved leave": release that leave and return the balance. */
  releaseLeave: boolean;
  /** With the release: leave the day's figures to the device's own punches (no status or times are set). */
  followDevice?: boolean;
}

export const FOLLOW_DEVICE_TEXT = "As the device recorded (leave released)";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const CHUNK = 50;

export const OVERRIDE_PROBLEM_LABEL: Record<string, string> = {
  ...PROBLEM_LABEL,
  MANUAL_CAPTURE: "Marked by hand (corrected in the muster)",
  OFF_DAY_WORKED_ONLY: "A holiday or week-off accepts only \"worked\"",
  WORKED_ON_WORKING_DAY: "\"Worked\" is for holidays and week-offs; use Present",
  ON_LEAVE: "On approved leave: tick \"They worked on a day of approved leave\" to release it",
  LEAVE_NOT_ABSENT: "A released leave day can't be set to Absent",
  PENDING_EXISTS: "A correction request is waiting: decide it first",
  NEEDS_BOTH_TIMES: "Give both times (the day has no device punches, or already carries a correction)",
  NOTHING_TO_RELEASE: "No approved leave on this day to release",
};

export interface OverrideDayContext {
  today: string;
  earliest: string;
  pending: boolean;
}

/** Why this day cannot take this override, or null. Pure, so the preview and the confirmation cannot disagree. */
export function overrideDayProblem(row: DailyAttendance | null | undefined, date: string, ctx: OverrideDayContext, c: Correction & { followDevice?: boolean }, releaseLeave: boolean): Problem | null {
  const notOver = { code: "NOT_OVER", message: "The day isn't over yet: it can be overridden once the shift's punch window has closed." };
  if (date >= ctx.today) return notOver;
  if (date < ctx.earliest) return { code: "TOO_OLD", message: "Overrides reach back to the start of the previous attendance cycle only." };
  if (!row) return { code: "NO_RECORD", message: "There's no attendance record for this day." };
  if (row.provisional) return notOver;
  if (row.isLocked) return { code: "LOCKED", message: "This day's attendance is finalised." };
  if (row.capture !== "DEVICE") return { code: "MANUAL_CAPTURE", message: "This person's attendance is marked by hand; the person who marks their branch corrects it in the muster." };
  if (ctx.pending) return { code: "PENDING_EXISTS", message: "A correction request is waiting for this day: decide it first." };
  const offDay = row.source === "HOLIDAY" || row.source === "WEEK_OFF";
  if (offDay) return c.status === "WORKED" ? null : { code: "OFF_DAY_WORKED_ONLY", message: "This was a holiday or week-off: the only thing to set is that the person worked." };
  if (c.status === "WORKED") return { code: "WORKED_ON_WORKING_DAY", message: "\"Worked\" is for a holiday or week-off. On a working day set Present." };
  if (row.source === "LEAVE") {
    if (!releaseLeave) return { code: "ON_LEAVE", message: "This day is on approved leave. If the person worked, tick \"They worked on a day of approved leave\" to release the leave and return the balance." };
    if (c.status === "A") return { code: "LEAVE_NOT_ABSENT", message: "Releasing leave is for a day the person worked; it can't be set to Absent." };
  }
  if (c.followDevice && !row.leaveTypeCode) return { code: "NOTHING_TO_RELEASE", message: "There is no approved leave on this day to release." };
  if (!c.status && !c.followDevice && row.status === "NS") return { code: "NO_SHIFT", message: "No shift was assigned for this day, so times can't be set against it." };
  if (!c.status && !c.followDevice && !(c.inTime && c.outTime) && (row.overrideKind || row.source === "LEAVE")) {
    return { code: "NEEDS_BOTH_TIMES", message: "Give both the time in and the time out: this day already carries a correction or is a leave day." };
  }
  return null;
}

interface PlanRow {
  employeeId: string;
  date: string;
  before: string | null;
  after: string | null;
  replaces: string | null;
  covers: LeaveCover[];
}

function requireHr(viewer: Viewer): void {
  if (!viewer.permissions.has("attendance.override.manage") || viewer.dataScope !== "ALL") {
    throw new HttpError(403, "Overriding attendance is for HR, across the whole company.", "FORBIDDEN");
  }
}

async function plan(viewer: Viewer, input: OverrideInput) {
  requireHr(viewer);
  const settings = await getRegularizationSettings();
  const span = spanDays(input.from, input.to);
  if (span > settings.bulkMaxRangeDays) {
    throw new HttpError(400, `An override covers at most ${settings.bulkMaxRangeDays} days at a time (this is ${span}). Narrow the dates and do it in parts.`, "TOO_WIDE");
  }
  const { candidateIds, targeted } = await resolveTargets(input.selection, input.from, input.to);
  if (input.followDevice && !input.releaseLeave) throw new HttpError(400, "Following the device is for releasing approved leave: tick \"They worked on a day of approved leave\".", "VALIDATION_ERROR");
  const timesNeedShift = !input.status && !input.followDevice;
  const [rows, pendingRows, assignments, shiftOverrides, earliest] = await Promise.all([
    prisma.dailyAttendance.findMany({ where: { employeeId: { in: candidateIds }, date: { gte: day(input.from), lte: day(input.to) } } }),
    prisma.regularizationRequest.findMany({ where: { employeeId: { in: candidateIds }, date: { gte: day(input.from), lte: day(input.to) }, status: "PENDING" }, select: { employeeId: true, date: true } }),
    timesNeedShift ? assignmentsBetween(candidateIds, day(input.from), day(input.to)) : Promise.resolve([]),
    timesNeedShift ? loadShiftOverrides(candidateIds, input.from, input.to) : Promise.resolve(new Map()),
    earliestAllowedDate(settings),
  ]);
  const rowOf = new Map(rows.map((r) => [overrideKey(r.employeeId, iso(r.date)), r]));
  const pending = new Set(pendingRows.map((r) => overrideKey(r.employeeId, iso(r.date))));
  const ctxBase = { today: iso(businessToday()), earliest };

  const eligible: Array<{ employeeId: string; date: string }> = [];
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
      let problem = overrideDayProblem(row, date, { ...ctxBase, pending: pending.has(key) }, input, input.releaseLeave);
      if (!problem && row && timesNeedShift && ((input.inTime && input.outTime) || (!row.overrideKind && row.source !== "LEAVE"))) {
        const a = assignments.filter((x) => x.employeeId === employeeId).find((x) => rowInForce(x, day(date)));
        const so = shiftOverrides.get(key);
        const shift: ShiftDef | null = so ? shiftDefOf(so.shift) : a ? shiftDef(a) : null;
        problem = correctionProblem(input, row, date, shift, a?.policy.nearDuplicateSeconds ?? 120);
      }
      if (problem) problems.set(problem.code, [...(problems.get(problem.code) ?? []), { employeeId, date }]);
      else eligible.push({ employeeId, date });
    }
  }
  if (eligible.length > settings.bulkMaxEmployeeDays) {
    throw new HttpError(400, `That is ${eligible.length} employee-days; an override covers at most ${settings.bulkMaxEmployeeDays} at once. Narrow it and do it in parts.`, "TOO_MANY");
  }

  // Leave to release, per eligible day (only when the option is on and the day has leave on it).
  const coversOf = new Map<string, LeaveCover[]>();
  if (input.releaseLeave) {
    for (const e of eligible) {
      const row = rowOf.get(overrideKey(e.employeeId, e.date));
      if (row?.leaveTypeCode) {
        const covers = await leaveCoverOn(prisma, e.employeeId, e.date);
        if (covers.length) coversOf.set(overrideKey(e.employeeId, e.date), covers);
      }
    }
  }

  // What each day would become: a dry run of the engine with the override in place (and the leave released).
  const shape = input.followDevice ? { kind: "RELEASE_ONLY" as const, inTime: null, outTime: null, status: null } : overrideShape(input);
  const hypothetical = new Map<string, DayOverride>();
  for (const e of eligible) {
    hypothetical.set(
      overrideKey(e.employeeId, e.date),
      shape.kind === "RELEASE_ONLY"
        ? { kind: "RELEASE_ONLY", id: "preview", origin: "MANUAL_OVERRIDE" }
        : shape.kind === "STATUS"
        ? { kind: "STATUS", id: "preview", origin: "MANUAL_OVERRIDE", status: shape.status as "P" | "A" | "HD_FIRST" | "HD_SECOND" | "WORKED" }
        : shape.kind === "TIMES"
          ? { kind: "TIMES", id: "preview", origin: "MANUAL_OVERRIDE", inTime: shape.inTime!, outTime: shape.outTime! }
          : { kind: "ADD_TIME", id: "preview", origin: "MANUAL_OVERRIDE", time: (shape.inTime ?? shape.outTime)! },
    );
  }
  const hypotheticalReleased = new Set(coversOf.keys());
  const after = new Map<string, string | null>();
  const withDays = [...new Set(eligible.map((e) => e.employeeId))];
  for (let i = 0; i < withDays.length; i += CHUNK) {
    const r = await computeAttendance(withDays.slice(i, i + CHUNK), input.from, input.to, { dryRun: true, collect: true, hypothetical, hypotheticalReleased });
    for (const ev of r.evaluated ?? []) after.set(overrideKey(ev.employeeId, ev.date), ev.after);
  }
  const planned: PlanRow[] = eligible
    .map((e) => {
      const key = overrideKey(e.employeeId, e.date);
      const row = rowOf.get(key);
      return { ...e, before: row?.status ?? null, after: after.get(key) ?? null, replaces: row?.overrideKind ?? null, covers: coversOf.get(key) ?? [] };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.employeeId.localeCompare(b.employeeId));

  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ k: planned.map((p) => `${p.employeeId}|${p.date}|${p.covers.map((c) => `${c.requestId}:${c.part}`).join(",")}`).sort(), c: shape, r: input.reasonCode, l: input.releaseLeave, f: input.from, t: input.to }))
    .digest("hex");
  return { planned, problems, ownLeftOut, fingerprint, settings, shape };
}

export async function previewOverride(viewer: Viewer, input: OverrideInput) {
  const p = await plan(viewer, input);
  const ids = [...new Set([...p.planned.map((x) => x.employeeId), ...[...p.problems.values()].flat().map((x) => x.employeeId)])];
  const [names, people] = await Promise.all([namesOn(ids, day(input.to)), prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, employeeCode: true } })]);
  const code = new Map(people.map((x) => [x.id, x.employeeCode]));
  const who = (id: string) => ({ employeeId: id, employeeCode: code.get(id) ?? "", name: names.get(id) ?? code.get(id) ?? id });
  const leaveDays = p.planned.reduce((n, x) => n + x.covers.reduce((m, c) => m + c.days, 0), 0);
  return {
    count: p.planned.length,
    employees: new Set(p.planned.map((x) => x.employeeId)).size,
    correction: input.followDevice ? FOLLOW_DEVICE_TEXT : describeCorrection(input),
    ownLeftOut: p.ownLeftOut,
    fingerprint: p.fingerprint,
    caps: { maxRangeDays: p.settings.bulkMaxRangeDays, maxEmployeeDays: p.settings.bulkMaxEmployeeDays },
    /** Days of approved leave this would release, and so return to balances. */
    leaveDaysReleased: leaveDays,
    rows: p.planned.map((x) => ({
      ...who(x.employeeId),
      date: x.date,
      before: x.before,
      after: x.after,
      replaces: x.replaces,
      leave: x.covers.map((c) => ({ type: c.leaveTypeCode, days: c.days })),
    })),
    cannotOverride: [...p.problems].map(([codeKey, list]) => ({
      code: codeKey,
      label: OVERRIDE_PROBLEM_LABEL[codeKey] ?? codeKey,
      count: list.length,
      examples: list.slice(0, 5).map((x) => ({ ...who(x.employeeId), date: x.date })),
    })),
  };
}

export async function confirmOverride(viewer: Viewer, input: OverrideInput & { fingerprint: string }, meta: Meta) {
  const p = await plan(viewer, input);
  if (p.planned.length === 0) throw new HttpError(409, "Nothing in that selection can be overridden any more. Review it again.", "SELECTION_CHANGED");
  if (p.fingerprint !== input.fingerprint) {
    throw new HttpError(409, "The set changed since you looked at it (a request was raised, a day was finalised, leave was cancelled or punches arrived). Review it again before confirming.", "SELECTION_CHANGED");
  }
  const text = input.followDevice ? FOLLOW_DEVICE_TEXT : describeCorrection(input);
  const rows = p.planned.map((x) => ({ ...x, overrideId: randomUUID() }));
  const releasedFor = new Map<string, Array<{ employeeId: string; date: string; leaveType: string; part: string; daysReturned: number }>>();
  await prisma.$transaction(
    async (tx) => {
      // The leave module's own rule: whoever writes an employee's ledger holds that employee's row lock.
      const leaveEmployees = [...new Set(rows.filter((r) => r.covers.length).map((r) => r.employeeId))].sort();
      if (leaveEmployees.length) await tx.$queryRaw`SELECT id FROM employees WHERE id IN (${Prisma.join(leaveEmployees)}) ORDER BY id FOR UPDATE`;

      await tx.attendanceOverride.createMany({
        data: rows.map((r) => ({
          id: r.overrideId,
          employeeId: r.employeeId,
          date: day(r.date),
          origin: "MANUAL_OVERRIDE" as const,
          kind: p.shape.kind,
          inTime: p.shape.inTime,
          outTime: p.shape.outTime,
          status: p.shape.status,
          reasonCode: input.reasonCode,
          reason: input.note,
          createdByUserId: viewer.userId,
        })),
      });
      const leaveAudit = [];
      for (const r of rows) {
        if (!r.covers.length) continue;
        const now = await leaveCoverOn(tx, r.employeeId, r.date);
        if (now.map((c) => `${c.requestId}:${c.part}`).sort().join() !== r.covers.map((c) => `${c.requestId}:${c.part}`).sort().join()) {
          throw new HttpError(409, "Leave on one of these days changed while you were confirming. Nothing was changed; review the set again.", "SELECTION_CHANGED");
        }
        const released = await releaseLeaveOnDay(tx, { employeeId: r.employeeId, date: r.date, overrideId: r.overrideId, reason: input.note, actorUserId: viewer.userId, covers: now });
        releasedFor.set(r.employeeId, [...(releasedFor.get(r.employeeId) ?? []), ...released.map((x) => ({ employeeId: r.employeeId, date: r.date, leaveType: x.leaveTypeCode, part: x.part, daysReturned: x.daysReturned }))]);
        for (const x of released) {
          leaveAudit.push({ ...meta, action: "leave.day_released", entityType: "LeaveDayRelease", entityId: x.releaseId, after: { employeeId: r.employeeId, date: r.date, leaveRequestId: x.requestId, leaveType: x.leaveTypeCode, part: x.part, daysReturned: x.daysReturned, overrideId: r.overrideId, reason: input.note } });
        }
      }
      // One audit row per employee-day, committed with the change it describes.
      await writeAuditLogs(
        [
          ...rows.map((r) => ({
            ...meta,
            action: "attendance.override.manual",
            entityType: "AttendanceOverride",
            entityId: r.overrideId,
            after: { employeeId: r.employeeId, date: r.date, correction: text, reasonCode: input.reasonCode, note: input.note, dayBefore: r.before, dayAfter: r.after, replaced: r.replaces, leaveReleased: r.covers.map((c) => `${c.leaveTypeCode} ${c.days}`) },
          })),
          ...leaveAudit,
        ],
        tx,
      );
    },
    { timeout: 120_000, maxWait: 20_000 },
  );

  // The override joins its days: one recompute per employee over their span; the employee is told, and a changed balance is pushed live.
  const span = new Map<string, { from: string; to: string; days: number }>();
  for (const r of rows) {
    const s = span.get(r.employeeId);
    span.set(r.employeeId, { from: s && s.from < r.date ? s.from : r.date, to: s && s.to > r.date ? s.to : r.date, days: (s?.days ?? 0) + 1 });
  }
  for (const [employeeId, s] of span) {
    await computeAttendance([employeeId], s.from, s.to);
    const returned = (releasedFor.get(employeeId) ?? []).reduce((n, x) => n + x.daysReturned, 0);
    await notifyEmployee(employeeId, {
      type: "attendance.overridden",
      title: s.days === 1 ? "HR updated your attendance" : `HR updated your attendance for ${s.days} days`,
      body: `${text}${s.days === 1 ? ` on ${s.from}` : ` (${s.from} to ${s.to})`}. ${input.note}${returned > 0 ? ` Your leave balance got ${returned} day${returned === 1 ? "" : "s"} back.` : ""}`,
      link: `/app/attendance/info?date=${s.from}`,
      payload: { reasonCode: input.reasonCode },
    });
    if (returned > 0) emitLeaveBalanceChanged(employeeId);
  }
  return {
    days: rows.length,
    employees: span.size,
    ownLeftOut: p.ownLeftOut,
    leaveDaysReleased: [...releasedFor.values()].flat().reduce((n, x) => n + x.daysReturned, 0),
    reason: REASON_LABEL[input.reasonCode],
  };
}

// ── Clear an override ─────────────────────────────────────────────────────

/** Take a day back to what the device recorded. Refused when a leave release stands: that cannot be undone from here. */
export async function clearOverride(viewer: Viewer, input: { employeeId: string; date: string; note: string }, meta: Meta) {
  requireHr(viewer);
  if (input.employeeId === viewer.employeeId) throw new HttpError(403, "You can't change your own attendance. Another administrator does it.", "OWN_ATTENDANCE");
  const [row, released, pending, earliest] = await Promise.all([
    prisma.dailyAttendance.findUnique({ where: { employeeId_date: { employeeId: input.employeeId, date: day(input.date) } } }),
    prisma.leaveDayRelease.count({ where: { employeeId: input.employeeId, date: day(input.date) } }),
    prisma.regularizationRequest.count({ where: { employeeId: input.employeeId, date: day(input.date), status: "PENDING" } }),
    getRegularizationSettings().then((s) => earliestAllowedDate(s)),
  ]);
  if (!row?.overrideKind) throw new HttpError(409, "This day carries no override or correction.", "NOTHING_TO_CLEAR");
  if (row.isLocked) throw new HttpError(409, "This day's attendance is finalised.", "LOCKED");
  if (input.date < earliest) throw new HttpError(409, "Overrides reach back to the start of the previous attendance cycle only.", "TOO_OLD");
  if (released > 0) {
    throw new HttpError(409, "Leave was released on this day and its days went back to the balance, so the override can't simply be removed. If it was a mistake, apply the leave again from Employee Leave; you can still change the day with a new override.", "RELEASE_STANDS");
  }
  if (pending > 0) throw new HttpError(409, "A correction request is waiting for this day: decide it first.", "PENDING_EXISTS");
  const created = await prisma.$transaction(async (tx) => {
    const o = await tx.attendanceOverride.create({
      data: { employeeId: input.employeeId, date: day(input.date), origin: "MANUAL_OVERRIDE", kind: "CLEARED", reason: input.note, createdByUserId: viewer.userId },
    });
    await writeAuditLogs([{ ...meta, action: "attendance.override.cleared", entityType: "AttendanceOverride", entityId: o.id, after: { employeeId: input.employeeId, date: input.date, note: input.note, dayBefore: row.status, replaced: row.overrideKind } }], tx);
    return o;
  });
  await computeAttendance([input.employeeId], input.date, input.date);
  await notifyEmployee(input.employeeId, {
    type: "attendance.overridden",
    title: "HR updated your attendance",
    body: `The correction on ${input.date} was removed; the day follows the device again. ${input.note}`,
    link: `/app/attendance/info?date=${input.date}`,
    payload: {},
  });
  return { id: created.id };
}

// ── History ───────────────────────────────────────────────────────────────

export async function listOverrides(q: { employeeId?: string; from?: string; to?: string; page: number; pageSize: number }) {
  const where: Prisma.AttendanceOverrideWhereInput = {
    ...(q.employeeId ? { employeeId: q.employeeId } : {}),
    ...(q.from || q.to ? { date: { ...(q.from ? { gte: day(q.from) } : {}), ...(q.to ? { lte: day(q.to) } : {}) } } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.attendanceOverride.count({ where }),
    prisma.attendanceOverride.findMany({
      where,
      orderBy: { seq: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: { employee: { select: { employeeCode: true } }, releases: { select: { days: true, leaveType: { select: { code: true } } } } },
    }),
  ]);
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdByUserId))] } }, select: { id: true, employeeId: true } });
  const [empNames, byNames] = await Promise.all([namesOn([...new Set(rows.map((r) => r.employeeId))], businessToday()), namesOn(users.map((u) => u.employeeId), businessToday())]);
  const userEmp = new Map(users.map((u) => [u.id, u.employeeId]));
  // The newest row per employee-day is the one in force.
  const newest = new Map<string, number>();
  if (rows.length) {
    for (const r of await prisma.attendanceOverride.groupBy({ by: ["employeeId", "date"], where: { OR: rows.map((r) => ({ employeeId: r.employeeId, date: r.date })) }, _max: { seq: true } })) {
      newest.set(overrideKey(r.employeeId, iso(r.date)), r._max.seq ?? 0);
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
      origin: r.origin,
      kind: r.kind,
      what: r.kind === "CLEARED" ? "Removed (back to the device)" : r.kind === "RELEASE_ONLY" ? FOLLOW_DEVICE_TEXT : describeCorrection({ inTime: r.inTime, outTime: r.outTime, status: r.status as Correction["status"] }),
      reasonCode: r.reasonCode,
      reason: r.reason,
      by: byNames.get(userEmp.get(r.createdByUserId) ?? "") ?? "someone",
      at: r.createdAt.toISOString(),
      inForce: newest.get(overrideKey(r.employeeId, iso(r.date))) === r.seq && r.kind !== "CLEARED",
      leaveReleased: r.releases.map((x) => ({ type: x.leaveType.code, days: Number(x.days) })),
    })),
  };
}
