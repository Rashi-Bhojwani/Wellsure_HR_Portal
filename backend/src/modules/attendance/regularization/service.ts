import type { Prisma, RegularizationReasonCode, RegularizationStatus } from "@prisma/client";
import { instantToLocalTime } from "@shared/attendance/attlog";
import { cycleFor } from "../../../lib/attendanceCycle";
import { writeAuditLog } from "../../../lib/audit";
import { businessToday } from "../../../lib/businessDate";
import { getTeamEmployeeIds } from "../../../lib/dataScope";
import { assignmentOn, namesOn, placementsOn } from "../../../lib/effectiveDating";
import { resolveAccess } from "../../../lib/permissions";
import { getRegularizationSettings, type RegularizationSettings } from "../../../lib/regularizationSettings";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { emitRegularizationDecided, emitRegularizationSubmitted } from "../../../realtime/emit";
import { notifyEmployee } from "../../notifications/notifyEmployee";
import { computeAttendance, shiftDef } from "../compute";
import { addDays } from "../engine/time";
import { appendOverrides } from "../overrides";
import type { Viewer } from "../manual/scope";
import type { Meta } from "../processService";
import { correctionProblem, dayProblem, describeCorrection, overrideShape, REASON_LABEL, type Correction } from "./correction";

type ReasonCode = RegularizationReasonCode;

// Regularization (Phase 2 P2-E began it as the forgot-to-punch request; Phase 3 commit 1
// generalises it — docs/plans/PHASE_3.md). An employee asks for a correction to a day of
// their own: a reason code, a note, and corrected times or a status. Their manager (by
// grant) or HR decides, never their own. Approval appends an attendance_overrides row (the
// raw punches are never altered) and recomputes the day.

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const TZ = "Asia/Kolkata";

export type Eligibility =
  | {
      ok: true;
      /** What the day has now, so the form can offer the right choices (both times on a day with no punches). */
      day: { status: string; punchCount: number; firstIn: string | null; lastOut: string | null; shift: string | null };
      /** The oldest date a correction reaches, and the settings that decided it. */
      earliest: string;
    }
  | { ok: false; reason: string; code: string };

/** The oldest date a correction may reach: the start of the attendance cycle `backdateCycles` before the current one. */
export async function earliestAllowedDate(settings: RegularizationSettings, today: Date = businessToday()): Promise<string> {
  let cycle = await cycleFor(today);
  for (let i = 0; i < settings.backdateCycles; i += 1) cycle = await cycleFor(day(addDays(iso(cycle.start), -1)));
  return iso(cycle.start);
}

/** Whether this employee may raise a correction for this day, and what the day has. */
export async function requestEligibility(employeeId: string, date: string): Promise<Eligibility> {
  const settings = await getRegularizationSettings();
  const today = iso(businessToday());
  const [row, pending, earliest] = await Promise.all([
    prisma.dailyAttendance.findUnique({ where: { employeeId_date: { employeeId, date: day(date) } } }),
    prisma.regularizationRequest.count({ where: { employeeId, date: day(date), status: "PENDING" } }),
    earliestAllowedDate(settings),
  ]);
  const approved = await prisma.regularizationRequest.count({ where: { employeeId, date: day(date), status: "APPROVED" } });
  const problem = dayProblem(row, date, { today, earliest, pending: pending > 0, corrected: approved > 0 });
  if (problem) return { ok: false, reason: problem.message, code: problem.code };
  const r = row!;
  return { ok: true, earliest, day: { status: r.status, punchCount: r.punchCount, firstIn: r.firstIn ? instantToLocalTime(r.firstIn, TZ).slice(11, 16) : null, lastOut: r.lastOut ? instantToLocalTime(r.lastOut, TZ).slice(11, 16) : null, shift: r.shiftCode ? `${r.shiftCode} ${r.shiftStart}–${r.shiftEnd}` : null } };
}

export interface RaiseInput extends Correction {
  date: string;
  reasonCode: ReasonCode;
  note?: string | null;
}

