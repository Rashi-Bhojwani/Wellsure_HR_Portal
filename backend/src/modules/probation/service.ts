import { z } from "zod";
import type { DataScope } from "../../lib/dataScope";
import { buildEmployeeScopeWhere } from "../../lib/dataScope";
import { writeAuditLog } from "../../lib/audit";
import { addCalendarDays, businessToday } from "../../lib/businessDate";
import { inForceOn } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { notifyEmployee } from "../notifications/notifyEmployee";
import { policyInForce } from "../policySettings/service";

// M session block 2, ER-26: probation. The last day of probation is the joining date plus the policy's months, less a day (the end of the month is
// kept when the day does not exist, e.g. 31 Jan + 1 month = 28/29 Feb), or the date of the latest extension. HR (employee.edit, data scope) confirms
// or extends with a reason; never on their own record. Decisions are append-only. Probation is not linked to leave eligibility (that is the leave
// policy's own rule).

export interface Viewer {
  userId: string;
  employeeId: string;
  dataScope: DataScope;
}
export interface ActorMeta {
  actorUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);

/** Joining date + months − 1 day, with the day clamped to the target month's length. */
export function probationLastDay(joining: string, months: number): string {
  const [y, m, d] = joining.split("-").map(Number) as [number, number, number];
  const targetMonthIndex = m - 1 + months;
  const lastDayOfTarget = new Date(Date.UTC(y, targetMonthIndex + 1, 0)).getUTCDate();
  const sameDay = new Date(Date.UTC(y, targetMonthIndex, Math.min(d, lastDayOfTarget)));
  return iso(addCalendarDays(sameDay, -1));
}

type Decision = { kind: string; extendedTo: Date | null; createdAt: Date; reason: string };
export function probationState(joining: string, months: number, decisions: Decision[]) {
  const sorted = [...decisions].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const confirmed = sorted.find((x) => x.kind === "CONFIRMED");
  const extension = sorted.find((x) => x.kind === "EXTENDED");
  const lastDay = extension?.extendedTo ? iso(extension.extendedTo) : probationLastDay(joining, months);
  return { lastDay, confirmedAt: confirmed ? confirmed.createdAt.toISOString() : null, extended: !!extension };
}

export const listQuery = z.object({ show: z.enum(["due", "all"]).default("due") }).strict();
export const confirmBody = z.object({ reason: z.string().trim().min(3).max(300) }).strict();
export const extendBody = z.object({ until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().trim().min(3).max(300) }).strict();

/** People in probation in the viewer's scope: "due" = ending within the reminder window or already past; "all" = everyone not yet confirmed. */
export async function list(viewer: Viewer, show: "due" | "all") {
  const policy = (await policyInForce<{ months: number; reminderDays: number }>("policy.probation"))!;
  const scope = await buildEmployeeScopeWhere(viewer.employeeId, viewer.dataScope);
  const people = await prisma.employee.findMany({
    where: { AND: [{ status: "ACTIVE", id: { not: viewer.employeeId } }, scope] },
    select: { id: true, employeeCode: true, dateOfJoining: true, nameHistory: { where: inForceOn(), select: { fullName: true } }, jobHistory: { where: inForceOn(), select: { department: { select: { name: true } }, reportingManager: { select: { nameHistory: { where: inForceOn(), select: { fullName: true } } } } } }, probationDecisions: true },
    orderBy: { dateOfJoining: "asc" },
  });
  const today = iso(businessToday());
  const horizon = iso(addCalendarDays(businessToday(), policy.reminderDays));
  return {
    policy,
    people: people
      .map((p) => {
        const st = probationState(iso(p.dateOfJoining), policy.months, p.probationDecisions);
        return { employeeId: p.id, employeeCode: p.employeeCode, fullName: p.nameHistory[0]?.fullName ?? p.employeeCode, department: p.jobHistory[0]?.department.name ?? null, manager: p.jobHistory[0]?.reportingManager?.nameHistory[0]?.fullName ?? null, dateOfJoining: iso(p.dateOfJoining), lastDay: st.lastDay, extended: st.extended, confirmedAt: st.confirmedAt, overdue: !st.confirmedAt && st.lastDay < today };
      })
      .filter((p) => !p.confirmedAt && (show === "all" || p.lastDay <= horizon))
      .sort((a, b) => a.lastDay.localeCompare(b.lastDay)),
  };
}

