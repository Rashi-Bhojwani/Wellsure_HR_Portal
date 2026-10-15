import { createHash, randomUUID } from "node:crypto";
import { Prisma, type RegularizationReasonCode } from "@prisma/client";
import { writeAuditLogs } from "../../../lib/audit";
import { businessToday } from "../../../lib/businessDate";
import { assignmentsBetween, namesOn, rowInForce } from "../../../lib/effectiveDating";
import { getRegularizationSettings } from "../../../lib/regularizationSettings";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { notifyEmployee } from "../../notifications/notifyEmployee";
import { computeAttendance, shiftDef } from "../compute";
import { addDays } from "../engine/time";
import type { DayOverride } from "../engine/types";
import { resolveTargets, spanDays } from "../dayTargets";
import type { Viewer } from "../manual/scope";
import { overrideKey } from "../overrides";
import type { Meta } from "../processService";
import { correctionProblem, dayProblem, describeCorrection, overrideShape, PROBLEM_LABEL, type Correction } from "./correction";
import { earliestAllowedDate } from "./service";

// Bulk correction by HR (Phase 3 commit 1, docs/plans/PHASE_3.md): typically a whole branch after a device outage.
// HR picks a date range and employees, one reason code and one correction, and either raises the requests (they wait
// for an approver) or raises and approves them in one action. It follows the bulk-accept pattern for flagged punches:
// a PREVIEW shows exactly which employee-days change and from what to what, and what cannot be corrected and why; the
// CONFIRMATION applies only to the previewed set (a fingerprint of it), with a reason; one audit row per employee-day,
// in the same transaction as the change; and caps from System Settings so a mistake cannot rewrite a quarter.
// Raw punches are never altered. HR's own days are left out: nobody corrects their own attendance.

