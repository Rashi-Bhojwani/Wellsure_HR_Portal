import type { Prisma } from "@prisma/client";
import { getSocketServer } from "../../realtime/emit";
import { notifyEmployee } from "../notifications/notifyEmployee";
import { storageService } from "../../integrations/storage";
import { createHash } from "node:crypto";
import { createNotification } from "../notifications/service";
import { emitNotificationNew } from "../../realtime/emit";
import { helpdeskAdminPath, helpdeskEmployeePath } from "@shared/constants/helpdesk";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { resolveAccess } from "../../lib/permissions";
import { writeAuditLogs } from "../../lib/audit";
import { HttpError } from "../../middleware/errorHandler";
import type { ActorMeta, HelpdeskViewer } from "./service";

// General desk only. Never materialize Payroll tickets or change their routing.
export const PAYROLL_CATEGORY = "PAYROLL_SALARY";
export const downloadBodySchema = z.object({}).strict();
const missing = () => new HttpError(404, "Category not found.", "NOT_FOUND");
export const visibilitySchema = z.object({
  hrRoleCodes: z.array(z.enum(["HR_ADMIN", "HR_EXECUTIVE"])),
  employeeIds: z.array(z.string().min(1)),
  reason: z.string().trim().min(1).max(2000),
  version: z.number().int().min(0),
}).refine((v) => v.hrRoleCodes.length + v.employeeIds.length > 0, "Choose who can work this category.");
export type VisibilityInput = z.infer<typeof visibilitySchema>;

// Use the existing effective-access resolver, including the Developer ceiling.
// A permission grant by itself can never turn a person into a director.
export async function requireVisibilityDirector(userId: string) {
  const access = await resolveAccess(userId);
  if (!access.isSuperAdmin || !access.permissions.has("helpdesk.visibility.manage")) throw new HttpError(403, "Only a director can set category visibility.", "FORBIDDEN");
}

export async function visibilityPeople() {
  const rows = await prisma.user.findMany({
    where: { status: "ACTIVE", employee: { status: "ACTIVE" } },
    select: { id: true, employeeId: true, employee: { select: { employeeCode: true } } },
  });
  const eligible = await Promise.all(rows.map(async (u) => ({ ...u, access: await resolveAccess(u.id) })));
  return eligible.filter((u) => u.access.permissions.has("helpdesk.manage") && !u.access.roleCodes.includes("DEVELOPER"))
    .map((u) => ({ id: u.employeeId, employeeCode: u.employee.employeeCode, director: u.access.isSuperAdmin }));
}

export async function readVisibility(categoryId: string, viewer: HelpdeskViewer) {
  await requireVisibilityDirector(viewer.userId);
  const category = await prisma.helpdeskCategory.findFirst({ where: { id: categoryId, code: { not: PAYROLL_CATEGORY } }, select: { id: true } });
  if (!category) throw missing();
  const [current, history, people] = await Promise.all([
    prisma.helpdeskCategoryVisibility.findUnique({ where: { categoryId } }),
    prisma.helpdeskCategoryVisibilityHistory.findMany({ where: { categoryId }, orderBy: { version: "desc" } }),
    visibilityPeople(),
  ]);
  return { state: !current ? "LEGACY" : current.configured ? "CONFIGURED" : "NOT_SET", version: current?.version ?? 0, hrRoleCodes: current?.hrRoleCodes ?? [], employeeIds: current?.employeeIds ?? [], history, people };
}

