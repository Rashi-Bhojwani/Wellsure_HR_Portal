import { randomUUID } from "node:crypto";
import path from "node:path";
import { Prisma, type HelpdeskPriority, type HelpdeskTicketStatus } from "@prisma/client";
import { formatTicketNumber, helpdeskAdminPath, helpdeskEmployeePath } from "@shared/constants/helpdesk";
import { storageService } from "../../integrations/storage";
import { writeAuditLog } from "../../lib/audit";
import { autoCloseAt, getHelpdeskSettings, reopenUntil, type HelpdeskSettings } from "../../lib/helpdeskSettings";
import { getPeopleDocumentsSettings } from "../../lib/peopleDocumentsSettings";
import { prisma } from "../../lib/prisma";
import { prepareDocumentUpload } from "../../lib/uploads";
import { HttpError } from "../../middleware/errorHandler";
import { emitHelpdeskQueue, emitHelpdeskTicket } from "../../realtime/emit";
import { activeDirectors, isDirector } from "../../lib/directorAuthority";
import { notifyEmployee } from "../notifications/notifyEmployee";
import { inForceOn } from "../../lib/effectiveDating";

// Helpdesk (spec §6 "raise ticket to HR by category, track status,
// chat-style replies"), Phase 5 commit D.
//
// Two views of a ticket, and every read/write goes through exactly one of
// them:
//   - the RAISER's view: their own tickets only; internal notes (and their
//     attachments) are filtered out here, server-side, never just hidden;
//   - the HR view: needs helpdesk.manage, plus helpdesk.sensitive.view for
//     categories flagged sensitive; never on a ticket you raised yourself
//     (no one handles their own grievance).
// Anything else — another employee's ticket, a sensitive one without the
// permission — reads as 404, never confirming it exists.

export interface HelpdeskViewer {
  userId: string;
  employeeId: string;
  permissions: Set<string>;
}