export interface BulkInput extends Correction {
  selection: { employeeIds?: string[]; locationId?: string; departmentId?: string };
  from: string;
  to: string;
  reasonCode: RegularizationReasonCode;
  note: string;
  action: "RAISE" | "RAISE_AND_APPROVE";
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const CHUNK = 50;

interface PlanRow {
  employeeId: string;
  date: string;
  before: string | null;
  after: string | null;
}

async function plan(viewer: Viewer, input: BulkInput) {
  if (viewer.dataScope !== "ALL") throw new HttpError(403, "Bulk corrections are for HR, across the whole company.", "FORBIDDEN");
  if (input.action === "RAISE_AND_APPROVE" && !viewer.permissions.has("attendance.regularization.approve")) {
    throw new HttpError(403, "Raising and approving in one action needs the permission to approve corrections.", "FORBIDDEN");
  }
  const settings = await getRegularizationSettings();
  const span = spanDays(input.from, input.to);
  if (span > settings.bulkMaxRangeDays) {
    throw new HttpError(400, `A bulk correction covers at most ${settings.bulkMaxRangeDays} days at a time (this is ${span}). Narrow the dates and do it in parts.`, "TOO_WIDE");
  }

  // Who: a list, or everyone placed at the branch/department on each day.
  const { candidateIds, targeted } = await resolveTargets(input.selection, input.from, input.to);
  const [rows, pendingRows, approvedRows, assignments, earliest] = await Promise.all([
    prisma.dailyAttendance.findMany({ where: { employeeId: { in: candidateIds }, date: { gte: day(input.from), lte: day(input.to) } } }),
    prisma.regularizationRequest.findMany({ where: { employeeId: { in: candidateIds }, date: { gte: day(input.from), lte: day(input.to) }, status: "PENDING" }, select: { employeeId: true, date: true } }),
    prisma.regularizationRequest.findMany({ where: { employeeId: { in: candidateIds }, date: { gte: day(input.from), lte: day(input.to) }, status: "APPROVED" }, select: { employeeId: true, date: true } }),
    input.status ? Promise.resolve([]) : assignmentsBetween(candidateIds, day(input.from), day(input.to)),
    earliestAllowedDate(settings),
  ]);
  const rowOf = new Map(rows.map((r) => [overrideKey(r.employeeId, iso(r.date)), r]));
  const pending = new Set(pendingRows.map((r) => overrideKey(r.employeeId, iso(r.date))));
  const approved = new Set(approvedRows.map((r) => overrideKey(r.employeeId, iso(r.date))));
  const ctxBase = { today: iso(businessToday()), earliest };

  const eligible: Array<{ employeeId: string; date: string }> = [];
  const problems = new Map<string, Array<{ employeeId: string; date: string }>>();
  let ownLeftOut = 0;
  for (const employeeId of candidateIds) {
    for (let date = input.from; date <= input.to; date = addDays(date, 1)) {
      if (!targeted(employeeId, date)) continue; // not there that day: nothing to correct, nothing to report
      const key = overrideKey(employeeId, date);
      const row = rowOf.get(key); // none yet: reported below as "not processed yet", never skipped silently
      if (employeeId === viewer.employeeId) {
        ownLeftOut += 1;
        continue;
      }
      let problem = dayProblem(row, date, { ...ctxBase, pending: pending.has(key), corrected: approved.has(key) });
      if (!problem && row) {
        const a = assignments.filter((x) => x.employeeId === employeeId).find((x) => rowInForce(x, day(date)));
        problem = correctionProblem(input, row, date, a ? shiftDef(a) : null, a?.policy.nearDuplicateSeconds ?? 120);
      }
      if (problem) problems.set(problem.code, [...(problems.get(problem.code) ?? []), { employeeId, date }]);
      else eligible.push({ employeeId, date });
    }
  }
  if (eligible.length > settings.bulkMaxEmployeeDays) {
    throw new HttpError(400, `That is ${eligible.length} employee-days; a bulk correction covers at most ${settings.bulkMaxEmployeeDays} at once. Narrow it and do it in parts.`, "TOO_MANY");
  }

  // What each day would become: a dry run of the engine with the correction in place.
  const shape = overrideShape(input);
  const hypothetical = new Map<string, DayOverride>();
  for (const e of eligible) {
    const k = overrideKey(e.employeeId, e.date);
    hypothetical.set(
      k,
      shape.kind === "STATUS"
        ? { kind: "STATUS", id: "preview", origin: "REGULARIZATION", status: shape.status as "P" | "A" | "HD_FIRST" | "HD_SECOND" }
        : shape.kind === "TIMES"
          ? { kind: "TIMES", id: "preview", origin: "REGULARIZATION", inTime: shape.inTime!, outTime: shape.outTime! }
          : { kind: "ADD_TIME", id: "preview", origin: "REGULARIZATION", time: (shape.inTime ?? shape.outTime)! },
    );
  }
  const after = new Map<string, string | null>();
  const employeesWithDays = [...new Set(eligible.map((e) => e.employeeId))];
  for (let i = 0; i < employeesWithDays.length; i += CHUNK) {
    const r = await computeAttendance(employeesWithDays.slice(i, i + CHUNK), input.from, input.to, { dryRun: true, collect: true, hypothetical });
    for (const ev of r.evaluated ?? []) after.set(overrideKey(ev.employeeId, ev.date), ev.after);
  }
  const planned: PlanRow[] = eligible
    .map((e) => ({ ...e, before: rowOf.get(overrideKey(e.employeeId, e.date))?.status ?? null, after: after.get(overrideKey(e.employeeId, e.date)) ?? null }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.employeeId.localeCompare(b.employeeId));

  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ k: planned.map((p) => `${p.employeeId}|${p.date}`).sort(), c: shape, r: input.reasonCode, a: input.action, f: input.from, t: input.to }))
    .digest("hex");
  return { planned, problems, ownLeftOut, fingerprint, settings, shape };
}

export async function previewBulk(viewer: Viewer, input: BulkInput) {
  const p = await plan(viewer, input);
  const ids = [...new Set([...p.planned.map((x) => x.employeeId), ...[...p.problems.values()].flat().map((x) => x.employeeId)])];
  const [names, people] = await Promise.all([namesOn(ids, day(input.to)), prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, employeeCode: true } })]);
  const code = new Map(people.map((x) => [x.id, x.employeeCode]));
  const who = (id: string) => ({ employeeId: id, employeeCode: code.get(id) ?? "", name: names.get(id) ?? code.get(id) ?? id });
  return {
    count: p.planned.length,
    employees: new Set(p.planned.map((x) => x.employeeId)).size,
    correction: describeCorrection(input),
    action: input.action,
    ownLeftOut: p.ownLeftOut,
    fingerprint: p.fingerprint,
    caps: { maxRangeDays: p.settings.bulkMaxRangeDays, maxEmployeeDays: p.settings.bulkMaxEmployeeDays },
    /** Every employee-day that would change, and from what to what. */
    rows: p.planned.map((x) => ({ ...who(x.employeeId), date: x.date, before: x.before, after: x.after })),
    /** What was left out and why, grouped by reason, with a few examples. */
    cannotCorrect: [...p.problems].map(([codeKey, list]) => ({
      code: codeKey,
      label: PROBLEM_LABEL[codeKey] ?? codeKey,
      count: list.length,
      examples: list.slice(0, 5).map((x) => ({ ...who(x.employeeId), date: x.date })),
    })),
  };
}

