import { Prisma } from "@prisma/client";
import { z } from "zod";
import { writeAuditLog } from "../../lib/audit";
import { businessToday } from "../../lib/businessDate";
import { activeDirectors, isDirector } from "../../lib/directorAuthority";
import { inForceOn } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { getLeaveBalance } from "../leave/ledger";
import { notifyEmployee } from "../notifications/notifyEmployee";
import { policyInForce } from "../policySettings/service";

// M session block 2, LV-23: encashment requests during the year. Off until two directors turn it on (policy.encashmentRequests). For a listed leave
// type, an employee asks to encash whole or half days, keeping at least the minimum balance and within the most days a year (both counting what
// is already asked or approved this year). A director approves (never their own). The approved days then wait for payroll: paying them and recording
// them in the leave ledger is payroll's (a request to Session A). No amount is worked out here: the encashment rate is an open owner question.

type EncPolicy = { active: true; leaveTypes: string[]; keepAtLeast: number; maxDaysPerYear: number };
export interface ActorMeta {
  actorUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}
export const askBody = z.object({ leaveTypeCode: z.string().min(1).max(40), days: z.number().positive().max(60).refine((d) => Number.isInteger(d * 2), "Whole or half days"), reason: z.string().trim().max(300).default("") }).strict();
export const rejectBody = z.object({ note: z.string().trim().min(3).max(300) }).strict();
export const listQuery = z.object({ status: z.enum(["PENDING", "APPROVED", "REJECTED"]).default("PENDING") }).strict();

const year = () => businessToday().getUTCFullYear();

async function reserved(employeeId: string, leaveTypeId: string, leaveYear: number): Promise<Prisma.Decimal> {
  const r = await prisma.leaveEncashmentRequest.aggregate({ where: { employeeId, leaveTypeId, leaveYear, status: { in: ["PENDING", "APPROVED"] } }, _sum: { days: true } });
  return r._sum.days ?? new Prisma.Decimal(0);
}

export async function mine(employeeId: string) {
  const policy = await policyInForce<EncPolicy>("policy.encashmentRequests");
  if (!policy) return { active: false as const, types: [], requests: [] };
  const types = await prisma.leaveType.findMany({ where: { code: { in: policy.leaveTypes }, isActive: true }, select: { id: true, code: true, name: true } });
  const out = [];
  for (const t of types) {
    const [balance, held] = await Promise.all([getLeaveBalance(prisma, employeeId, t.id), reserved(employeeId, t.id, year())]);
    const room = Prisma.Decimal.min(balance.minus(held).minus(policy.keepAtLeast), new Prisma.Decimal(policy.maxDaysPerYear).minus(held));
    out.push({ code: t.code, name: t.name, balance: balance.toNumber(), askedThisYear: held.toNumber(), mayAsk: Math.max(0, Math.floor(room.toNumber() * 2) / 2) });
  }
  const rows = await prisma.leaveEncashmentRequest.findMany({ where: { employeeId }, include: { leaveType: { select: { code: true } } }, orderBy: { createdAt: "desc" }, take: 50 });
  return { active: true as const, keepAtLeast: policy.keepAtLeast, maxDaysPerYear: policy.maxDaysPerYear, types: out, requests: rows.map((r) => ({ id: r.id, leaveTypeCode: r.leaveType.code, days: r.days.toNumber(), status: r.status, decisionNote: r.decisionNote, createdAt: r.createdAt.toISOString() })) };
}

export async function ask(employeeId: string, input: z.infer<typeof askBody>, meta: ActorMeta) {
  const policy = await policyInForce<EncPolicy>("policy.encashmentRequests");
  if (!policy) throw new HttpError(409, "Encashment requests are not in use.", "ENCASHMENT_OFF");
  if (!policy.leaveTypes.includes(input.leaveTypeCode)) throw new HttpError(400, "This leave type cannot be encashed during the year.", "NOT_ENCASHABLE");
  const type = await prisma.leaveType.findUnique({ where: { code: input.leaveTypeCode }, select: { id: true } });
  if (!type) throw new HttpError(400, "No such leave type.", "NOT_ENCASHABLE");
  const [balance, held] = await Promise.all([getLeaveBalance(prisma, employeeId, type.id), reserved(employeeId, type.id, year())]);
  const days = new Prisma.Decimal(input.days);
  if (held.plus(days).greaterThan(policy.maxDaysPerYear)) throw new HttpError(400, `At most ${policy.maxDaysPerYear} day(s) a year; ${held.toString()} already asked or approved.`, "OVER_YEAR_LIMIT");
  if (balance.minus(held).minus(days).lessThan(policy.keepAtLeast)) throw new HttpError(400, `At least ${policy.keepAtLeast} day(s) must remain after encashment.`, "KEEP_MINIMUM");
  const row = await prisma.leaveEncashmentRequest.create({ data: { employeeId, leaveTypeId: type.id, leaveYear: year(), days, reason: input.reason } });
  await writeAuditLog({ ...meta, action: "leave.encashment.asked", entityType: "LeaveEncashmentRequest", entityId: row.id, after: { leaveType: input.leaveTypeCode, days: input.days } });
  for (const d of await activeDirectors()) if (d.employeeId !== employeeId) await notifyEmployee(d.employeeId, { type: "encashment.asked", title: "An encashment request waits for you", body: `${input.days} day(s) of ${input.leaveTypeCode}`, link: "/admin/workforce/leave/encashment-requests" });
  return { id: row.id };
}

