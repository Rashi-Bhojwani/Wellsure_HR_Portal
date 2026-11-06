import type { Prisma } from "@prisma/client";
import { writeAuditLog } from "../../lib/audit";
import { businessToday } from "../../lib/businessDate";
import { placementsOn } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import type { ParityMeta, ParityViewer } from "../parity/types";

// A-10 G4 (docs/plans/GREYTHR_PARITY_WORKFORCE.md item 11): leave type reviewers. A director names a person who may ALSO decide requests of one leave type,
// for everyone or for the people placed (today) at a location and/or in a department. It only ever adds reach; it never takes reach away from a manager or
// HR, and the person still needs leave.approve (a reviewer without it decides nothing). Never their own request (assertCanDecide refuses that first).

function requireDirector(viewer: Pick<ParityViewer, "roleCodes">) {
  if (!viewer.roleCodes.includes("SUPER_ADMIN")) throw new HttpError(403, "Only a director can name or remove a leave type reviewer.", "DIRECTOR_ONLY");
}

export interface ReviewerReach {
  /** leaveTypeId → the employee ids whose requests of that type this viewer may decide as a reviewer. */
  byType: Map<string, Set<string>>;
}

export async function reviewerReach(viewerEmployeeId: string): Promise<ReviewerReach> {
  const rows = await prisma.leaveTypeReviewer.findMany({ where: { reviewerEmployeeId: viewerEmployeeId, voidedAt: null } });
  const byType = new Map<string, Set<string>>();
  if (rows.length === 0) return { byType };
  const active = await prisma.employee.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
  const placed = await placementsOn(active.map((e) => e.id), businessToday());
  for (const r of rows) {
    const set = byType.get(r.leaveTypeId) ?? new Set<string>();
    for (const e of active) {
      const p = placed.get(e.id);
      if (r.locationId && p?.locationId !== r.locationId) continue;
      if (r.departmentId && p?.departmentId !== r.departmentId) continue;
      if (e.id !== viewerEmployeeId) set.add(e.id);
    }
    byType.set(r.leaveTypeId, set);
  }
  return { byType };
}

export const reviewerCovers = (reach: ReviewerReach, leaveTypeId: string, employeeId: string) => reach.byType.get(leaveTypeId)?.has(employeeId) ?? false;

/** OR-branches for a LeaveRequest where clause: the requests this reviewer may see in the approval flows. */
export function reviewerWhere(reach: ReviewerReach): Prisma.LeaveRequestWhereInput[] {
  return [...reach.byType.entries()].filter(([, ids]) => ids.size > 0).map(([leaveTypeId, ids]) => ({ leaveTypeId, employeeId: { in: [...ids] } }));
}

export async function createReviewer(viewer: ParityViewer, input: { leaveTypeId: string; reviewerEmployeeId: string; locationId?: string | null; departmentId?: string | null; reason: string }, meta: ParityMeta) {
  requireDirector(viewer);
  const [type, person] = await Promise.all([
    prisma.leaveType.findUnique({ where: { id: input.leaveTypeId }, select: { id: true, name: true } }),
    prisma.employee.findUnique({ where: { id: input.reviewerEmployeeId }, select: { id: true, status: true } }),
  ]);
  if (!type) throw new HttpError(400, "That leave type does not exist.", "VALIDATION_ERROR");
  if (!person || person.status !== "ACTIVE") throw new HttpError(400, "Choose an active person.", "VALIDATION_ERROR");
  if (input.locationId && !(await prisma.location.count({ where: { id: input.locationId } }))) throw new HttpError(400, "That location does not exist.", "VALIDATION_ERROR");
  if (input.departmentId && !(await prisma.department.count({ where: { id: input.departmentId } }))) throw new HttpError(400, "That department does not exist.", "VALIDATION_ERROR");
  const row = await prisma.leaveTypeReviewer.create({ data: { leaveTypeId: type.id, reviewerEmployeeId: person.id, locationId: input.locationId ?? null, departmentId: input.departmentId ?? null, reason: input.reason.trim(), createdByUserId: viewer.userId } });
  await writeAuditLog({ ...meta, action: "leave.reviewer.created", entityType: "LeaveTypeReviewer", entityId: row.id, after: { leaveType: type.name, reviewerEmployeeId: person.id, locationId: row.locationId, departmentId: row.departmentId, reason: row.reason } });
  return { id: row.id };
}

export async function voidReviewer(viewer: ParityViewer, id: string, reason: string, meta: ParityMeta) {
  requireDirector(viewer);
  const row = await prisma.leaveTypeReviewer.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, "Reviewer not found.", "NOT_FOUND");
  if (row.voidedAt) throw new HttpError(409, "Already removed.", "ALREADY_VOID");
  await prisma.leaveTypeReviewer.update({ where: { id }, data: { voidedAt: new Date(), voidedByUserId: viewer.userId, voidReason: reason.trim() } });
  await writeAuditLog({ ...meta, action: "leave.reviewer.voided", entityType: "LeaveTypeReviewer", entityId: id, after: { reason: reason.trim() } });
  return { id, voided: true };
}

export async function listReviewers(viewer: ParityViewer) {
  requireDirector(viewer);
  const rows = await prisma.leaveTypeReviewer.findMany({ orderBy: { createdAt: "desc" }, take: 500, include: { leaveType: { select: { name: true } }, reviewer: { select: { employeeCode: true } } } });
  const [locs, deps] = await Promise.all([prisma.location.findMany({ select: { id: true, name: true } }), prisma.department.findMany({ select: { id: true, name: true } })]);
  const ln = new Map(locs.map((l) => [l.id, l.name]));
  const dn = new Map(deps.map((d) => [d.id, d.name]));
  return {
    reviewers: rows.map((r) => ({
      id: r.id,
      leaveType: r.leaveType.name,
      reviewerCode: r.reviewer.employeeCode,
      reviewerEmployeeId: r.reviewerEmployeeId,
      location: r.locationId ? (ln.get(r.locationId) ?? "—") : null,
      department: r.departmentId ? (dn.get(r.departmentId) ?? "—") : null,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
      voidedAt: r.voidedAt?.toISOString() ?? null,
      voidReason: r.voidReason,
    })),
  };
}