async function loadInScope(employeeId: string, viewer: Viewer) {
  if (employeeId === viewer.employeeId) throw new HttpError(403, "You cannot decide your own probation.", "OWN_RECORD");
  const scope = await buildEmployeeScopeWhere(viewer.employeeId, viewer.dataScope);
  const e = await prisma.employee.findFirst({ where: { AND: [{ id: employeeId, status: "ACTIVE" }, scope] }, select: { id: true, dateOfJoining: true, probationDecisions: true } });
  if (!e) throw new HttpError(404, "Employee not found.", "NOT_FOUND");
  const policy = (await policyInForce<{ months: number }>("policy.probation"))!;
  const st = probationState(iso(e.dateOfJoining), policy.months, e.probationDecisions);
  if (st.confirmedAt) throw new HttpError(409, "Already confirmed.", "ALREADY_CONFIRMED");
  return { e, st };
}

export async function confirm(employeeId: string, reason: string, viewer: Viewer, meta: ActorMeta) {
  const { st } = await loadInScope(employeeId, viewer);
  const row = await prisma.employeeProbationDecision.create({ data: { employeeId, kind: "CONFIRMED", reason, decidedByUserId: viewer.userId } });
  await writeAuditLog({ ...meta, action: "employee.probation.confirmed", entityType: "Employee", entityId: employeeId, before: { lastDay: st.lastDay }, after: { decisionId: row.id, reason } });
  await notifyEmployee(employeeId, { type: "probation.confirmed", title: "Your probation is complete: you are confirmed", body: reason, link: "/app/my-info" });
  return { employeeId, confirmedAt: row.createdAt.toISOString() };
}

export async function extend(employeeId: string, until: string, reason: string, viewer: Viewer, meta: ActorMeta) {
  const { e, st } = await loadInScope(employeeId, viewer);
  if (until <= st.lastDay) throw new HttpError(400, `An extension ends after the current last day (${st.lastDay}).`, "VALIDATION_ERROR");
  if (until > iso(addCalendarDays(e.dateOfJoining, 366))) throw new HttpError(400, "Probation cannot run beyond a year from joining.", "VALIDATION_ERROR");
  const row = await prisma.employeeProbationDecision.create({ data: { employeeId, kind: "EXTENDED", extendedTo: day(until), reason, decidedByUserId: viewer.userId } });
  await writeAuditLog({ ...meta, action: "employee.probation.extended", entityType: "Employee", entityId: employeeId, before: { lastDay: st.lastDay }, after: { decisionId: row.id, lastDay: until, reason } });
  await notifyEmployee(employeeId, { type: "probation.extended", title: `Your probation is extended to ${until}`, body: reason, link: "/app/my-info" });
  return { employeeId, lastDay: until };
}

/** The person's own probation (self). */
export async function mine(employeeId: string) {
  const e = await prisma.employee.findUnique({ where: { id: employeeId }, select: { dateOfJoining: true, probationDecisions: true } });
  if (!e) throw new HttpError(404, "Not found.", "NOT_FOUND");
  const policy = (await policyInForce<{ months: number }>("policy.probation"))!;
  return probationState(iso(e.dateOfJoining), policy.months, e.probationDecisions);
}

/** Daily: tell the reporting manager and HR admins when someone's probation is `reminderDays` from its last day. Returns how many were told about. */
export async function sendProbationReminders(today: Date = businessToday()): Promise<number> {
  const policy = (await policyInForce<{ months: number; reminderDays: number }>("policy.probation"))!;
  const target = iso(addCalendarDays(today, policy.reminderDays));
  const people = await prisma.employee.findMany({
    where: { status: "ACTIVE", probationDecisions: { none: { kind: "CONFIRMED" } } },
    select: { id: true, employeeCode: true, dateOfJoining: true, probationDecisions: true, nameHistory: { where: inForceOn(), select: { fullName: true } }, jobHistory: { where: inForceOn(), select: { reportingManagerId: true } } },
  });
  const hr = await prisma.user.findMany({ where: { status: "ACTIVE", roles: { some: { role: { code: "HR_ADMIN" } } } }, select: { employeeId: true } });
  let told = 0;
  for (const p of people) {
    const st = probationState(iso(p.dateOfJoining), policy.months, p.probationDecisions);
    if (st.lastDay !== target) continue;
    const name = p.nameHistory[0]?.fullName ?? p.employeeCode;
    const to = new Set([p.jobHistory[0]?.reportingManagerId, ...hr.map((h) => h.employeeId)].filter((x): x is string => !!x && x !== p.id));
    for (const id of to) await notifyEmployee(id, { type: "probation.due", title: `${name}'s probation ends on ${st.lastDay}`, body: "Confirm it or extend it on Employee → Probation.", link: "/admin/employee/probation" });
    told += 1;
  }
  return told;
}