export interface ActorMeta {
  actorUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const notFound = () => new HttpError(404, "Ticket not found.", "NOT_FOUND");
const DOWNLOAD_URL_TTL_SECONDS = 60;
export const MAX_ATTACHMENTS_PER_MESSAGE = 3;

const canManage = (v: HelpdeskViewer) => v.permissions.has("helpdesk.manage");
const canSeeSensitive = (v: HelpdeskViewer) => v.permissions.has("helpdesk.sensitive.view");

// Prisma filter for the tickets an HR viewer may see in the queue.
// A directors-only category (Payroll & Salary) is visible to directors alone, whatever else the viewer holds.
function hrVisibleWhere(viewer: HelpdeskViewer, director: boolean): Prisma.HelpdeskTicketWhereInput {
  return {
    raisedByEmployeeId: { not: viewer.employeeId },
    category: { ...(!canSeeSensitive(viewer) && { isSensitive: false }), ...(!director && { directorsOnly: false }) },
  };
}

const nameSelect = () => ({ id: true, employeeCode: true, nameHistory: { where: inForceOn(), select: { fullName: true } } }) as const;
const personRef = (p: { id: string; employeeCode: string; nameHistory: { fullName: string }[] } | null) =>
  p ? { id: p.id, employeeCode: p.employeeCode, name: p.nameHistory[0]?.fullName ?? p.employeeCode } : null;

const ticketInclude = () => ({
  category: { select: { id: true, code: true, name: true, isSensitive: true, directorsOnly: true } },
  raisedBy: { select: nameSelect() },
  assignee: { select: nameSelect() },
}) as const;
type TicketRow = Prisma.HelpdeskTicketGetPayload<{ include: ReturnType<typeof ticketInclude> }>;

// The employee is always told when a Resolved ticket will close and until
// when they can reopen it — the same dates the auto-close job uses.
function lifecycleDates(row: { status: HelpdeskTicketStatus; resolvedAt: Date | null }, settings: HelpdeskSettings) {
  if (!row.resolvedAt || (row.status !== "RESOLVED" && row.status !== "CLOSED")) return { autoClosesAt: null, reopenUntil: null };
  return {
    autoClosesAt: row.status === "RESOLVED" ? autoCloseAt(row.resolvedAt, settings).toISOString() : null,
    reopenUntil: reopenUntil(row.resolvedAt, settings).toISOString(),
  };
}

function formatTicket(row: TicketRow, settings: HelpdeskSettings) {
  return {
    id: row.id,
    number: formatTicketNumber(row.number),
    subject: row.subject,
    category: row.category,
    priority: row.priority,
    status: row.status,
    raisedBy: personRef(row.raisedBy),
    assignee: personRef(row.assignee),
    createdAt: row.createdAt.toISOString(),
    lastActivityAt: row.lastActivityAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    ...lifecycleDates(row, settings),
  };
}

// ── Categories ────────────────────────────────────────────────────────

export async function listActiveCategories() {
  return prisma.helpdeskCategory.findMany({
    where: { isActive: true },
    select: { id: true, code: true, name: true, isSensitive: true, directorsOnly: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function listAllCategories() {
  const rows = await prisma.helpdeskCategory.findMany({
    include: { defaultAssignee: { select: nameSelect() }, _count: { select: { tickets: true } } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return rows.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    isSensitive: c.isSensitive,
    directorsOnly: c.directorsOnly,
    isActive: c.isActive,
    sortOrder: c.sortOrder,
    defaultAssignee: personRef(c.defaultAssignee),
    ticketCount: c._count.tickets,
  }));
}

async function assertAssignable(employeeId: string | null | undefined, directorsOnly = false) {
  if (!employeeId) return;
  const assignees = await listAssignees();
  if (!assignees.some((a) => a.id === employeeId)) {
    throw new HttpError(400, "That person can't be assigned helpdesk tickets.", "VALIDATION_ERROR");
  }
  if (directorsOnly && !(await activeDirectors()).some((d) => d.employeeId === employeeId)) {
    throw new HttpError(400, "Tickets in this category are the directors' alone, so only a director can be assigned to them.", "VALIDATION_ERROR");
  }
}

/** HR keeps Helpdesk Categories, but cannot move a category into or out of the directors-only queue: that would let HR re-route Payroll tickets to itself. */
async function assertOnlyDirectorSetsDirectorsOnly(wanted: boolean | undefined, meta: ActorMeta, current = false) {
  if (wanted === undefined || wanted === current) return;
  if (!(await isDirector(meta.actorUserId))) throw new HttpError(403, "Only a director can move a category into or out of the directors-only queue.", "FORBIDDEN");
}

export async function createCategory(
  input: { code: string; name: string; isSensitive?: boolean; directorsOnly?: boolean; sortOrder?: number; defaultAssigneeEmployeeId?: string | null },
  meta: ActorMeta,
) {
  await assertOnlyDirectorSetsDirectorsOnly(input.directorsOnly, meta);
  await assertAssignable(input.defaultAssigneeEmployeeId, input.directorsOnly === true);
  try {
    const after = await prisma.helpdeskCategory.create({ data: input });
    await writeAuditLog({ ...meta, action: "helpdesk.category.created", entityType: "HelpdeskCategory", entityId: after.id, after });
    return after;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new HttpError(409, `A category with code "${input.code}" already exists.`, "CONFLICT");
    }
    throw err;
  }
}

// The sensitive flag is editable at any time (user decision) — flipping it
// immediately changes who can see the category's existing tickets.
export async function updateCategory(
  id: string,
  input: { name?: string; isSensitive?: boolean; directorsOnly?: boolean; isActive?: boolean; sortOrder?: number; defaultAssigneeEmployeeId?: string | null },
  meta: ActorMeta,
) {
  const before = await prisma.helpdeskCategory.findUnique({ where: { id } });
  if (!before) throw new HttpError(404, "Category not found.", "NOT_FOUND");
  await assertOnlyDirectorSetsDirectorsOnly(input.directorsOnly, meta, before.directorsOnly);
  const becomesDirectorsOnly = input.directorsOnly ?? before.directorsOnly;
  // A directors-only category cannot be left with a default assignee who is not a director, nor be given one.
  if (becomesDirectorsOnly && input.defaultAssigneeEmployeeId === undefined && before.defaultAssigneeEmployeeId && !(await activeDirectors()).some((d) => d.employeeId === before.defaultAssigneeEmployeeId)) input.defaultAssigneeEmployeeId = null;
  await assertAssignable(input.defaultAssigneeEmployeeId, becomesDirectorsOnly);
  const after = await prisma.helpdeskCategory.update({ where: { id }, data: input });
  await writeAuditLog({ ...meta, action: "helpdesk.category.updated", entityType: "HelpdeskCategory", entityId: id, before, after });
  return after;
}

// Active employees who can work the queue (hold helpdesk.manage through any
// role) — for the assign dropdown and to validate assignments.
export async function listAssignees() {
  const rows = await prisma.employee.findMany({
    where: {
      status: "ACTIVE",
      user: { status: "ACTIVE", roles: { some: { role: { permissions: { some: { permission: { key: "helpdesk.manage" } } } } } } },
    },
    select: nameSelect(),
  });
  return rows.map((r) => personRef(r)!).sort((a, b) => a.name.localeCompare(b.name));
}

// ── Attachments ───────────────────────────────────────────────────────

async function storeAttachments(files: Express.Multer.File[], ticketId: string) {
  if (files.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new HttpError(400, `Attach at most ${MAX_ATTACHMENTS_PER_MESSAGE} files per message.`, "INVALID_UPLOAD");
  }
  const settings = await getPeopleDocumentsSettings();
  // Validate (and re-encode images) for every file before storing any.
  const prepared = await Promise.all(files.map((f) => prepareDocumentUpload(f, settings)));
  const stored: Array<{ fileKey: string; fileName: string; mimeType: string; sizeBytes: number }> = [];
  for (const p of prepared) {
    const fileKey = `helpdesk/${ticketId}/${randomUUID()}${path.extname(p.fileName).toLowerCase()}`;
    await storageService.putObject(fileKey, p.buffer, p.mimeType);
    stored.push({ fileKey, fileName: p.fileName, mimeType: p.mimeType, sizeBytes: p.sizeBytes });
  }
  return stored;
}

async function discardStored(keys: string[]) {
  for (const key of keys) await storageService.deleteObject(key).catch(() => undefined); // orphan cleanup only
}

// ── Raising and reading ───────────────────────────────────────────────

export async function raiseTicket(
  viewer: HelpdeskViewer,
  input: { categoryId: string; subject: string; body: string; priority?: HelpdeskPriority },
  files: Express.Multer.File[],
  meta: ActorMeta,
) {
  const category = await prisma.helpdeskCategory.findUnique({ where: { id: input.categoryId } });
  if (!category || !category.isActive) throw new HttpError(400, "Choose an active category.", "VALIDATION_ERROR");

  const ticketId = randomUUID().replace(/-/g, "").slice(0, 25);
  const stored = await storeAttachments(files, ticketId);
  let ticket: { id: string; number: number };
  try {
    ticket = await prisma.$transaction(async (tx) => {
      const t = await tx.helpdeskTicket.create({
        data: {
          id: ticketId,
          raisedByEmployeeId: viewer.employeeId,
          categoryId: category.id,
          subject: input.subject,
          priority: input.priority ?? "NORMAL",
          assigneeEmployeeId: category.defaultAssigneeEmployeeId && category.directorsOnly && !(await activeDirectors(tx)).some((d) => d.employeeId === category.defaultAssigneeEmployeeId) ? null : category.defaultAssigneeEmployeeId,
          status: "OPEN",
        },
      });
      await tx.helpdeskMessage.create({
        data: { ticketId: t.id, authorEmployeeId: viewer.employeeId, body: input.body, attachments: { create: stored } },
      });
      return t;
    });
  } catch (err) {
    await discardStored(stored.map((s) => s.fileKey));
    throw err;
  }
  await writeAuditLog({ ...meta, action: "helpdesk.ticket.raised", entityType: "HelpdeskTicket", entityId: ticket.id, after: { number: ticket.number, categoryId: category.id } });
  if (category.defaultAssigneeEmployeeId) {
    await notifyEmployee(category.defaultAssigneeEmployeeId, {
      type: "helpdesk.assigned",
      title: "New helpdesk ticket",
      body: `${formatTicketNumber(ticket.number)}: ${input.subject}`,
      link: helpdeskAdminPath(ticket.id),
      payload: { ticketId: ticket.id },
    });
  }
  emitHelpdeskQueue();
  return getTicket(ticket.id, viewer);
}

export async function listMyTickets(viewer: HelpdeskViewer, query: { status?: HelpdeskTicketStatus }) {
  const [rows, settings] = await Promise.all([
    prisma.helpdeskTicket.findMany({
      where: { raisedByEmployeeId: viewer.employeeId, ...(query.status && { status: query.status }) },
      include: ticketInclude(),
      orderBy: { lastActivityAt: "desc" },
    }),
    getHelpdeskSettings(),
  ]);
  return rows.map((r) => formatTicket(r, settings));
}

export interface HelpdeskQueueQuery {
  status?: HelpdeskTicketStatus;
  categoryId?: string;
  assignee?: string; // "me" | "unassigned" | an employee id
  page: number;
  pageSize: number;
}

export async function listQueue(viewer: HelpdeskViewer, query: HelpdeskQueueQuery) {
  const director = await isDirector(viewer.userId);
  const where: Prisma.HelpdeskTicketWhereInput = {
    ...hrVisibleWhere(viewer, director),
    ...(query.status ? { status: query.status } : { status: { not: "CLOSED" } }),
    ...(query.categoryId && { categoryId: query.categoryId }),
    ...(query.assignee === "me" && { assigneeEmployeeId: viewer.employeeId }),
    ...(query.assignee === "unassigned" && { assigneeEmployeeId: null }),
    ...(query.assignee && query.assignee !== "me" && query.assignee !== "unassigned" && { assigneeEmployeeId: query.assignee }),
  };
  const [total, rows, settings] = await Promise.all([
    prisma.helpdeskTicket.count({ where }),
    prisma.helpdeskTicket.findMany({
      where,
      include: ticketInclude(),
      orderBy: [{ lastActivityAt: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    getHelpdeskSettings(),
  ]);
  return { items: rows.map((r) => formatTicket(r, settings)), total, page: query.page, pageSize: query.pageSize };
}

type Access = { mode: "raiser" } | { mode: "hr" };

// The single access decision for one ticket (see the module comment).
async function resolveAccess(ticketId: string, viewer: HelpdeskViewer): Promise<{ ticket: TicketRow; access: Access }> {
  const ticket = await prisma.helpdeskTicket.findUnique({ where: { id: ticketId }, include: ticketInclude() });
  if (!ticket) throw notFound();
  if (ticket.raisedByEmployeeId === viewer.employeeId) return { ticket, access: { mode: "raiser" } };
  if (canManage(viewer) && (!ticket.category.isSensitive || canSeeSensitive(viewer)) && (!ticket.category.directorsOnly || (await isDirector(viewer.userId)))) return { ticket, access: { mode: "hr" } };
  throw notFound();
}

export async function getTicket(ticketId: string, viewer: HelpdeskViewer, meta?: ActorMeta) {
  const { ticket, access } = await resolveAccess(ticketId, viewer);
  const [messages, settings] = await Promise.all([
    prisma.helpdeskMessage.findMany({
      where: { ticketId, ...(access.mode === "raiser" && { isInternalNote: false }) },
      include: { author: { select: nameSelect() }, attachments: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true } } },
      orderBy: { createdAt: "asc" },
    }),
    getHelpdeskSettings(),
  ]);
  if (access.mode === "hr" && ticket.category.isSensitive && meta) {
    await writeAuditLog({ ...meta, action: "helpdesk.ticket.sensitive_viewed", entityType: "HelpdeskTicket", entityId: ticket.id, after: { number: ticket.number, category: ticket.category.code } });
  }
  return {
    ...formatTicket(ticket, settings),
    viewerRole: access.mode,
    messages: messages.map((m) => ({
      id: m.id,
      author: personRef(m.author),
      fromRaiser: m.author.id === ticket.raisedByEmployeeId,
      body: m.body,
      ...(access.mode === "hr" && { isInternalNote: m.isInternalNote }),
      createdAt: m.createdAt.toISOString(),
      attachments: m.attachments,
    })),
  };
}

// ── Replies and status ────────────────────────────────────────────────

export async function addMessage(
  ticketId: string,
  viewer: HelpdeskViewer,
  input: { body: string; isInternalNote?: boolean },
  files: Express.Multer.File[],
  meta: ActorMeta,
) {
  const { ticket, access } = await resolveAccess(ticketId, viewer);
  const internal = Boolean(input.isInternalNote);
  if (internal && access.mode !== "hr") throw new HttpError(403, "Only HR can add internal notes.", "FORBIDDEN");
  if (ticket.status === "CLOSED" && access.mode === "raiser") {
    throw new HttpError(409, "This ticket is closed. Reopen it (if it's still within the reopen window) or raise a new one.", "CONFLICT");
  }
  const settings = await getHelpdeskSettings();
  if (access.mode === "raiser" && ticket.status === "RESOLVED" && ticket.resolvedAt && Date.now() > reopenUntil(ticket.resolvedAt, settings).getTime()) {
    throw new HttpError(409, "The reopen window for this ticket has passed — please raise a new one.", "CONFLICT");
  }

  // Status follows the conversation: the raiser replying puts the ball back
  // in HR's court (reopening a Resolved ticket); HR's first public reply
  // picks an Open ticket up. Internal notes never move the status.
  let nextStatus: HelpdeskTicketStatus = ticket.status;
  if (access.mode === "raiser" && ["RESOLVED", "WAITING_ON_EMPLOYEE"].includes(ticket.status)) {
    nextStatus = ticket.assigneeEmployeeId ? "IN_PROGRESS" : "OPEN";
  } else if (access.mode === "hr" && !internal && ticket.status === "OPEN") {
    nextStatus = "IN_PROGRESS";
  }

  const stored = await storeAttachments(files, ticketId);
  try {
    await prisma.$transaction([
      prisma.helpdeskMessage.create({
        data: { ticketId, authorEmployeeId: viewer.employeeId, body: input.body, isInternalNote: internal, attachments: { create: stored } },
      }),
      prisma.helpdeskTicket.update({
        where: { id: ticketId },
        data: {
          status: nextStatus,
          ...(nextStatus !== ticket.status && nextStatus !== "RESOLVED" && { resolvedAt: null }),
          ...(!internal && { lastActivityAt: new Date() }),
        },
      }),
    ]);
  } catch (err) {
    await discardStored(stored.map((s) => s.fileKey));
    throw err;
  }

  if (nextStatus !== ticket.status) {
    await writeAuditLog({ ...meta, action: "helpdesk.ticket.status_changed", entityType: "HelpdeskTicket", entityId: ticketId, before: { status: ticket.status }, after: { status: nextStatus, reason: "reply" } });
  }
  const number = formatTicketNumber(ticket.number);
  if (access.mode === "hr" && !internal) {
    await notifyEmployee(ticket.raisedByEmployeeId, { type: "helpdesk.reply", title: `HR replied on ${number}`, body: ticket.subject, link: helpdeskEmployeePath(ticketId), payload: { ticketId } });
  } else if (access.mode === "raiser" && ticket.assigneeEmployeeId) {
    await notifyEmployee(ticket.assigneeEmployeeId, { type: "helpdesk.reply", title: `New reply on ${number}`, body: ticket.subject, link: helpdeskAdminPath(ticketId), payload: { ticketId } });
  }
  // Internal notes refresh only HR's screens — never the raiser's room.
  emitHelpdeskTicket(ticketId, internal ? [ticket.assigneeEmployeeId] : [ticket.raisedByEmployeeId, ticket.assigneeEmployeeId]);
  emitHelpdeskQueue();
  return getTicket(ticketId, viewer);
}

export async function updateTicket(
  ticketId: string,
  viewer: HelpdeskViewer,
  input: { status?: HelpdeskTicketStatus; priority?: HelpdeskPriority; assigneeEmployeeId?: string | null },
  meta: ActorMeta,
) {
  const { ticket, access } = await resolveAccess(ticketId, viewer);
  if (access.mode !== "hr") throw notFound();
  await assertAssignable(input.assigneeEmployeeId, ticket.category.directorsOnly);

  const data: Prisma.HelpdeskTicketUpdateInput = {};
  if (input.priority) data.priority = input.priority;
  if (input.assigneeEmployeeId !== undefined) data.assignee = input.assigneeEmployeeId ? { connect: { id: input.assigneeEmployeeId } } : { disconnect: true };
  if (input.status && input.status !== ticket.status) {
    data.status = input.status;
    data.lastActivityAt = new Date();
    if (input.status === "RESOLVED") data.resolvedAt = new Date();
    else if (input.status === "CLOSED") data.closedAt = new Date();
    else data.resolvedAt = null;
    if (input.status !== "CLOSED") data.closedAt = null;
    if (input.status === "CLOSED" && !ticket.resolvedAt) data.resolvedAt = new Date(); // starts the reopen window
  }
  const after = await prisma.helpdeskTicket.update({ where: { id: ticketId }, data, include: ticketInclude() });
  await writeAuditLog({
    ...meta,
    action: "helpdesk.ticket.updated",
    entityType: "HelpdeskTicket",
    entityId: ticketId,
    before: { status: ticket.status, priority: ticket.priority, assigneeEmployeeId: ticket.assigneeEmployeeId },
    after: { status: after.status, priority: after.priority, assigneeEmployeeId: after.assigneeEmployeeId },
  });

  const number = formatTicketNumber(ticket.number);
  if (input.status && input.status !== ticket.status) {
    const settings = await getHelpdeskSettings();
    const closesOn = after.status === "RESOLVED" && after.resolvedAt ? autoCloseAt(after.resolvedAt, settings) : null;
    await notifyEmployee(ticket.raisedByEmployeeId, {
      type: "helpdesk.status",
      title: `${number} is now ${after.status.replace(/_/g, " ").toLowerCase()}`,
      body: closesOn ? `It will close automatically on ${closesOn.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })} unless you reply.` : ticket.subject,
      link: helpdeskEmployeePath(ticketId),
      payload: { ticketId },
    });
  }
  if (input.assigneeEmployeeId && input.assigneeEmployeeId !== ticket.assigneeEmployeeId && input.assigneeEmployeeId !== viewer.employeeId) {
    await notifyEmployee(input.assigneeEmployeeId, { type: "helpdesk.assigned", title: `${number} assigned to you`, body: ticket.subject, link: helpdeskAdminPath(ticketId), payload: { ticketId } });
  }
  emitHelpdeskTicket(ticketId, [ticket.raisedByEmployeeId, ticket.assigneeEmployeeId, after.assigneeEmployeeId]);
  emitHelpdeskQueue();
  return getTicket(ticketId, viewer);
}

// The raiser may reopen a Resolved (or Closed) ticket inside the reopen
// window — the same date they're shown on the ticket.
export async function reopenTicket(ticketId: string, viewer: HelpdeskViewer, meta: ActorMeta) {
  const { ticket, access } = await resolveAccess(ticketId, viewer);
  if (access.mode !== "raiser") throw notFound();
  if (ticket.status !== "RESOLVED" && ticket.status !== "CLOSED") throw new HttpError(409, "Only a resolved or closed ticket can be reopened.", "CONFLICT");
  const settings = await getHelpdeskSettings();
  if (!ticket.resolvedAt || Date.now() > reopenUntil(ticket.resolvedAt, settings).getTime()) {
    throw new HttpError(409, "The reopen window for this ticket has passed — please raise a new one.", "CONFLICT");
  }
  const status: HelpdeskTicketStatus = ticket.assigneeEmployeeId ? "IN_PROGRESS" : "OPEN";
  await prisma.helpdeskTicket.update({ where: { id: ticketId }, data: { status, resolvedAt: null, closedAt: null, lastActivityAt: new Date() } });
  await writeAuditLog({ ...meta, action: "helpdesk.ticket.reopened", entityType: "HelpdeskTicket", entityId: ticketId, before: { status: ticket.status }, after: { status } });
  if (ticket.assigneeEmployeeId) {
    await notifyEmployee(ticket.assigneeEmployeeId, { type: "helpdesk.reopened", title: `${formatTicketNumber(ticket.number)} was reopened`, body: ticket.subject, link: helpdeskAdminPath(ticketId), payload: { ticketId } });
  }
  emitHelpdeskTicket(ticketId, [ticket.raisedByEmployeeId, ticket.assigneeEmployeeId]);
  emitHelpdeskQueue();
  return getTicket(ticketId, viewer);
}

export async function downloadAttachment(attachmentId: string, viewer: HelpdeskViewer) {
  const attachment = await prisma.helpdeskAttachment.findUnique({ where: { id: attachmentId }, include: { message: true } });
  if (!attachment) throw new HttpError(404, "Attachment not found.", "NOT_FOUND");
  let access: Access;
  try {
    ({ access } = await resolveAccess(attachment.message.ticketId, viewer));
  } catch {
    throw new HttpError(404, "Attachment not found.", "NOT_FOUND");
  }
  // An internal note's attachments are as invisible to the raiser as the note.
  if (access.mode === "raiser" && attachment.message.isInternalNote) throw new HttpError(404, "Attachment not found.", "NOT_FOUND");
  const url = await storageService.getObjectSignedUrl(attachment.fileKey, DOWNLOAD_URL_TTL_SECONDS, { downloadFileName: attachment.fileName });
  return { url, fileName: attachment.fileName, expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS };
}

// ── Hourly auto-close job ─────────────────────────────────────────────

// Closes every Resolved ticket whose auto-close date (resolvedAt +
// autoCloseDays — the date the employee was shown) has passed. Idempotent:
// a closed ticket is no longer RESOLVED, so a re-run touches nothing.
export async function autoCloseResolvedTickets(now = new Date()): Promise<{ closed: number }> {
  const settings = await getHelpdeskSettings();
  const candidates = await prisma.helpdeskTicket.findMany({ where: { status: "RESOLVED", resolvedAt: { not: null } } });
  const due = candidates.filter((t) => autoCloseAt(t.resolvedAt!, settings).getTime() <= now.getTime());
  let closed = 0;
  for (const ticket of due) {
    const updated = await prisma.helpdeskTicket.updateMany({ where: { id: ticket.id, status: "RESOLVED" }, data: { status: "CLOSED", closedAt: now } });
    if (updated.count === 0) continue; // raced with a reply — leave it
    closed += 1;
    await writeAuditLog({ actorUserId: null, action: "helpdesk.ticket.auto_closed", entityType: "HelpdeskTicket", entityId: ticket.id, before: { status: "RESOLVED" }, after: { status: "CLOSED" } });
    await notifyEmployee(ticket.raisedByEmployeeId, {
      type: "helpdesk.status",
      title: `${formatTicketNumber(ticket.number)} closed automatically`,
      body: `It was resolved ${settings.autoCloseDays} days ago with no further reply. Raise a new ticket if you still need help.`,
      link: helpdeskEmployeePath(ticket.id),
      payload: { ticketId: ticket.id },
    });
    emitHelpdeskTicket(ticket.id, [ticket.raisedByEmployeeId, ticket.assigneeEmployeeId]);
  }
  if (closed > 0) emitHelpdeskQueue();
  return { closed };
}
