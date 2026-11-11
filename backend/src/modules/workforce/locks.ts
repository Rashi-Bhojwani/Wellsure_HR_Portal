import { writeAuditLog } from "../../lib/audit";
import { businessToday } from "../../lib/businessDate";
import { isDirector as isDirectorUser } from "../../lib/directorAuthority";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { resolveSegmentEmployeeIds } from "../parity/segments";
import type { ParityMeta, ParityViewer } from "../parity/types";

// A-10 G3 (docs/plans/GREYTHR_PARITY_WORKFORCE.md item 7): a director locks chosen attendance activities for a date range, from an effective date, for
// everyone or a snapshot of a saved segment's people. One guard, assertNotLocked, is called by every writer of those activities. A lock never touches a
// finalised period (finalisation has its own lock) and never deletes or rewrites anything: it only refuses new actions. Directors are not stopped by a
// lock (it is a control over others' work); every such action is still audited by its own writer.

export const LOCK_CATEGORIES = ["LEAVE", "REGULARIZATION", "MUSTER", "MANUAL_OVERRIDE", "SHIFT_OVERRIDE", "ROSTER"] as const;
export type LockCategory = (typeof LOCK_CATEGORIES)[number];
export const LOCK_CATEGORY_LABEL: Record<LockCategory, string> = {
  LEAVE: "Applying for leave",
  REGULARIZATION: "Attendance corrections (regularization)",
  MUSTER: "Muster entries",
  MANUAL_OVERRIDE: "Manual Override",
  SHIFT_OVERRIDE: "Shift Override",
  ROSTER: "Shift Roster",
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);

function requireDirector(viewer: Pick<ParityViewer, "roleCodes">) {
  if (!viewer.roleCodes.includes("SUPER_ADMIN")) throw new HttpError(403, "Only a director can set or void an attendance lock.", "DIRECTOR_ONLY");
}

export interface NewLock {
  effectiveFrom: string;
  fromDate: string;
  toDate: string;
  categories: LockCategory[];
  segmentId?: string | null;
  reason: string;
}

export async function createLock(viewer: ParityViewer, input: NewLock, meta: ParityMeta) {
  requireDirector(viewer);
  if (input.fromDate > input.toDate) throw new HttpError(400, "The range ends before it starts.", "VALIDATION_ERROR");
  const categories = [...new Set(input.categories)];
  let employeeIds: string[] = [];
  let segmentName: string | null = null;
  if (input.segmentId) {
    employeeIds = await resolveSegmentEmployeeIds(input.segmentId, viewer);
    if (employeeIds.length === 0) throw new HttpError(400, "That segment holds nobody; a lock for nobody would do nothing.", "VALIDATION_ERROR");
    segmentName = (await prisma.employeeSegment.findUnique({ where: { id: input.segmentId }, select: { name: true } }))?.name ?? null;
  }
  const row = await prisma.attendanceLock.create({
    data: { effectiveFrom: day(input.effectiveFrom), fromDate: day(input.fromDate), toDate: day(input.toDate), categories, employeeIds, segmentName, reason: input.reason.trim(), createdByUserId: viewer.userId },
  });
  await writeAuditLog({ ...meta, action: "attendance.lock.created", entityType: "AttendanceLock", entityId: row.id, after: { effectiveFrom: input.effectiveFrom, fromDate: input.fromDate, toDate: input.toDate, categories, people: employeeIds.length || "everyone", segmentName, reason: row.reason } });
  return view(row);
}

export async function voidLock(viewer: ParityViewer, id: string, reason: string, meta: ParityMeta) {
  requireDirector(viewer);
  const row = await prisma.attendanceLock.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, "Lock not found.", "NOT_FOUND");
  if (row.voidedAt) throw new HttpError(409, "This lock is already void.", "ALREADY_VOID");
  const updated = await prisma.attendanceLock.update({ where: { id }, data: { voidedAt: new Date(), voidedByUserId: viewer.userId, voidReason: reason.trim() } });
  await writeAuditLog({ ...meta, action: "attendance.lock.voided", entityType: "AttendanceLock", entityId: id, before: { voidedAt: null }, after: { reason: updated.voidReason } });
  return view(updated);
}