export async function confirmBulk(viewer: Viewer, input: BulkInput & { fingerprint: string }, meta: Meta) {
  const p = await plan(viewer, input);
  if (p.planned.length === 0) throw new HttpError(409, "Nothing in that selection can be corrected any more. Review it again.", "SELECTION_CHANGED");
  if (p.fingerprint !== input.fingerprint) {
    throw new HttpError(409, "The set changed since you looked at it (a request was raised, a day was finalised or punches arrived). Review it again before confirming.", "SELECTION_CHANGED");
  }
  const approve = input.action === "RAISE_AND_APPROVE";
  const text = describeCorrection(input);
  const batchId = randomUUID();
  const now = new Date();
  const requests = p.planned.map((x) => ({ ...x, id: randomUUID() }));
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.regularizationBatch.create({
          data: {
            id: batchId,
            createdByUserId: viewer.userId,
            action: approve ? "RAISED_AND_APPROVED" : "RAISED",
            reasonCode: input.reasonCode,
            note: input.note,
            fromDate: day(input.from),
            toDate: day(input.to),
            employeeCount: new Set(requests.map((r) => r.employeeId)).size,
            dayCount: requests.length,
          },
        });
        await tx.regularizationRequest.createMany({
          data: requests.map((r) => ({
            id: r.id,
            employeeId: r.employeeId,
            date: day(r.date),
            reasonCode: input.reasonCode,
            inTime: input.status ? null : (input.inTime ?? null),
            outTime: input.status ? null : (input.outTime ?? null),
            targetStatus: input.status ?? null,
            reason: input.note,
            status: approve ? ("APPROVED" as const) : ("PENDING" as const),
            raisedByUserId: viewer.userId,
            ...(approve ? { decidedByUserId: viewer.userId, decidedAt: now, decisionNote: "Approved with the bulk correction" } : {}),
            batchId,
          })),
        });
        if (approve) {
          await tx.attendanceOverride.createMany({
            data: requests.map((r) => ({
              id: randomUUID(),
              employeeId: r.employeeId,
              date: day(r.date),
              origin: "REGULARIZATION" as const,
              kind: p.shape.kind,
              inTime: p.shape.inTime,
              outTime: p.shape.outTime,
              status: p.shape.status,
              reasonCode: input.reasonCode,
              reason: input.note,
              requestId: r.id,
              createdByUserId: viewer.userId,
            })),
          });
        }
        // One audit row per employee-day, committed with the change it describes.
        await writeAuditLogs(
          requests.map((r) => ({
            ...meta,
            action: approve ? "attendance.regularization.bulk_raised_and_approved" : "attendance.regularization.bulk_raised",
            entityType: "RegularizationRequest",
            entityId: r.id,
            after: { employeeId: r.employeeId, date: r.date, batchId, batchSize: requests.length, reasonCode: input.reasonCode, correction: text, note: input.note, dayBefore: r.before, dayAfter: r.after },
          })),
          tx,
        );
      },
      { timeout: 120_000, maxWait: 20_000 },
    );
  } catch (err) {
    // The one-pending / one-approved indexes: someone raised or decided one of these between our read and the write.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new HttpError(409, "A request for one of these days was raised while you were confirming. Nothing was changed; review the set again.", "SELECTION_CHANGED");
    }
    throw err;
  }
  if (approve) {
    // The corrections join their days: one recompute per employee over their span.
    const span = new Map<string, { from: string; to: string; days: number }>();
    for (const r of requests) {
      const s = span.get(r.employeeId);
      span.set(r.employeeId, { from: s && s.from < r.date ? s.from : r.date, to: s && s.to > r.date ? s.to : r.date, days: (s?.days ?? 0) + 1 });
    }
    for (const [employeeId, s] of span) {
      await computeAttendance([employeeId], s.from, s.to);
      await notifyEmployee(employeeId, {
        type: "regularization.decided",
        title: s.days === 1 ? "Your attendance was corrected" : `Your attendance was corrected for ${s.days} days`,
        body: `${text}${s.days === 1 ? ` on ${s.from}` : ` (${s.from} to ${s.to})`}. ${input.note}`,
        link: `/app/attendance/info?date=${s.from}`,
        payload: { batchId },
      });
    }
  }
  return { batchId, requests: requests.length, employees: new Set(requests.map((r) => r.employeeId)).size, approved: approve, ownLeftOut: p.ownLeftOut };
}