export async function setVisibility(categoryId: string, input: VisibilityInput, viewer: HelpdeskViewer, meta: ActorMeta) {
  await requireVisibilityDirector(viewer.userId);
  const parsed = visibilitySchema.parse(input);
  const eligible = new Set((await visibilityPeople()).map((p) => p.id));
  if (parsed.employeeIds.some((id) => !eligible.has(id))) throw new HttpError(400, "Choose active helpdesk handlers or directors.", "VALIDATION_ERROR");
  await prisma.$transaction(async (tx) => {
    const categories = await tx.$queryRaw<Array<{ id: string; code: string }>>`SELECT id, code FROM helpdesk_categories WHERE id = ${categoryId} AND code <> ${PAYROLL_CATEGORY} FOR UPDATE`;
    const category = categories[0];
    if (!category) throw missing();
    const before = await tx.helpdeskCategoryVisibility.findUnique({ where: { categoryId } });
    if ((before?.version ?? 0) !== parsed.version) throw new HttpError(409, "Visibility changed. Reload it before saving.", "CONFLICT");
    const data = { categoryId, categoryCode: category.code, hrRoleCodes: [...new Set(parsed.hrRoleCodes)], employeeIds: [...new Set(parsed.employeeIds)], configured: true, version: parsed.version + 1, changedByUserId: viewer.userId, changedAt: new Date() };
    await tx.helpdeskCategoryVisibility.upsert({ where: { categoryId }, create: data, update: data });
    const { configured: _configured, ...history } = data;
    await tx.helpdeskCategoryVisibilityHistory.create({ data: { ...history, reason: parsed.reason } });
    await writeAuditLogs([{ ...meta, action: "helpdesk.visibility.changed", entityType: "HelpdeskCategory", entityId: categoryId, before, after: { ...data, reason: parsed.reason } }], tx);
  });
  return readVisibility(categoryId, viewer);
}

// Every helper short-circuits Payroll to the existing service. Queue/Tasks
// filters include its legacy branch without querying any Payroll payload.
type Category = { id: string; code: string; isSensitive: boolean; directorsOnly: boolean };
export async function categoryAudienceWhere(viewer: HelpdeskViewer): Promise<Prisma.HelpdeskCategoryWhereInput> {
  const access = await resolveAccess(viewer.userId);
  if (access.isSuperAdmin) return {};
  return { OR: [
    { code: PAYROLL_CATEGORY },
    { visibility: { is: null } },
    ...(!access.roleCodes.includes("DEVELOPER") ? [{ visibility: { is: { configured: true, OR: [{ employeeIds: { has: viewer.employeeId } }, { hrRoleCodes: { hasSome: access.roleCodes } }] } } }] : []),
  ] };
}
export async function ticketAudienceWhere(viewer: HelpdeskViewer): Promise<Prisma.HelpdeskTicketWhereInput> {
  return { category: await categoryAudienceWhere(viewer) };
}
export async function permitsCategory(category: Category, viewer: HelpdeskViewer): Promise<boolean> {
  if (category.code === PAYROLL_CATEGORY) return true; // Session A decides
  return (await prisma.helpdeskCategory.count({ where: { id: category.id, AND: [await categoryAudienceWhere(viewer)] } })) > 0;
}
export async function requireCategoryReady(category: Pick<Category, "id" | "code">) {
  if (category.code === PAYROLL_CATEGORY) return;
  const row = await prisma.helpdeskCategoryVisibility.findUnique({ where: { categoryId: category.id } });
  if (row && !row.configured) throw new HttpError(409, "This category is not set up yet", "CATEGORY_NOT_SET");
}
async function categoryHandlers(category: Category, raiserEmployeeId?: string) {
  const users = await prisma.user.findMany({ where: { status: "ACTIVE", employee: { status: "ACTIVE" }, ...(raiserEmployeeId && { employeeId: { not: raiserEmployeeId } }) }, select: { id: true, employeeId: true } });
  const allowed = await Promise.all(users.map(async (u) => {
    const a = await resolveAccess(u.id);
    const viewer = { userId: u.id, employeeId: u.employeeId, permissions: a.permissions };
    return a.permissions.has("helpdesk.manage") && !a.roleCodes.includes("DEVELOPER") && (!category.isSensitive || a.permissions.has("helpdesk.sensitive.view")) && (!category.directorsOnly || a.isSuperAdmin) && await permitsCategory(category, viewer) ? u.employeeId : null;
  }));
  return allowed.filter((id): id is string => id !== null);
}
export async function requireVisibleAssignee(category: Category, employeeId?: string | null) {
  if (!employeeId || category.code === PAYROLL_CATEGORY) return;
  if (!(await prisma.helpdeskCategoryVisibility.count({ where: { categoryId: category.id } }))) return;
  if (!(await categoryHandlers(category)).includes(employeeId)) throw new HttpError(400, "Choose a handler who can see this category.", "VALIDATION_ERROR");
}