type Row = Awaited<ReturnType<typeof prisma.attendanceLock.findFirstOrThrow>>;
function view(r: Row) {
  const today = iso(businessToday());
  return {
    id: r.id,
    effectiveFrom: iso(r.effectiveFrom),
    fromDate: iso(r.fromDate),
    toDate: iso(r.toDate),
    categories: r.categories,
    people: r.employeeIds.length,
    everyone: r.employeeIds.length === 0,
    segmentName: r.segmentName,
    reason: r.reason,
    createdAt: r.createdAt.toISOString(),
    voidedAt: r.voidedAt?.toISOString() ?? null,
    voidReason: r.voidReason,
    state: r.voidedAt ? "VOID" : iso(r.effectiveFrom) > today ? "SCHEDULED" : "IN_FORCE",
  };
}

export async function listLocks(viewer: ParityViewer) {
  requireDirector(viewer);
  const rows = await prisma.attendanceLock.findMany({ orderBy: { createdAt: "desc" }, take: 500 });
  return { locks: rows.map(view), categories: LOCK_CATEGORIES.map((c) => ({ code: c, label: LOCK_CATEGORY_LABEL[c] })) };
}

/** Pure: the lock (if any) that refuses `category` for this person over [from, to] (to = null: open-ended, as a roster from a date). Exported for tests. */
export function lockHit(
  locks: Array<{ id: string; effectiveFrom: string; fromDate: string; toDate: string; categories: string[]; employeeIds: string[]; voided: boolean }>,
  category: LockCategory,
  employeeId: string,
  from: string,
  to: string | null,
  today: string,
) {
  return (
    locks.find(
      (l) =>
        !l.voided &&
        l.effectiveFrom <= today &&
        l.categories.includes(category) &&
        (l.employeeIds.length === 0 || l.employeeIds.includes(employeeId)) &&
        l.fromDate <= (to ?? "9999-12-31") &&
        from <= l.toDate,
    ) ?? null
  );
}

/**
 * The ONE guard. Throws 409 ATTENDANCE_LOCKED naming the first item refused and the lock's range and reason. A director acting is never refused.
 * `items`: each person and the attendance days the action would write (to = null: from that day onward).
 */
export async function assertNotLocked(category: LockCategory, actorUserId: string, items: Array<{ employeeId: string; from: string; to: string | null }>): Promise<void> {
  if (items.length === 0) return;
  const today = iso(businessToday());
  const earliest = items.reduce((m, i) => (i.from < m ? i.from : m), items[0]!.from);
  const rows = await prisma.attendanceLock.findMany({ where: { voidedAt: null, effectiveFrom: { lte: day(today) }, categories: { has: category }, toDate: { gte: day(earliest) } } });
  if (rows.length === 0) return;
  if (await isDirectorUser(actorUserId)) return;
  const locks = rows.map((r) => ({ id: r.id, effectiveFrom: iso(r.effectiveFrom), fromDate: iso(r.fromDate), toDate: iso(r.toDate), categories: r.categories, employeeIds: r.employeeIds, voided: false, reason: r.reason }));
  for (const it of items) {
    const hit = lockHit(locks, category, it.employeeId, it.from, it.to, today);
    if (hit) {
      const full = locks.find((l) => l.id === hit.id)!;
      throw new HttpError(409, `${LOCK_CATEGORY_LABEL[category]} is locked from ${full.fromDate} to ${full.toDate} by a director (${full.reason}). Nothing was changed.`, "ATTENDANCE_LOCKED", { lockId: hit.id, employeeId: it.employeeId });
    }
  }
}
