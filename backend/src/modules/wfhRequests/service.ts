import { z } from "zod";
import { writeAuditLog } from "../../lib/audit";
import { addCalendarDays, businessToday } from "../../lib/businessDate";
import { activeDirectors, isDirector } from "../../lib/directorAuthority";
import { inForceOn } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { isRemoteOn, markRemote } from "../attendance/remote/service";
import { notifyEmployee } from "../notifications/notifyEmployee";
import { policyInForce } from "../policySettings/service";

// M session block 2, AT-36: work-from-home requests. Off until two directors turn it on (policy.wfh). An employee whose current department is listed
// (or anyone, when the list is empty) asks for consecutive days ahead, at most the setting's days in one request. A director (never on their own
// request) approves: the days become remote days through the existing remote-work marks (the director path in attendance/remote, audited there),
// and if the person was not already remote on the day after, a mark ends it then. Remote days are then checked in and out as today.

type WfhPolicy = { active: true; departments: string[]; maxDaysPerRequest: number };
export interface ActorMeta {
  actorUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
export const askBody = z.object({ fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().trim().min(3).max(300) }).strict();
export const rejectBody = z.object({ note: z.string().trim().min(3).max(300) }).strict();
export const listQuery = z.object({ status: z.enum(["PENDING", "APPROVED", "REJECTED"]).default("PENDING") }).strict();

async function eligibility(employeeId: string): Promise<{ policy: WfhPolicy | null; eligible: boolean }> {
  const policy = await policyInForce<WfhPolicy>("policy.wfh");
  if (!policy) return { policy: null, eligible: false };
  if (!policy.departments.length) return { policy, eligible: true };
  const job = await prisma.employeeJobHistory.findFirst({ where: { employeeId, ...inForceOn() }, select: { department: { select: { code: true } } } });
  return { policy, eligible: !!job && policy.departments.includes(job.department.code) };
}

export async function mine(employeeId: string) {
  const { policy, eligible } = await eligibility(employeeId);
  const rows = policy ? await prisma.wfhRequest.findMany({ where: { employeeId }, orderBy: { createdAt: "desc" }, take: 50 }) : [];
  return { active: !!policy, eligible, maxDaysPerRequest: policy?.maxDaysPerRequest ?? null, requests: rows.map((r) => ({ id: r.id, fromDate: iso(r.fromDate), toDate: iso(r.toDate), reason: r.reason, status: r.status, decisionNote: r.decisionNote })) };
}

export async function ask(employeeId: string, input: z.infer<typeof askBody>, meta: ActorMeta) {
  const { policy, eligible } = await eligibility(employeeId);
  if (!policy) throw new HttpError(409, "Work-from-home requests are not in use.", "WFH_OFF");
  if (!eligible) throw new HttpError(403, "Your department is not one that may ask to work from home.", "NOT_ELIGIBLE");
  if (input.toDate < input.fromDate) throw new HttpError(400, "The last day is before the first.", "VALIDATION_ERROR");
  if (input.fromDate <= iso(businessToday())) throw new HttpError(400, "Ask for days from tomorrow on.", "VALIDATION_ERROR");
  const days = Math.round((day(input.toDate).getTime() - day(input.fromDate).getTime()) / 86_400_000) + 1; // allow-number: a day in ms
  if (days > policy.maxDaysPerRequest) throw new HttpError(400, `At most ${policy.maxDaysPerRequest} day(s) in one request.`, "TOO_MANY_DAYS");
  const overlap = await prisma.wfhRequest.findFirst({ where: { employeeId, status: { in: ["PENDING", "APPROVED"] }, fromDate: { lte: day(input.toDate) }, toDate: { gte: day(input.fromDate) } }, select: { id: true } });
  if (overlap) throw new HttpError(409, "You already asked for some of these days.", "OVERLAP");
  const row = await prisma.wfhRequest.create({ data: { employeeId, fromDate: day(input.fromDate), toDate: day(input.toDate), reason: input.reason } });
  await writeAuditLog({ ...meta, action: "attendance.wfh.asked", entityType: "WfhRequest", entityId: row.id, after: { fromDate: input.fromDate, toDate: input.toDate } });
  for (const d of await activeDirectors()) if (d.employeeId !== employeeId) await notifyEmployee(d.employeeId, { type: "wfh.asked", title: "A work-from-home request waits for you", body: `${input.fromDate} to ${input.toDate}`, link: "/admin/workforce/attendance/wfh-requests" });
  return { id: row.id };
}

export async function withdraw(id: string, employeeId: string, meta: ActorMeta) {
  const r = await prisma.wfhRequest.findUnique({ where: { id } });
  if (!r || r.employeeId !== employeeId) throw new HttpError(404, "Not found.", "NOT_FOUND");
  if (r.status !== "PENDING") throw new HttpError(409, "Already decided.", "ALREADY_DECIDED");
  await prisma.wfhRequest.update({ where: { id }, data: { status: "WITHDRAWN", decidedAt: new Date(), decidedByUserId: meta.actorUserId } });
  await writeAuditLog({ ...meta, action: "attendance.wfh.withdrawn", entityType: "WfhRequest", entityId: id });
  return { id, status: "WITHDRAWN" as const };
}

async function directorOnly(userId: string) {
  if (!(await isDirector(userId))) throw new HttpError(403, "A director decides work-from-home requests.", "FORBIDDEN");
}

export async function list(userId: string, employeeId: string, status: "PENDING" | "APPROVED" | "REJECTED") {
  await directorOnly(userId);
  const rows = await prisma.wfhRequest.findMany({ where: { status, employeeId: { not: employeeId } }, include: { employee: { select: { employeeCode: true, nameHistory: { where: inForceOn(), select: { fullName: true } } } } }, orderBy: { fromDate: "asc" }, take: 300 });
  return rows.map((r) => ({ id: r.id, employeeId: r.employeeId, employeeCode: r.employee.employeeCode, fullName: r.employee.nameHistory[0]?.fullName ?? r.employee.employeeCode, fromDate: iso(r.fromDate), toDate: iso(r.toDate), reason: r.reason, status: r.status, decisionNote: r.decisionNote }));
}

async function loadPending(id: string, userId: string, employeeId: string) {
  await directorOnly(userId);
  const r = await prisma.wfhRequest.findUnique({ where: { id } });
  if (!r || r.employeeId === employeeId) throw new HttpError(404, "Not found.", "NOT_FOUND");
  if (r.status !== "PENDING") throw new HttpError(409, "Already decided.", "ALREADY_DECIDED");
  return r;
}

export async function approve(id: string, userId: string, employeeId: string, meta: ActorMeta) {
  const r = await loadPending(id, userId, employeeId);
  if (!(await policyInForce("policy.wfh"))) throw new HttpError(409, "Work-from-home requests are not in use.", "WFH_OFF");
  const after = iso(addCalendarDays(r.toDate, 1));
  const remoteAfter = await isRemoteOn(r.employeeId, after);
  const claimed = await prisma.wfhRequest.updateMany({ where: { id, status: "PENDING" }, data: { status: "APPROVED", decidedByUserId: userId, decidedAt: new Date() } });
  if (!claimed.count) throw new HttpError(409, "Already decided.", "ALREADY_DECIDED");
  const actor = { userId, ip: meta.ipAddress ?? null };
  await markRemote({ employeeId: r.employeeId, effectiveFrom: iso(r.fromDate), remote: true, reason: `Work-from-home request approved (${iso(r.fromDate)} to ${iso(r.toDate)})` }, actor);
  if (!remoteAfter) await markRemote({ employeeId: r.employeeId, effectiveFrom: after, remote: false, reason: "End of an approved work-from-home request" }, actor);
  await writeAuditLog({ ...meta, action: "attendance.wfh.approved", entityType: "WfhRequest", entityId: id });
  return { id, status: "APPROVED" as const };
}

export async function reject(id: string, note: string, userId: string, employeeId: string, meta: ActorMeta) {
  const r = await loadPending(id, userId, employeeId);
  const done = await prisma.wfhRequest.updateMany({ where: { id, status: "PENDING" }, data: { status: "REJECTED", decidedByUserId: userId, decidedAt: new Date(), decisionNote: note } });
  if (!done.count) throw new HttpError(409, "Already decided.", "ALREADY_DECIDED");
  await writeAuditLog({ ...meta, action: "attendance.wfh.rejected", entityType: "WfhRequest", entityId: id, after: { reason: note } });
  await notifyEmployee(r.employeeId, { type: "wfh.rejected", title: "Your work-from-home request was not approved", body: note, link: "/app/attendance/wfh" });
  return { id, status: "REJECTED" as const };
}
