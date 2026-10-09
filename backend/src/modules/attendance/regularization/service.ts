import type { MissingPunchSide, Prisma, RegularizationStatus } from "@prisma/client";
import { instantToLocalTime } from "@shared/attendance/attlog";
import { cycleFor } from "../../../lib/attendanceCycle";
import { writeAuditLog } from "../../../lib/audit";
import { businessToday } from "../../../lib/businessDate";
import { getTeamEmployeeIds } from "../../../lib/dataScope";
import { assignmentOn, namesOn, placementsOn } from "../../../lib/effectiveDating";
import { resolveAccess } from "../../../lib/permissions";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { emitRegularizationDecided, emitRegularizationSubmitted } from "../../../realtime/emit";
import { notifyEmployee } from "../../notifications/notifyEmployee";
import { computeAttendance, shiftDef } from "../compute";
import { addDays, dayStartMs, shiftTimeline } from "../engine/time";
import type { Viewer } from "../manual/scope";
import type { Meta } from "../processService";

// The forgot-to-punch request (Phase 2 P2-E, regularization's first kind,
// brought forward from Phase 3 — docs/plans/PHASE_2.md "P2-E build design").
// The employee asks for the missing IN or OUT time on their own device day
// with one punch; their manager (by grant) or HR decides; approval adds the
// time to the day as a correction (never a raw punch) and recomputes it.

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const TZ = "Asia/Kolkata";

export type Eligibility = { ok: true; punchTime: string } | { ok: false; reason: string };

/** Whether the employee may raise a forgot-to-punch request for this day, and the one punch it has. */
export async function requestEligibility(employeeId: string, date: string): Promise<Eligibility> {
  const today = businessToday();
  if (date > iso(today)) return { ok: false, reason: "This day hasn't happened yet." };
  const current = await cycleFor(today);
  const previous = await cycleFor(day(addDays(iso(current.start), -1)));
  if (date < iso(previous.start)) return { ok: false, reason: "Requests can be raised for this attendance cycle and the one before it only." };
  const row = await prisma.dailyAttendance.findUnique({ where: { employeeId_date: { employeeId, date: day(date) } } });
  if (!row) return { ok: false, reason: "There's no attendance record for this day." };
  if (row.isLocked) return { ok: false, reason: "This day's attendance is finalised." };
  if (row.capture !== "DEVICE") return { ok: false, reason: "Your attendance is marked by hand; ask the person who marks your branch." };
  if (row.overrideKind === "MISSING_PUNCH_CORRECTION") return { ok: false, reason: "This day has already been corrected." };
  if (!row.exceptionFlags.includes("MISSING_PUNCH") || row.punchCount !== 1 || !row.firstIn) {
    return { ok: false, reason: row.provisional ? "The day isn't over yet: a missing punch can be reported once the shift's punch window has closed." : "This request is for a day with exactly one punch." };
  }
  const pending = await prisma.regularizationRequest.count({ where: { employeeId, date: day(date), status: "PENDING" } });
  if (pending) return { ok: false, reason: "There's already a request waiting for this day." };
  return { ok: true, punchTime: instantToLocalTime(row.firstIn, TZ).slice(11, 16) };
}

/** The instant a requested "HH:MM" means on this day (a night shift's early-morning time is the next day). */
async function requestedInstant(employeeId: string, date: string, time: string) {
  const assignment = await assignmentOn(employeeId, day(date));
  const tl = assignment ? shiftTimeline(shiftDef(assignment)) : null;
  const [h, m] = time.split(":").map(Number) as [number, number];
  let seconds = h * 3600 + m * 60;
  if (tl && tl.end > 86_400 && seconds < tl.windowStart) seconds += 86_400;
  return { at: dayStartMs(date) + seconds * 1000, tl, nearDuplicateSeconds: assignment?.policy.nearDuplicateSeconds ?? 120 };
}

export interface RaiseInput {
  date: string;
  missing: MissingPunchSide;
  time: string;
  reason: string;
}