// Returns false for legacy/Payroll so callers run the existing delivery path.
// Configured-category events never enter a permission room or a stale assignee's room.
export async function deliverConfigured(ticketId: string, opts: { internal?: boolean; includeLegacy?: boolean; notification?: { type: string; title: string; body: string; link: string; payload: Record<string, unknown> }; onlyEmployeeId?: string } = {}): Promise<boolean> {
  const ticket = await prisma.helpdeskTicket.findFirst({ where: { id: ticketId, category: { code: { not: PAYROLL_CATEGORY }, ...(!opts.includeLegacy && { visibility: { isNot: null } }) } }, select: { raisedByEmployeeId: true, category: { select: { id: true, code: true, isSensitive: true, directorsOnly: true } } } });
  if (!ticket) return false;
  const handlers = await categoryHandlers(ticket.category, ticket.raisedByEmployeeId);
  if (opts.notification) for (const id of handlers) {
    if (!opts.onlyEmployeeId || opts.onlyEmployeeId === id) await notifyEmployee(id, opts.notification);
  }
  const io = getSocketServer();
  if (io && handlers.length) io.to(handlers.map((id) => `user:${id}`)).emit("helpdesk.queue");
  const thread = [...handlers, ...(!opts.internal ? [ticket.raisedByEmployeeId] : [])];
  if (io && thread.length) io.to(thread.map((id) => `user:${id}`)).emit("helpdesk.ticket", { ticketId });
  return true;
}
export async function auditDirectorOpen(ticket: { id: string; assigneeEmployeeId: string | null; raisedByEmployeeId: string; category: Category }, viewer: HelpdeskViewer, meta?: ActorMeta) {
  if (!meta || ticket.category.code === PAYROLL_CATEGORY || ticket.raisedByEmployeeId === viewer.employeeId || ticket.assigneeEmployeeId === viewer.employeeId) return;
  if ((await resolveAccess(viewer.userId)).isSuperAdmin) await writeAuditLogs([{ ...meta, action: "helpdesk.ticket.director_opened", entityType: "HelpdeskTicket", entityId: ticket.id }]);
}
export async function categoryAdminVisibility<T extends Category & { ticketCount: number }>(rows: T[], viewer?: HelpdeskViewer) {
  if (!viewer) return rows;
  const audience = await ticketAudienceWhere(viewer);
  const access = await resolveAccess(viewer.userId);
  return Promise.all(rows.map(async (c) => {
    if (c.code === PAYROLL_CATEGORY) return c;
    const visibility = await prisma.helpdeskCategoryVisibility.findUnique({ where: { categoryId: c.id } });
    if (!visibility) return { ...c, visibilityState: "LEGACY" };
    const ticketCount = await prisma.helpdeskTicket.count({ where: { categoryId: c.id, OR: [ { raisedByEmployeeId: viewer.employeeId }, { AND: [audience, ...(!viewer.permissions.has("helpdesk.manage") || (c.isSensitive && !viewer.permissions.has("helpdesk.sensitive.view")) || (c.directorsOnly && !access.isSuperAdmin) ? [{ id: { in: [] as string[] } }] : [])] } ] } });
    return { ...c, ticketCount, visibilityState: visibility.configured ? "CONFIGURED" : "NOT_SET" };
  }));
}

