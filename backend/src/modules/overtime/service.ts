import { z } from "zod";
import type { DataScope } from "../../lib/dataScope";
import { buildEmployeeScopeWhere } from "../../lib/dataScope";
import { writeAuditLog } from "../../lib/audit";
import { isDirector } from "../../lib/directorAuthority";
import { inForceOn } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { notifyEmployee } from "../notifications/notifyEmployee";
import { policyInForce } from "../policySettings/service";

// M session block 2, AT-19: overtime. Off until two directors turn it on (policy.overtime). Overtime on a day is the attendance engine's excess
// minutes (time worked beyond the shift) once the day is no longer provisional, counted only from the minimum and rounded down to the step. The
// employee claims a day; it is approved by a director, or (when the setting allows) by someone holding attendance.regularization.approve for that
// person within their data scope; never one's own. Nothing here changes attendance; paying approved minutes is payroll's.

export type OvertimePolicy = {
  active: true;
  minimumMinutes: number;
  roundToMinutes: number;
  approver: "MANAGER_OR_DIRECTOR" | "DIRECTOR";
};
export interface Viewer {
  userId: string;
  employeeId: string;
  dataScope: DataScope;
  permissions: ReadonlySet<string>;
}
export interface ActorMeta {
  actorUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
export const monthQuery = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).strict();
export const claimBody = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().trim().max(300).default("") }).strict();
export const decideBody = z.object({ note: z.string().trim().max(300).optional() }).strict();
export const rejectBody = z.object({ note: z.string().trim().min(3).max(300) }).strict();
export const listQuery = z.object({ status: z.enum(["PENDING", "APPROVED", "REJECTED"]).default("PENDING") }).strict();

/** The overtime a day earns under the policy: 0 below the minimum, otherwise rounded down to the step. */
export function eligibleMinutes(excess: number | null, policy: Pick<OvertimePolicy, "minimumMinutes" | "roundToMinutes">): number {
  if (!excess || excess < policy.minimumMinutes) return 0;
  return Math.floor(excess / policy.roundToMinutes) * policy.roundToMinutes;
}

async function policyOrOff(): Promise<OvertimePolicy | null> {
  return policyInForce<OvertimePolicy>("policy.overtime");
}
async function requireOn(): Promise<OvertimePolicy> {
  const p = await policyOrOff();
  if (!p) throw new HttpError(409, "Overtime is not in use. The directors turn it on in Policy settings.", "OVERTIME_OFF");
  return p;
}

const monthRange = (month: string) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
};

/** One's own days with overtime in a month, and one's claims. */
export async function mine(employeeId: string, month: string) {
  const policy = await policyOrOff();
  if (!policy) return { active: false as const, days: [] };
  const [rows, claims] = await Promise.all([
    prisma.dailyAttendance.findMany({ where: { employeeId, date: monthRange(month), provisional: false, excessMinutes: { gt: 0 } }, select: { date: true, excessMinutes: true, shiftCode: true }, orderBy: { date: "asc" } }),
    prisma.overtimeClaim.findMany({ where: { employeeId, date: monthRange(month) }, orderBy: { createdAt: "desc" } }),
  ]);
  const claimOf = new Map<string, (typeof claims)[number]>();
  for (const c of claims) if (!claimOf.has(iso(c.date))) claimOf.set(iso(c.date), c);
  return {
    active: true as const,
    policy: { minimumMinutes: policy.minimumMinutes, roundToMinutes: policy.roundToMinutes },
    days: rows
      .map((r) => ({ date: iso(r.date), excessMinutes: r.excessMinutes ?? 0, eligibleMinutes: eligibleMinutes(r.excessMinutes, policy), claim: claimOf.get(iso(r.date)) ? { id: claimOf.get(iso(r.date))!.id, status: claimOf.get(iso(r.date))!.status, minutes: claimOf.get(iso(r.date))!.approvedMinutes ?? claimOf.get(iso(r.date))!.minutes, decisionNote: claimOf.get(iso(r.date))!.decisionNote } : null }))
      .filter((d) => d.eligibleMinutes > 0 || d.claim),
  };
}