export async function raiseRequest(viewer: Viewer, input: RaiseInput, meta: Meta) {
  const employeeId = viewer.employeeId;
  const eligible = await requestEligibility(employeeId, input.date);
  if (!eligible.ok) throw new HttpError(409, eligible.reason, "NOT_ELIGIBLE");
  const row = await prisma.dailyAttendance.findUniqueOrThrow({ where: { employeeId_date: { employeeId, date: day(input.date) } } });
  const punch = row.firstIn!.getTime();
  const { at, tl, nearDuplicateSeconds } = await requestedInstant(employeeId, input.date, input.time);
  const gap = Math.abs(at - punch) / 1000;
  if (input.missing === "OUT" && at <= punch) throw new HttpError(400, `The time you left must be after your punch at ${eligible.punchTime}.`, "VALIDATION_ERROR");
  if (input.missing === "IN" && at >= punch) throw new HttpError(400, `The time you arrived must be before your punch at ${eligible.punchTime}.`, "VALIDATION_ERROR");
  if (gap <= nearDuplicateSeconds) throw new HttpError(400, "That's almost the same time as your punch.", "VALIDATION_ERROR");
  if (tl) {
    const base = dayStartMs(input.date);
    if (at < base + tl.windowStart * 1000 || at > base + tl.windowEnd * 1000) {
      throw new HttpError(400, `That time is outside your shift's punch window (${instantToLocalTime(new Date(base + tl.windowStart * 1000), TZ).slice(11, 16)}–${instantToLocalTime(new Date(base + tl.windowEnd * 1000), TZ).slice(11, 16)}).`, "VALIDATION_ERROR");
    }
  }
  let request;
  try {
    request = await prisma.regularizationRequest.create({ data: { employeeId, date: day(input.date), missing: input.missing, time: input.time, reason: input.reason.trim(), raisedByUserId: viewer.userId } });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") throw new HttpError(409, "There's already a request waiting for this day.", "NOT_ELIGIBLE");
    throw err;
  }
  await writeAuditLog({ ...meta, action: "attendance.regularization.raised", entityType: "RegularizationRequest", entityId: request.id, after: { employeeId, date: input.date, missing: input.missing, time: input.time, reason: request.reason } });

  // The reporting manager hears about it if they can decide it; HR sees every pending request in its queue.
  const placement = (await placementsOn([employeeId], businessToday())).get(employeeId);
  const managerId = placement?.reportingManagerId ?? null;
  if (managerId) {
    const managerUser = await prisma.user.findUnique({ where: { employeeId: managerId }, select: { id: true, status: true } });
    if (managerUser?.status === "ACTIVE" && (await resolveAccess(managerUser.id)).permissions.has("attendance.regularization.approve")) {
      const name = (await namesOn([employeeId], businessToday())).get(employeeId) ?? "Someone";
      await notifyEmployee(managerId, {
        type: "regularization.submitted",
        title: `${name} forgot to punch ${input.missing === "OUT" ? "out" : "in"}`,
        body: `${input.date}: asks for ${input.missing} ${input.time}. "${request.reason}"`,
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

export async function myRequests(employeeId: string) {
  return prisma.regularizationRequest.findMany({ where: { employeeId }, orderBy: { createdAt: "desc" }, take: 100 });
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

export async function listQueue(viewer: Viewer, q: { status?: RegularizationStatus }) {
  const employeeId = await reach(viewer);
  const rows = await prisma.regularizationRequest.findMany({
    where: { employeeId, ...(q.status ? { status: q.status } : {}) },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    take: 300,
    include: { employee: { select: { employeeCode: true } } },
  });
  const ids = [...new Set(rows.map((r) => r.employeeId))];
  const [names, days, deciders] = await Promise.all([
    namesOn(ids, businessToday()),
    prisma.dailyAttendance.findMany({ where: { OR: rows.map((r) => ({ employeeId: r.employeeId, date: r.date })) }, select: { employeeId: true, date: true, status: true, firstIn: true, shiftCode: true, shiftStart: true, shiftEnd: true } }),
    prisma.user.findMany({ where: { id: { in: rows.map((r) => r.decidedByUserId).filter((x): x is string => !!x) } }, select: { id: true, employeeId: true } }),
  ]);
  const deciderNames = await namesOn(deciders.map((u) => u.employeeId), businessToday());
  const dayOf = new Map(days.map((d) => [`${d.employeeId}|${iso(d.date)}`, d]));
  const canDecide = viewer.permissions.has("attendance.regularization.approve");
  return rows.map((r) => {
    const d = dayOf.get(`${r.employeeId}|${iso(r.date)}`);
    const decider = deciders.find((u) => u.id === r.decidedByUserId);
    return {
      id: r.id,
      employeeId: r.employeeId,
      employeeCode: r.employee.employeeCode,
      name: names.get(r.employeeId) ?? r.employee.employeeCode,
      date: iso(r.date),
      missing: r.missing,
      time: r.time,
      reason: r.reason,
      status: r.status,
      punch: d?.firstIn ? instantToLocalTime(d.firstIn, TZ).slice(11, 16) : null,
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
  const row = await prisma.dailyAttendance.findUnique({ where: { employeeId_date: { employeeId: r.employeeId, date: r.date } }, select: { isLocked: true } });
  if (input.approve && row?.isLocked) throw new HttpError(409, "This day's attendance is finalised, so it can't be corrected.", "LOCKED");
  const status = input.approve ? "APPROVED" : "REJECTED";
  const claimed = await prisma.regularizationRequest.updateMany({
    where: { id, status: "PENDING" },
    data: { status, decidedByUserId: viewer.userId, decidedAt: new Date(), decisionNote: input.note?.trim() || null },
  });
  if (claimed.count === 0) throw new HttpError(409, "This request was just decided by someone else.", "NOT_PENDING");
  if (input.approve) await computeAttendance([r.employeeId], date, date); // the corrected time joins the day
  await writeAuditLog({ ...meta, action: `attendance.regularization.${input.approve ? "approved" : "rejected"}`, entityType: "RegularizationRequest", entityId: id, before: { status: "PENDING" }, after: { status, note: input.note ?? null, date, missing: r.missing, time: r.time } });
  const after = await prisma.dailyAttendance.findUnique({ where: { employeeId_date: { employeeId: r.employeeId, date: r.date } }, select: { status: true } });
  await notifyEmployee(r.employeeId, {
    type: "regularization.decided",
    title: input.approve ? `Missing punch on ${date} approved` : `Missing punch on ${date} not approved`,
    body: input.approve ? `${r.missing} ${r.time} was added; the day is now ${after?.status ?? "recomputed"}.` : (input.note?.trim() ? `"${input.note.trim()}"` : "Ask your manager or HR if you're unsure why."),
    link: `/app/attendance/info?date=${date}`,
    payload: { requestId: id, status },
  });
  const managerId = (await placementsOn([r.employeeId], businessToday())).get(r.employeeId)?.reportingManagerId ?? null;
  emitRegularizationDecided({ id, employeeId: r.employeeId, status }, managerId);
  return prisma.regularizationRequest.findUniqueOrThrow({ where: { id } });
}