// Persisted notifications also lose visibility after moves/settings/role changes.
// Apply this WHERE before pagination and both counters, not as a UI filter.
export async function notificationAudienceWhere(userId: string): Promise<Prisma.NotificationWhereInput> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { employeeId: true } });
  if (!user) return {};
  const access = await resolveAccess(userId);
  const viewer = { userId, employeeId: user.employeeId, permissions: access.permissions };
  const categories = await prisma.helpdeskCategory.findMany({ where: { code: { not: PAYROLL_CATEGORY }, visibility: { isNot: null } }, select: { id: true, code: true, isSensitive: true, directorsOnly: true } });
  const hidden: string[] = [];
  for (const c of categories) if (!access.permissions.has("helpdesk.manage") || (c.isSensitive && !access.permissions.has("helpdesk.sensitive.view")) || (c.directorsOnly && !access.isSuperAdmin) || !(await permitsCategory(c, viewer))) hidden.push(c.id);
  if (!hidden.length) return {};
  const tickets = await prisma.helpdeskTicket.findMany({ where: { categoryId: { in: hidden }, raisedByEmployeeId: { not: user.employeeId } }, select: { id: true } });
  if (!tickets.length) return {};
  return { NOT: { type: { startsWith: "helpdesk." }, OR: tickets.map((t) => ({ payload: { path: ["ticketId"], equals: t.id } })) } };
}

// Authenticated content endpoint. No storage bearer URL is issued for a
// configured category; every byte request checks the current category again.
export async function configuredDownload(attachmentId: string, viewer: HelpdeskViewer, meta?: ActorMeta) {
  const access = await resolveAccess(viewer.userId);
  if (access.roleCodes.includes("DEVELOPER")) throw new HttpError(403, "Helpdesk downloads are unavailable to Developer.", "FORBIDDEN");
  const a = await prisma.helpdeskAttachment.findFirst({ where: { id: attachmentId, message: { ticket: { category: { code: { not: PAYROLL_CATEGORY }, visibility: { isNot: null } } } } }, include: { message: { include: { ticket: { include: { category: true } } } } } });
  if (!a) throw new HttpError(404, "Attachment not found.", "NOT_FOUND");
  const t = a.message.ticket;
  const raiser = t.raisedByEmployeeId === viewer.employeeId;
  if (raiser ? a.message.isInternalNote : !access.permissions.has("helpdesk.manage") || (t.category.isSensitive && !access.permissions.has("helpdesk.sensitive.view")) || (t.category.directorsOnly && !access.isSuperAdmin) || !(await permitsCategory(t.category, viewer))) throw new HttpError(404, "Attachment not found.", "NOT_FOUND");
  await auditDirectorOpen(t, viewer, meta);
  return { ...(await storageService.getObject(a.fileKey)), fileName: a.fileName };
}
export async function downloadDescriptor(attachmentId: string, category: Category) {
  if (category.code === PAYROLL_CATEGORY || !(await prisma.helpdeskCategoryVisibility.count({ where: { categoryId: category.id } }))) return null;
  return { url: `/api/helpdesk/attachments/${encodeURIComponent(attachmentId)}/content`, guarded: true };
}