export async function withdraw(id: string, employeeId: string, meta: ActorMeta) {
  const r = await prisma.leaveEncashmentRequest.findUnique({ where: { id } });
  if (!r || r.employeeId !== employeeId) throw new HttpError(404, "Not found.", "NOT_FOUND");
  if (r.status !== "PENDING") throw new HttpError(409, "Already decided.", "ALREADY_DECIDED");
  await prisma.leaveEncashmentRequest.update({ where: { id }, data: { status: "WITHDRAWN", decidedAt: new Date(), decidedByUserId: meta.actorUserId } });
  await writeAuditLog({ ...meta, action: "leave.encashment.withdrawn", entityType: "LeaveEncashmentRequest", entityId: id });
  return { id, status: "WITHDRAWN" as const };
}

async function directorOnly(userId: string) {
  if (!(await isDirector(userId))) throw new HttpError(403, "A director decides encashment requests.", "FORBIDDEN");
}

export async function list(userId: string, employeeId: string, status: "PENDING" | "APPROVED" | "REJECTED") {
  await directorOnly(userId);
  const rows = await prisma.leaveEncashmentRequest.findMany({ where: { status, employeeId: { not: employeeId } }, include: { leaveType: { select: { code: true } }, employee: { select: { employeeCode: true, nameHistory: { where: inForceOn(), select: { fullName: true } } } } }, orderBy: { createdAt: "asc" }, take: 300 });
  return rows.map((r) => ({ id: r.id, employeeId: r.employeeId, employeeCode: r.employee.employeeCode, fullName: r.employee.nameHistory[0]?.fullName ?? r.employee.employeeCode, leaveTypeCode: r.leaveType.code, leaveYear: r.leaveYear, days: r.days.toNumber(), reason: r.reason, status: r.status, decisionNote: r.decisionNote }));
}

async function loadPending(id: string, userId: string, employeeId: string) {
  await directorOnly(userId);
  const r = await prisma.leaveEncashmentRequest.findUnique({ where: { id } });
  if (!r || r.employeeId === employeeId) throw new HttpError(404, "Not found.", "NOT_FOUND");
  if (r.status !== "PENDING") throw new HttpError(409, "Already decided.", "ALREADY_DECIDED");
  return r;
}

export async function decide(id: string, approve: boolean, note: string | null, userId: string, employeeId: string, meta: ActorMeta) {
  const r = await loadPending(id, userId, employeeId);
  if (approve) {
    // The balance may have moved since the ask: it must still leave the minimum (other waiting requests of the same person counted).
    const policy = await policyInForce<EncPolicy>("policy.encashmentRequests");
    if (!policy) throw new HttpError(409, "Encashment requests are not in use.", "ENCASHMENT_OFF");
    const others = (await reserved(r.employeeId, r.leaveTypeId, r.leaveYear)).minus(r.days);
    if ((await getLeaveBalance(prisma, r.employeeId, r.leaveTypeId)).minus(others).minus(r.days).lessThan(policy.keepAtLeast)) throw new HttpError(409, "The balance no longer leaves the minimum after this encashment.", "KEEP_MINIMUM");
  }
  const done = await prisma.leaveEncashmentRequest.updateMany({ where: { id, status: "PENDING" }, data: { status: approve ? "APPROVED" : "REJECTED", decidedByUserId: userId, decidedAt: new Date(), decisionNote: note } });
  if (!done.count) throw new HttpError(409, "Already decided.", "ALREADY_DECIDED");
  await writeAuditLog({ ...meta, action: approve ? "leave.encashment.approved" : "leave.encashment.rejected", entityType: "LeaveEncashmentRequest", entityId: id, ...(note ? { after: { note } } : {}) });
  await notifyEmployee(r.employeeId, { type: approve ? "encashment.approved" : "encashment.rejected", title: approve ? "Your encashment request is approved: it is paid with payroll" : "Your encashment request was not approved", body: note ?? `${r.days.toString()} day(s)`, link: "/app/leave/encashment" });
  return { id, status: approve ? ("APPROVED" as const) : ("REJECTED" as const) };
}