export async function claim(employeeId: string, input: z.infer<typeof claimBody>, meta: ActorMeta) {
  const policy = await requireOn();
  const row = await prisma.dailyAttendance.findUnique({ where: { employeeId_date: { employeeId, date: day(input.date) } }, select: { excessMinutes: true, provisional: true } });
  if (!row || row.provisional) throw new HttpError(409, "This day's attendance is not settled yet.", "NOT_SETTLED");
  const minutes = eligibleMinutes(row.excessMinutes, policy);
  if (minutes <= 0) throw new HttpError(409, `No overtime on this day (at least ${policy.minimumMinutes} minutes beyond the shift count).`, "NO_OVERTIME");
  try {
    const c = await prisma.overtimeClaim.create({ data: { employeeId, date: day(input.date), minutes, note: input.note } });
    await writeAuditLog({ ...meta, action: "attendance.overtime.claimed", entityType: "OvertimeClaim", entityId: c.id, after: { date: input.date, minutes } });
    const manager = await prisma.employeeJobHistory.findFirst({ where: { employeeId, ...inForceOn() }, select: { reportingManagerId: true } });
    if (manager?.reportingManagerId && policy.approver === "MANAGER_OR_DIRECTOR") await notifyEmployee(manager.reportingManagerId, { type: "overtime.claimed", title: "An overtime claim waits for a decision", body: `${input.date}: ${minutes} minutes`, link: "/admin/workforce/attendance/overtime" });
    return { id: c.id, minutes };
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new HttpError(409, "There is already a claim for this day.", "ALREADY_CLAIMED");
    throw e;
  }
}

export async function withdraw(id: string, employeeId: string, meta: ActorMeta) {
  const c = await prisma.overtimeClaim.findUnique({ where: { id } });
  if (!c || c.employeeId !== employeeId) throw new HttpError(404, "Not found.", "NOT_FOUND");
  if (c.status !== "PENDING") throw new HttpError(409, "Already decided.", "ALREADY_DECIDED");
  await prisma.overtimeClaim.update({ where: { id }, data: { status: "WITHDRAWN", decidedAt: new Date(), decidedByUserId: meta.actorUserId } });
  await writeAuditLog({ ...meta, action: "attendance.overtime.withdrawn", entityType: "OvertimeClaim", entityId: id });
  return { id, status: "WITHDRAWN" as const };
}

/** May this viewer decide this person's claims? A director; or, if the setting allows, the approval key with the person in the viewer's scope. */
async function mayDecide(employeeId: string, viewer: Viewer, policy: OvertimePolicy): Promise<boolean> {
  if (employeeId === viewer.employeeId) return false;
  if (await isDirector(viewer.userId)) return true;
  if (policy.approver !== "MANAGER_OR_DIRECTOR" || !viewer.permissions.has("attendance.regularization.approve")) return false;
  const scope = await buildEmployeeScopeWhere(viewer.employeeId, viewer.dataScope);
  return !!(await prisma.employee.findFirst({ where: { AND: [{ id: employeeId }, scope] }, select: { id: true } }));
}

export async function list(viewer: Viewer, status: "PENDING" | "APPROVED" | "REJECTED") {
  const policy = await policyOrOff();
  if (!policy) return { active: false as const, claims: [] };
  const rows = await prisma.overtimeClaim.findMany({ where: { status, employeeId: { not: viewer.employeeId } }, include: { employee: { select: { employeeCode: true, nameHistory: { where: inForceOn(), select: { fullName: true } } } } }, orderBy: { date: "asc" }, take: 500 });
  const out = [];
  for (const r of rows) {
    if (!(await mayDecide(r.employeeId, viewer, policy))) continue;
    out.push({ id: r.id, employeeId: r.employeeId, employeeCode: r.employee.employeeCode, fullName: r.employee.nameHistory[0]?.fullName ?? r.employee.employeeCode, date: iso(r.date), minutes: r.minutes, approvedMinutes: r.approvedMinutes, note: r.note, status: r.status, decisionNote: r.decisionNote });
  }
  return { active: true as const, claims: out };
}