export const moveSchema = z.object({
  targetCategoryId: z.string().min(1),
  reason: z.string().trim().min(1).max(2000),
  idempotencyKey: z.string().uuid(),
});
const ticketMissing = () => new HttpError(404, "Ticket not found.", "NOT_FOUND");
export async function moveTicket(ticketId: string, input: z.infer<typeof moveSchema>, viewer: HelpdeskViewer, meta: ActorMeta) {
  const access = await resolveAccess(viewer.userId);
  if (access.roleCodes.includes("DEVELOPER") || !access.permissions.has("helpdesk.manage")) throw new HttpError(403, "Only helpdesk handlers can move tickets.", "FORBIDDEN");
  const parsed = moveSchema.parse(input);
  const requestHash = createHash("sha256").update(JSON.stringify({ ticketId, targetCategoryId: parsed.targetCategoryId, reason: parsed.reason })).digest("hex");
  const result = await prisma.$transaction(async (tx) => {
    // Serializes retries even when the same actor/key is sent for different
    // tickets. The unique index remains a database-level backstop.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${viewer.userId}), hashtext(${parsed.idempotencyKey}))::text`;
    const prior = await tx.helpdeskCategoryMove.findUnique({ where: { actorUserId_idempotencyKey: { actorUserId: viewer.userId, idempotencyKey: parsed.idempotencyKey } } });
    if (prior) {
      if (prior.requestHash !== requestHash) throw new HttpError(409, "This move key was already used for a different request.", "CONFLICT");
      return { receipt: { id: prior.id, ticketId: prior.ticketId, moved: true }, notices: [], category: null, raiser: null };
    }
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT t.id FROM helpdesk_tickets t JOIN helpdesk_categories c ON c.id = t.category_id WHERE t.id = ${ticketId} AND c.code <> ${PAYROLL_CATEGORY} FOR UPDATE OF t`;
    if (!locked.length) throw ticketMissing();
    const ticket = await tx.helpdeskTicket.findUniqueOrThrow({ where: { id: ticketId }, include: { category: true } });
    if (ticket.raisedByEmployeeId === viewer.employeeId || (ticket.category.isSensitive && !access.permissions.has("helpdesk.sensitive.view")) || (ticket.category.directorsOnly && !access.isSuperAdmin) || !(await permitsCategory(ticket.category, viewer))) throw ticketMissing();
    const target = await tx.helpdeskCategory.findFirst({ where: { id: parsed.targetCategoryId, code: { not: PAYROLL_CATEGORY }, isActive: true } });
    if (!target) throw missing();
    if (target.id === ticket.categoryId) throw new HttpError(409, "Choose another category.", "CONFLICT");
    await requireCategoryReady(target);
    const move = await tx.helpdeskCategoryMove.create({ data: { ticketId, sourceCategoryId: ticket.categoryId, targetCategoryId: target.id, sourceCategoryCode: ticket.category.code, targetCategoryCode: target.code, actorUserId: viewer.userId, idempotencyKey: parsed.idempotencyKey, requestHash, reason: parsed.reason } });
    await tx.helpdeskMessage.create({ data: { ticketId, authorEmployeeId: viewer.employeeId, body: "Your ticket was moved to another team.", isSystem: true } });
    await tx.helpdeskTicket.update({ where: { id: ticketId }, data: { categoryId: target.id, assigneeEmployeeId: null, lastActivityAt: new Date() } });
    await writeAuditLogs([{ ...meta, actorUserId: viewer.userId, action: "helpdesk.ticket.moved", entityType: "HelpdeskTicket", entityId: ticketId, before: { categoryId: ticket.categoryId, assigneeEmployeeId: ticket.assigneeEmployeeId }, after: { categoryId: target.id, reason: parsed.reason, moveId: move.id } }], tx);
    const handlers = await categoryHandlers(target, ticket.raisedByEmployeeId);
    const users = await tx.user.findMany({ where: { employeeId: { in: [...handlers, ticket.raisedByEmployeeId] }, status: "ACTIVE" }, select: { id: true, employeeId: true } });
    const notices = [];
    for (const user of users) {
      const raiser = user.employeeId === ticket.raisedByEmployeeId;
      const notification = await createNotification({ userId: user.id, type: "helpdesk.moved", title: raiser ? "Ticket moved" : "A ticket moved to your team", body: raiser ? "Your ticket was moved to another team." : ticket.subject, link: raiser ? helpdeskEmployeePath(ticketId) : helpdeskAdminPath(ticketId), payload: { ticketId } }, tx);
      notices.push({ employeeId: user.employeeId, notification });
    }
    return { receipt: { id: move.id, ticketId, moved: true }, notices, category: target, raiser: ticket.raisedByEmployeeId };
  }, { timeout: 30_000 });
  if (result.category) {
    const visible = new Set([...await categoryHandlers(result.category, result.raiser!), result.raiser!]);
    for (const { employeeId, notification: n } of result.notices) if (visible.has(employeeId)) emitNotificationNew(employeeId, { id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, createdAt: n.createdAt.toISOString() });
    await deliverConfigured(ticketId, { includeLegacy: true });
  }
  return result.receipt;
}
