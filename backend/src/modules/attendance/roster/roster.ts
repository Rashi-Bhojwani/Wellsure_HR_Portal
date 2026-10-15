import { createHash } from "node:crypto";
import { writeAuditLogs } from "../../../lib/audit";
import { businessToday } from "../../../lib/businessDate";
import { assignmentHistories, cancelScheduledAssignment, maxScheduleAheadDays, namesOn, writeAssignmentChange } from "../../../lib/effectiveDating";
import { getRegularizationSettings } from "../../../lib/regularizationSettings";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { notifyEmployee } from "../../notifications/notifyEmployee";
import { resolveTargets, type Selection } from "../dayTargets";
import { addDays } from "../engine/time";
import type { Meta } from "../processService";
import type { Viewer } from "../manual/scope";
import { rotationSegments, type RotationStep, type Segment } from "./rotation";

// Shift Roster (Phase 3 commit 2, docs/plans/PHASE_3.md): assign a shift to many people from a date, or generate a
// rotation (a pattern of shifts over days, repeating). It writes through the same effective-dated writers as the single
// assignment change, so it is FORWARD ONLY: from tomorrow, up to the same horizon as a scheduled assignment change.
// Today and the past are corrected with Shift Override. Regenerating replaces the scheduled changes from the start date
// onward (cancel, latest first, then write) in one transaction, all or nothing, after a preview.

export interface RosterInput {
  selection: Selection;
  /** First day of the roster; tomorrow at the earliest. */
  start: string;
  steps: RotationStep[];
  repeat: boolean;
  until?: string | null;
  /** After the last day of a repeating rotation, go back to the shift they had before (default) or stay on the last one. */
  then: "RETURN" | "STAY";
  note: string;
}

export const MAX_SEGMENTS_PER_PERSON = 60;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);

export const ROSTER_PROBLEM_LABEL: Record<string, string> = {
  OWN_ATTENDANCE: "Your own roster (another administrator sets it)",
  HISTORY_CLOSED: "Has left: their history is closed",
  NO_ASSIGNMENT: "No attendance assignment yet (set one in Attendance Settings first)",
  TOO_MANY_CHANGES: `Would need more than ${MAX_SEGMENTS_PER_PERSON} shift changes`,
};

function requireManage(viewer: Viewer): void {
  if (!viewer.permissions.has("attendance.config.manage")) throw new HttpError(403, "Missing permission: attendance.config.manage", "FORBIDDEN");
}

async function plan(viewer: Viewer, input: RosterInput) {
  requireManage(viewer);
  const today = iso(businessToday());
  const ahead = await maxScheduleAheadDays();
  const horizon = addDays(today, ahead);
  if (input.start <= today) throw new HttpError(400, `A roster starts tomorrow at the earliest (${addDays(today, 1)}). Today and earlier days are corrected with Shift Override.`, "NOT_FORWARD");
  if (input.start > horizon) throw new HttpError(400, `A roster can be scheduled at most ${ahead} days ahead (until ${horizon}).`, "HISTORY_TOO_FAR_AHEAD");
  if (input.repeat) {
    if (!input.until) throw new HttpError(400, "A repeating rotation needs an end date.", "VALIDATION_ERROR");
    if (input.until < input.start) throw new HttpError(400, "The end date is before the start date.", "VALIDATION_ERROR");
    const last = input.then === "RETURN" ? addDays(horizon, -1) : horizon;
    if (input.until > last) throw new HttpError(400, `The rotation can run until ${last} at most${input.then === "RETURN" ? " (people return to their previous shift on the next day, which must also be within the scheduling limit)" : ""}.`, "HISTORY_TOO_FAR_AHEAD");
  }
  const shifts = await prisma.shift.findMany({ where: { id: { in: [...new Set(input.steps.map((s) => s.shiftId))] } }, select: { id: true, code: true, name: true, startTime: true, endTime: true, isActive: true } });
  if (shifts.length !== new Set(input.steps.map((s) => s.shiftId)).size || shifts.some((s) => !s.isActive)) throw new HttpError(400, "Choose active shifts.", "VALIDATION_ERROR");
  const shiftOf = new Map(shifts.map((s) => [s.id, s]));

  const { candidateIds, targeted } = await resolveTargets(input.selection, input.start, input.start);
  const settings = await getRegularizationSettings();
  const people = candidateIds.filter((id) => targeted(id, input.start));
  if (people.length > settings.bulkMaxEmployeeDays) {
    throw new HttpError(400, `That is ${people.length} people; a roster covers at most ${settings.bulkMaxEmployeeDays} at once. Narrow it and do it in parts.`, "TOO_MANY");
  }
  const histories = await assignmentHistories(people);
  const segmentsRaw = rotationSegments({ start: input.start, steps: input.steps, repeat: input.repeat, until: input.until });

  const ok: Array<{ employeeId: string; segments: Segment[]; replaces: Array<{ id: string; from: string; shift: string }>; baseShiftId: string; baseShiftCode: string }> = [];
  const problems = new Map<string, string[]>();
  for (const employeeId of people) {
    const rows = histories.filter((h) => h.employeeId === employeeId);
    const problem =
      employeeId === viewer.employeeId ? "OWN_ATTENDANCE"
      : rows.length === 0 ? "NO_ASSIGNMENT"
      : rows.at(-1)!.effectiveTo !== null ? "HISTORY_CLOSED"
      : null;
    if (problem) {
      problems.set(problem, [...(problems.get(problem) ?? []), employeeId]);
      continue;
    }
    const kept = rows.filter((r) => iso(r.effectiveFrom) < input.start);
    const replaces = rows.filter((r) => iso(r.effectiveFrom) >= input.start);
    const base = kept.at(-1);
    if (!base) {
      problems.set("NO_ASSIGNMENT", [...(problems.get("NO_ASSIGNMENT") ?? []), employeeId]);
      continue;
    }
    const segments = [...segmentsRaw];
    if (input.repeat && input.then === "RETURN") segments.push({ from: addDays(input.until!, 1), shiftId: base.shiftId });
    if (segments.length > MAX_SEGMENTS_PER_PERSON) {
      problems.set("TOO_MANY_CHANGES", [...(problems.get("TOO_MANY_CHANGES") ?? []), employeeId]);
      continue;
    }
    ok.push({ employeeId, segments, replaces: replaces.map((r) => ({ id: r.id, from: iso(r.effectiveFrom), shift: r.shift.code })), baseShiftId: base.shiftId, baseShiftCode: base.shift.code });
  }
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ p: ok.map((o) => [o.employeeId, o.segments, o.replaces.map((r) => r.id)]).sort(), s: input.start, u: input.until ?? null, t: input.then, r: input.repeat }))
    .digest("hex");
  return { ok, problems, fingerprint, shiftOf, horizon, settings };
}