async function loadDecidable(id: string, viewer: Viewer) {
  const policy = await requireOn();
  const c = await prisma.overtimeClaim.findUnique({ where: { id } });
  if (!c || !(await mayDecide(c.employeeId, viewer, policy))) throw new HttpError(404, "Not found.", "NOT_FOUND");
  if (c.status !== "PENDING") throw new HttpError(409, "Already decided.", "ALREADY_DECIDED");
  return { c, policy };
}

/** Approve: the minutes are read again from today's attendance (a recomputed day may have changed); never more than claimed. */
export async function approve(id: string, note: string | undefined, viewer: Viewer, meta: ActorMeta) {
  const { c, policy } = await loadDecidable(id, viewer);
  const row = await prisma.dailyAttendance.findUnique({ where: { employeeId_date: { employeeId: c.employeeId, date: c.date } }, select: { excessMinutes: true } });
  const approvedMinutes = Math.min(c.minutes, eligibleMinutes(row?.excessMinutes ?? 0, policy));
  const done = await prisma.overtimeClaim.updateMany({ where: { id, status: "PENDING" }, data: { status: "APPROVED", approvedMinutes, decidedByUserId: viewer.userId, decidedAt: new Date(), decisionNote: note ?? null } });
  if (!done.count) throw new HttpError(409, "Already decided.", "ALREADY_DECIDED");
  await writeAuditLog({ ...meta, action: "attendance.overtime.approved", entityType: "OvertimeClaim", entityId: id, after: { approvedMinutes } });
  await notifyEmployee(c.employeeId, { type: "overtime.approved", title: `Overtime on ${iso(c.date)} approved`, body: `${approvedMinutes} minutes`, link: "/app/attendance/overtime" });
  return { id, status: "APPROVED" as const, approvedMinutes };
}

export async function reject(id: string, note: string, viewer: Viewer, meta: ActorMeta) {
  const { c } = await loadDecidable(id, viewer);
  const done = await prisma.overtimeClaim.updateMany({ where: { id, status: "PENDING" }, data: { status: "REJECTED", decidedByUserId: viewer.userId, decidedAt: new Date(), decisionNote: note } });
  if (!done.count) throw new HttpError(409, "Already decided.", "ALREADY_DECIDED");
  await writeAuditLog({ ...meta, action: "attendance.overtime.rejected", entityType: "OvertimeClaim", entityId: id, after: { reason: note } });
  await notifyEmployee(c.employeeId, { type: "overtime.rejected", title: `Overtime on ${iso(c.date)} not approved`, body: note, link: "/app/attendance/overtime" });
  return { id, status: "REJECTED" as const };
}

/** Directors: approved overtime minutes per person for a month (what payroll would pay; no amounts here). */
export async function monthTotals(month: string, viewer: Viewer) {
  if (!(await isDirector(viewer.userId))) throw new HttpError(403, "Directors only.", "FORBIDDEN");
  const rows = await prisma.overtimeClaim.groupBy({ by: ["employeeId"], where: { status: "APPROVED", date: monthRange(month) }, _sum: { approvedMinutes: true }, _count: { _all: true } });
  const people = await prisma.employee.findMany({ where: { id: { in: rows.map((r) => r.employeeId) } }, select: { id: true, employeeCode: true, nameHistory: { where: inForceOn(), select: { fullName: true } } } });
  const by = new Map(people.map((p) => [p.id, p]));
  return rows.map((r) => ({ employeeId: r.employeeId, employeeCode: by.get(r.employeeId)?.employeeCode ?? "", fullName: by.get(r.employeeId)?.nameHistory[0]?.fullName ?? "", days: r._count._all, minutes: r._sum.approvedMinutes ?? 0 })).sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));
}