export async function raiseRequest(viewer: Viewer, input: RaiseInput, meta: Meta) {
  const employeeId = viewer.employeeId;
  const eligible = await requestEligibility(employeeId, input.date);
  if (!eligible.ok) throw new HttpError(409, eligible.reason, "NOT_ELIGIBLE");
  const row = await prisma.dailyAttendance.findUniqueOrThrow({ where: { employeeId_date: { employeeId, date: day(input.date) } } });
  const assignment = await assignmentOn(employeeId, day(input.date));
  const misfit = correctionProblem(input, row, input.date, assignment ? shiftDef(assignment) : null, assignment?.policy.nearDuplicateSeconds ?? 120);
  if (misfit) throw new HttpError(400, misfit.message, "VALIDATION_ERROR");
  let request;
  try {
    request = await prisma.regularizationRequest.create({
      data: {
        employeeId,
        date: day(input.date),
        reasonCode: input.reasonCode,
        inTime: input.status ? null : (input.inTime ?? null),
        outTime: input.status ? null : (input.outTime ?? null),
        targetStatus: input.status ?? null,
        reason: input.note?.trim() ?? "",
        raisedByUserId: viewer.userId,
      },
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") throw new HttpError(409, "There's already a request waiting for this day.", "NOT_ELIGIBLE");
    throw err;
  }
  const asked = describeCorrection(input);
  await writeAuditLog({ ...meta, action: "attendance.regularization.raised", entityType: "RegularizationRequest", entityId: request.id, after: { employeeId, date: input.date, reasonCode: input.reasonCode, correction: asked, note: request.reason } });

  // The reporting manager hears about it if they can decide it; HR sees every pending request in its queue.
  const placement = (await placementsOn([employeeId], businessToday())).get(employeeId);
  const managerId = placement?.reportingManagerId ?? null;
  if (managerId) {
    const managerUser = await prisma.user.findUnique({ where: { employeeId: managerId }, select: { id: true, status: true } });
    if (managerUser?.status === "ACTIVE" && (await resolveAccess(managerUser.id)).permissions.has("attendance.regularization.approve")) {
      const name = (await namesOn([employeeId], businessToday())).get(employeeId) ?? "Someone";
      await notifyEmployee(managerId, {
        type: "regularization.submitted",
        title: `${name} asks for a correction: ${REASON_LABEL[input.reasonCode]}`,
        body: `${input.date}: ${asked}.${request.reason ? ` "${request.reason}"` : ""}`,
        link: "/app/todo/review?tab=attendance",
        payload: { requestId: request.id },
      });
    }
  }
  emitRegularizationSubmitted({ id: request.id, employeeId }, managerId);
  return request;
}

export async function cancelRequest(viewer: Viewer, id: string, meta: Meta) {
  const r = await prisma.regularizationRequest.findUnique({ where: { id } });
  if (!r || r.employeeId !== viewer.employeeId) throw new HttpError(404, "Request not found.", "NOT_FOUND");
  if (r.status !== "PENDING") throw new HttpError(409, "Only a request that's still waiting can be cancelled.", "NOT_PENDING");
  const updated = await prisma.regularizationRequest.update({ where: { id }, data: { status: "CANCELLED" } });
  await writeAuditLog({ ...meta, action: "attendance.regularization.cancelled", entityType: "RegularizationRequest", entityId: id, before: { status: "PENDING" }, after: { status: "CANCELLED" } });
  emitRegularizationDecided({ id, employeeId: r.employeeId, status: "CANCELLED" }, null);
  return updated;
}

/** A request as the screens show it: the correction in words and the reason code's label alongside the raw fields. */
export function presentRequest<T extends { reasonCode: string; inTime: string | null; outTime: string | null; targetStatus: string | null }>(r: T) {
  return { ...r, reasonLabel: REASON_LABEL[r.reasonCode] ?? r.reasonCode, correctionText: describeCorrection({ inTime: r.inTime, outTime: r.outTime, status: r.targetStatus as Correction["status"] }) };
}

export async function myRequests(employeeId: string) {
  return (await prisma.regularizationRequest.findMany({ where: { employeeId }, orderBy: { createdAt: "desc" }, take: 100 })).map(presentRequest);
}

// ── Deciding ─────────────────────────────────────────────────────────────

/** The employee ids whose requests this viewer may see (null: everyone), never their own. */
async function reach(viewer: Viewer): Promise<Prisma.StringFilter> {
  if (!viewer.permissions.has("attendance.regularization.view") && !viewer.permissions.has("attendance.regularization.approve")) {
    throw new HttpError(403, "You don't have access to regularization requests.", "FORBIDDEN");
  }
  if (viewer.dataScope === "ALL") return { not: viewer.employeeId };
  if (viewer.dataScope === "SELF") return { in: [] };
  return { in: (await getTeamEmployeeIds(viewer.employeeId)).filter((id) => id !== viewer.employeeId) };
}

export async function listQueue(viewer: Viewer, q: { status?: RegularizationStatus; reasonCode?: RegularizationReasonCode; from?: string; to?: string; batchId?: string }) {
  const employeeId = await reach(viewer);
  const rows = await prisma.regularizationRequest.findMany({
    where: {
      employeeId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.reasonCode ? { reasonCode: q.reasonCode } : {}),
      ...(q.batchId ? { batchId: q.batchId } : {}),
      ...(q.from || q.to ? { date: { ...(q.from ? { gte: day(q.from) } : {}), ...(q.to ? { lte: day(q.to) } : {}) } } : {}),
    },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    take: 300,
    include: { employee: { select: { employeeCode: true } } },
  });
  const ids = [...new Set(rows.map((r) => r.employeeId))];
  const [names, days, deciders] = await Promise.all([
    namesOn(ids, businessToday()),
    prisma.dailyAttendance.findMany({
      where: { OR: rows.map((r) => ({ employeeId: r.employeeId, date: r.date })) },
      select: { employeeId: true, date: true, status: true, firstIn: true, lastOut: true, punchCount: true, shiftCode: true, shiftStart: true, shiftEnd: true },
    }),
    prisma.user.findMany({ where: { id: { in: rows.map((r) => r.decidedByUserId).filter((x): x is string => !!x) } }, select: { id: true, employeeId: true } }),
  ]);
  const deciderNames = await namesOn(deciders.map((u) => u.employeeId), businessToday());
  const dayOf = new Map(days.map((d) => [`${d.employeeId}|${iso(d.date)}`, d]));
  const canDecide = viewer.permissions.has("attendance.regularization.approve");
  return rows.map((r) => {
    const d = dayOf.get(`${r.employeeId}|${iso(r.date)}`);
    const decider = deciders.find((u) => u.id === r.decidedByUserId);
    const p = presentRequest(r);
    return {
      id: r.id,
      employeeId: r.employeeId,
      employeeCode: r.employee.employeeCode,
      name: names.get(r.employeeId) ?? r.employee.employeeCode,
      date: iso(r.date),
      reasonCode: r.reasonCode,
      reasonLabel: p.reasonLabel,
      inTime: r.inTime,
      outTime: r.outTime,
      targetStatus: r.targetStatus,
      correctionText: p.correctionText,
      reason: r.reason,
      status: r.status,
      batchId: r.batchId,
      /** What the day shows now (before the correction is applied). */
      punches: d ? { count: d.punchCount, firstIn: d.firstIn ? instantToLocalTime(d.firstIn, TZ).slice(11, 16) : null, lastOut: d.lastOut ? instantToLocalTime(d.lastOut, TZ).slice(11, 16) : null } : null,
      dayStatus: d?.status ?? null,
      shift: d?.shiftCode ? `${d.shiftCode} ${d.shiftStart}–${d.shiftEnd}` : null,
      createdAt: r.createdAt.toISOString(),
      decidedBy: decider ? (deciderNames.get(decider.employeeId) ?? null) : null,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      decisionNote: r.decisionNote,
      canDecide: canDecide && r.status === "PENDING",
    };
  });
}

export async function decideRequest(viewer: Viewer, id: string, input: { approve: boolean; note?: string | null }, meta: Meta) {
  if (!viewer.permissions.has("attendance.regularization.approve")) throw new HttpError(403, "You can't decide regularization requests.", "FORBIDDEN");
  const r = await prisma.regularizationRequest.findUnique({ where: { id } });
  if (r && r.employeeId === viewer.employeeId) throw new HttpError(403, "You can't decide your own request.", "OWN_REQUEST");
  const scope = await reach(viewer);
  const inScope = r && (typeof scope.not === "string" ? r.employeeId !== scope.not : (scope.in ?? []).includes(r.employeeId));
  if (!r || !inScope) throw new HttpError(404, "Request not found.", "NOT_FOUND");
  if (r.status !== "PENDING") throw new HttpError(409, `This request is already ${r.status.toLowerCase()}.`, "NOT_PENDING");
  const date = iso(r.date);
  const correction: Correction = { inTime: r.inTime, outTime: r.outTime, status: r.targetStatus as Correction["status"] };
  if (input.approve) {
    // The day may have changed since it was asked for: finalised, put on leave, corrected another way, or its punches changed.
    const row = await prisma.dailyAttendance.findUnique({ where: { employeeId_date: { employeeId: r.employeeId, date: r.date } } });
    if (row?.isLocked) throw new HttpError(409, "This day's attendance is finalised, so it can't be corrected.", "LOCKED");
    const problem = dayProblem(row, date, { today: iso(businessToday()), earliest: "0000-01-01", pending: false, corrected: false });
    if (problem) throw new HttpError(409, `This can't be applied any more: ${problem.message}`, "NOT_APPLICABLE");
    // (The backdating limit applies when a request is raised; one already waiting is still decided on its merits.)
    const assignment = await assignmentOn(r.employeeId, r.date);
    const misfit = row ? correctionProblem(correction, row, date, assignment ? shiftDef(assignment) : null, assignment?.policy.nearDuplicateSeconds ?? 120) : null;
    if (misfit) throw new HttpError(409, `This can't be applied any more: ${misfit.message}`, "NOT_APPLICABLE");
  }
  const status = input.approve ? "APPROVED" : "REJECTED";
  const claimed = await prisma.$transaction(async (tx) => {
    const c = await tx.regularizationRequest.updateMany({
      where: { id, status: "PENDING" },
      data: { status, decidedByUserId: viewer.userId, decidedAt: new Date(), decisionNote: input.note?.trim() || null },
    });
    if (c.count === 0) return false;
    if (input.approve) {
      await appendOverrides(tx, [{ employeeId: r.employeeId, date, origin: "REGULARIZATION", ...overrideShape(correction), reasonCode: r.reasonCode, reason: r.reason, requestId: id, createdByUserId: viewer.userId }]);
    }
    return true;
  });
  if (!claimed) throw new HttpError(409, "This request was just decided by someone else.", "NOT_PENDING");
  if (input.approve) await computeAttendance([r.employeeId], date, date); // the correction joins the day
  await writeAuditLog({
    ...meta,
    action: `attendance.regularization.${input.approve ? "approved" : "rejected"}`,
    entityType: "RegularizationRequest",
    entityId: id,
    before: { status: "PENDING" },
    after: { status, correction: describeCorrection(correction), reasonCode: r.reasonCode, note: input.note?.trim() || null },
  });
  const after = await prisma.dailyAttendance.findUnique({ where: { employeeId_date: { employeeId: r.employeeId, date: r.date } }, select: { status: true } });
  await notifyEmployee(r.employeeId, {
    type: "regularization.decided",
    title: input.approve ? `Your correction for ${date} was approved` : `Your correction for ${date} was not approved`,
    body: input.approve ? `${describeCorrection(correction)} was applied; the day is now ${after?.status ?? "recomputed"}.` : (input.note?.trim() ? `"${input.note.trim()}"` : "Ask your manager or HR if you're unsure why."),
    link: `/app/attendance/info?date=${date}`,
    payload: { requestId: id, status },
  });
  const managerId = (await placementsOn([r.employeeId], businessToday())).get(r.employeeId)?.reportingManagerId ?? null;
  emitRegularizationDecided({ id, employeeId: r.employeeId, status }, managerId);
  return prisma.regularizationRequest.findUniqueOrThrow({ where: { id } });
}