export async function previewRoster(viewer: Viewer, input: RosterInput) {
  const p = await plan(viewer, input);
  const ids = [...new Set([...p.ok.map((x) => x.employeeId), ...[...p.problems.values()].flat()])];
  const [names, people] = await Promise.all([namesOn(ids, day(input.start)), prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, employeeCode: true } })]);
  const code = new Map(people.map((x) => [x.id, x.employeeCode]));
  const who = (id: string) => ({ employeeId: id, employeeCode: code.get(id) ?? "", name: names.get(id) ?? code.get(id) ?? id });
  return {
    people: p.ok.length,
    changes: p.ok.reduce((n, x) => n + x.segments.length, 0),
    replacedScheduled: p.ok.reduce((n, x) => n + x.replaces.length, 0),
    start: input.start,
    until: input.repeat ? input.until : null,
    then: input.repeat ? input.then : null,
    horizon: p.horizon,
    fingerprint: p.fingerprint,
    rows: p.ok.map((x) => ({
      ...who(x.employeeId),
      currentShift: x.baseShiftCode,
      segments: x.segments.map((s) => ({ from: s.from, shift: p.shiftOf.get(s.shiftId)?.code ?? "(their previous shift)" })),
      replaces: x.replaces.map((r) => ({ from: r.from, shift: r.shift })),
    })),
    cannotRoster: [...p.problems].map(([codeKey, list]) => ({ code: codeKey, label: ROSTER_PROBLEM_LABEL[codeKey] ?? codeKey, count: list.length, examples: list.slice(0, 5).map(who) })),
  };
}

export async function confirmRoster(viewer: Viewer, input: RosterInput & { fingerprint: string }, meta: Meta) {
  const p = await plan(viewer, input);
  if (p.ok.length === 0) throw new HttpError(409, "Nobody in that selection can be rostered any more. Review it again.", "SELECTION_CHANGED");
  if (p.fingerprint !== input.fingerprint) throw new HttpError(409, "The set changed since you looked at it (someone's schedule changed). Review it again before confirming.", "SELECTION_CHANGED");
  const codes = new Map((await prisma.employee.findMany({ where: { id: { in: p.ok.map((o) => o.employeeId) } }, select: { id: true, employeeCode: true } })).map((e) => [e.id, e.employeeCode]));
  await prisma.$transaction(
    async (tx) => {
      for (const o of p.ok) {
        try {
          // Replace what was scheduled from the start date: latest first, then write the new segments in order.
          for (const r of [...o.replaces].sort((a, b) => b.from.localeCompare(a.from))) await cancelScheduledAssignment(tx, o.employeeId, r.id);
          for (const s of o.segments) await writeAssignmentChange(tx, o.employeeId, day(s.from), { shiftId: s.shiftId }, { createdByUserId: viewer.userId, changeReason: input.note });
        } catch (err) {
          if (err instanceof HttpError) throw new HttpError(err.status, `${codes.get(o.employeeId)}: ${err.message} Nothing was changed.`, err.code);
          throw err;
        }
      }
      await writeAuditLogs(
        p.ok.map((o) => ({
          ...meta,
          action: "attendance.roster.generated",
          entityType: "Employee",
          entityId: o.employeeId,
          before: { replacedScheduled: o.replaces },
          after: { start: input.start, until: input.until ?? null, then: input.repeat ? input.then : null, note: input.note, segments: o.segments.map((s) => ({ from: s.from, shift: p.shiftOf.get(s.shiftId)?.code ?? "previous shift" })) },
        })),
        tx,
      );
    },
    { timeout: 120_000, maxWait: 20_000 },
  );
  for (const o of p.ok) {
    await notifyEmployee(o.employeeId, {
      type: "attendance.roster_changed",
      title: "Your shift roster changed",
      body: `From ${input.start}: ${o.segments.slice(0, 3).map((s) => `${s.from} ${p.shiftOf.get(s.shiftId)?.code ?? "previous shift"}`).join(", ")}${o.segments.length > 3 ? ", …" : ""}. ${input.note}`,
      link: "/app/attendance/info",
      payload: {},
    });
  }
  return { people: p.ok.length, changes: p.ok.reduce((n, x) => n + x.segments.length, 0), replacedScheduled: p.ok.reduce((n, x) => n + x.replaces.length, 0) };
}
