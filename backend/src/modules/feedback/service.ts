import { z } from "zod";
import type { DataScope } from "../../lib/dataScope";
import { buildEmployeeScopeWhere } from "../../lib/dataScope";
import { writeAuditLog } from "../../lib/audit";
import { inForceOn } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { notifyEmployee } from "../notifications/notifyEmployee";
import { policyInForce } from "../policySettings/service";

// M session block 2, SS-13: feedback and suggestions from employees to HR (helpdesk.manage reads them). Named feedback can be answered and the sender
// sees the replies; anonymous feedback (allowed by default, policy.feedback) stores no author and writes no audit row naming the sender, so nothing in
// the system links it to a person. Closing and replying are audited.

export const CATEGORIES = ["SUGGESTION", "APPRECIATION", "CONCERN", "OTHER"] as const;
export const sendBody = z.object({ category: z.enum(CATEGORIES), message: z.string().trim().min(5).max(2000), anonymous: z.boolean().default(false) }).strict();
export const replyBody = z.object({ message: z.string().trim().min(2).max(2000) }).strict();
export const listQuery = z.object({ status: z.enum(["OPEN", "CLOSED"]).default("OPEN") }).strict();

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

export async function options() {
  return { anonymousAllowed: ((await policyInForce<{ anonymousAllowed: boolean }>("policy.feedback"))!).anonymousAllowed, categories: CATEGORIES };
}

export async function send(employeeId: string, input: z.infer<typeof sendBody>, meta: ActorMeta) {
  if (input.anonymous && !(await options()).anonymousAllowed) throw new HttpError(400, "Feedback without a name is switched off. Send it with your name.", "ANONYMOUS_OFF");
  const row = await prisma.employeeFeedback.create({ data: { authorEmployeeId: input.anonymous ? null : employeeId, category: input.category, message: input.message } });
  // Anonymous: no audit row (it would carry the sender's account and address). Named: audited as usual.
  if (!input.anonymous) await writeAuditLog({ ...meta, action: "feedback.sent", entityType: "EmployeeFeedback", entityId: row.id, after: { category: input.category } });
  return { id: row.id, anonymous: input.anonymous };
}

export async function mine(employeeId: string) {
  const rows = await prisma.employeeFeedback.findMany({ where: { authorEmployeeId: employeeId }, include: { replies: { orderBy: { createdAt: "asc" } } }, orderBy: { createdAt: "desc" }, take: 100 });
  return rows.map((r) => ({ id: r.id, category: r.category, message: r.message, status: r.status, createdAt: r.createdAt.toISOString(), replies: r.replies.map((x) => ({ message: x.message, at: x.createdAt.toISOString() })) }));
}

/** HR's list: anonymous feedback, and named feedback from people in the viewer's data scope. */
export async function list(viewer: Viewer, status: "OPEN" | "CLOSED") {
  const scope = await buildEmployeeScopeWhere(viewer.employeeId, viewer.dataScope);
  const inScope = viewer.dataScope === "ALL" ? null : (await prisma.employee.findMany({ where: scope, select: { id: true } })).map((x) => x.id);
  const rows = await prisma.employeeFeedback.findMany({
    where: { status, ...(inScope ? { OR: [{ authorEmployeeId: null }, { authorEmployeeId: { in: inScope } }] } : {}) },
    include: { author: { select: { employeeCode: true, nameHistory: { where: inForceOn(), select: { fullName: true } } } }, replies: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  return rows.map((r) => ({ id: r.id, category: r.category, message: r.message, status: r.status, createdAt: r.createdAt.toISOString(), from: r.author ? { employeeCode: r.author.employeeCode, fullName: r.author.nameHistory[0]?.fullName ?? r.author.employeeCode } : null, replies: r.replies.map((x) => ({ message: x.message, at: x.createdAt.toISOString() })) }));
}

async function loadVisible(id: string, viewer: Viewer) {
  const r = await prisma.employeeFeedback.findUnique({ where: { id } });
  if (!r) throw new HttpError(404, "Not found.", "NOT_FOUND");
  if (r.authorEmployeeId) {
    if (r.authorEmployeeId === viewer.employeeId) throw new HttpError(404, "Not found.", "NOT_FOUND");
    const scope = await buildEmployeeScopeWhere(viewer.employeeId, viewer.dataScope);
    if (!(await prisma.employee.findFirst({ where: { AND: [{ id: r.authorEmployeeId }, scope] }, select: { id: true } }))) throw new HttpError(404, "Not found.", "NOT_FOUND");
  }
  return r;
}

export async function reply(id: string, message: string, viewer: Viewer, meta: ActorMeta) {
  const r = await loadVisible(id, viewer);
  if (!r.authorEmployeeId) throw new HttpError(409, "This feedback was sent without a name, so it cannot be answered.", "ANONYMOUS");
  if (r.status === "CLOSED") throw new HttpError(409, "This feedback is closed.", "CLOSED");
  await prisma.employeeFeedbackReply.create({ data: { feedbackId: id, authorUserId: viewer.userId, message } });
  await writeAuditLog({ ...meta, action: "feedback.replied", entityType: "EmployeeFeedback", entityId: id });
  await notifyEmployee(r.authorEmployeeId, { type: "feedback.replied", title: "HR replied to your feedback", body: message.slice(0, 140), link: "/app/my-worklife/feedback" });
  return { id };
}

export async function close(id: string, viewer: Viewer, meta: ActorMeta) {
  const r = await loadVisible(id, viewer);
  if (r.status === "CLOSED") return { id, status: "CLOSED" as const };
  await prisma.employeeFeedback.update({ where: { id }, data: { status: "CLOSED", closedByUserId: viewer.userId } });
  await writeAuditLog({ ...meta, action: "feedback.closed", entityType: "EmployeeFeedback", entityId: id });
  return { id, status: "CLOSED" as const };
}
