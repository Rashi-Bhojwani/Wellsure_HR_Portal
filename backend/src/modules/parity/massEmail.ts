import type { Prisma } from "@prisma/client";
import { mailService } from "../../integrations/mail";
import { writeAuditLog } from "../../lib/audit";
import { buildEmployeeScopeWhere } from "../../lib/dataScope";
import { inForceOn } from "../../lib/effectiveDating";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { payFreeValueProblem } from "../letters/template";
import { resolveSegmentEmployeeIds } from "./segments";
import type { ParityMeta, ParityViewer } from "./types";

// A-9 G5 (docs/plans/GREYTHR_PARITY_EMPLOYEE_ADMIN.md, item 15). Email only. A draft is written, changed or discarded (kept, marked DISCARDED); before sending,
// the server counts the audience — resolved HERE, never taken from the screen, inside the sender's own data scope, current staff only — and the send refuses if
// that number has changed since the sender saw it, so the number confirmed is the number sent. The text is plain (escaped when sent, no merge fields) and may
// not carry a pay figure, a pay word or something shaped like an identity or account number. Every message goes through the mail interface; one recipient
// row per person records what happened (no address is stored); the send is audited.

export type AudienceInput = { audience: "ALL" } | { audience: "SEGMENT"; segmentId: string } | { audience: "PEOPLE"; employeeIds: string[] };
export interface DraftInput {
  subject: string;
  body: string;
  category?: string | null;
}

const IDENTITY_SHAPES: Array<[RegExp, string]> = [
  [/\b[A-Z]{5}\d{4}[A-Z]\b/i, "something shaped like a PAN"],
  [/\b\d{4}\s?\d{4}\s?\d{4}\b/, "something shaped like an Aadhaar number"],
  [/\b\d{9,18}\b/, "a long number (an account or identity number?)"],
  [/\b[A-Z]{4}0[A-Z0-9]{6}\b/, "something shaped like an IFSC"],
];

/** Refuses pay and private data, in words. */
export function privateDataProblem(subject: string, body: string): string | null {
  for (const [label, text] of [["subject", subject], ["message", body]] as const) {
    if (payFreeValueProblem(label, text)) return `The ${label} mentions pay or an amount. A mass email never carries pay.`;
    for (const [re, what] of IDENTITY_SHAPES) if (re.test(text)) return `The ${label} contains ${what}. A mass email never carries identity or bank details.`;
  }
  return null;
}

function assertClean(input: { subject: string; body: string }) {
  const problem = privateDataProblem(input.subject, input.body);
  if (problem) throw new HttpError(400, problem, "PRIVATE_DATA");
}

async function assertPeopleInScope(ids: string[], viewer: ParityViewer) {
  const scope = await buildEmployeeScopeWhere(viewer.employeeId, viewer.dataScope);
  const n = await prisma.employee.count({ where: { AND: [scope, { id: { in: ids } }] } });
  if (n !== new Set(ids).size) throw new HttpError(404, "One or more of those people were not found.", "NOT_FOUND");
}

/** The people an email goes to, as the server sees it now, for this sender. Current staff only. */
async function resolveAudience(email: { audience: "ALL" | "SEGMENT" | "PEOPLE"; segmentId: string | null; employeeIds: Prisma.JsonValue }, viewer: ParityViewer): Promise<string[]> {
  const scope = await buildEmployeeScopeWhere(viewer.employeeId, viewer.dataScope);
  const base: Prisma.EmployeeWhereInput[] = [scope, { status: { not: "SEPARATED" } }];
  if (email.audience === "SEGMENT") base.push({ id: { in: await resolveSegmentEmployeeIds(email.segmentId ?? "", viewer) } });
  if (email.audience === "PEOPLE") base.push({ id: { in: (email.employeeIds as string[]) ?? [] } });
  const rows = await prisma.employee.findMany({ where: { AND: base }, select: { id: true }, orderBy: { employeeCode: "asc" } });
  return rows.map((r) => r.id);
}

function format(e: Prisma.MassEmailGetPayload<object>) {
  return {
    id: e.id,
    subject: e.subject,
    body: e.body,
    category: e.category,
    audience: e.audience,
    segmentId: e.segmentId,
    employeeIds: e.employeeIds as string[],
    status: e.status,
    createdByUserId: e.createdByUserId,
    createdAt: e.createdAt.toISOString(),
    sentAt: e.sentAt?.toISOString() ?? null,
    recipientCount: e.recipientCount,
    deliveredCount: e.deliveredCount,
    failedCount: e.failedCount,
  };
}

async function loadDraft(id: string) {
  const e = await prisma.massEmail.findUnique({ where: { id } });
  if (!e || e.status === "DISCARDED") throw new HttpError(404, "Email not found.", "NOT_FOUND");
  return e;
}

export async function listMassEmails(q: { status?: "DRAFT" | "SENT"; page: number; pageSize: number }) {
  const where: Prisma.MassEmailWhereInput = q.status ? { status: q.status } : { status: { in: ["DRAFT", "SENDING", "SENT"] } };
  const [total, rows] = await Promise.all([prisma.massEmail.count({ where }), prisma.massEmail.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize })]);
  return { total, page: q.page, pageSize: q.pageSize, rows: rows.map(format) };
}

export async function getMassEmail(id: string) {
  return format(await loadDraft(id));
}

export async function createDraft(input: DraftInput & AudienceInput, viewer: ParityViewer, meta: ParityMeta) {
  assertClean(input);
  if (input.audience === "PEOPLE") await assertPeopleInScope(input.employeeIds, viewer);
  if (input.audience === "SEGMENT") await resolveSegmentEmployeeIds(input.segmentId, viewer); // must be a segment this sender may use
  const e = await prisma.massEmail.create({
    data: {
      subject: input.subject,
      body: input.body,
      category: input.category ?? null,
      audience: input.audience,
      segmentId: input.audience === "SEGMENT" ? input.segmentId : null,
      employeeIds: (input.audience === "PEOPLE" ? [...new Set(input.employeeIds)] : []) as Prisma.InputJsonValue,
      createdByUserId: viewer.userId,
    },
  });
  await writeAuditLog({ ...meta, action: "communication.mass.drafted", entityType: "MassEmail", entityId: e.id, after: { subject: e.subject, category: e.category, audience: e.audience } });
  return format(e);
}

export async function updateDraft(id: string, input: Partial<DraftInput> & Partial<{ audience: "ALL" | "SEGMENT" | "PEOPLE"; segmentId: string; employeeIds: string[] }>, viewer: ParityViewer, meta: ParityMeta) {
  const before = await loadDraft(id);
  if (before.status !== "DRAFT") throw new HttpError(409, "Only a draft can be changed.", "NOT_DRAFT");
  const next = { subject: input.subject ?? before.subject, body: input.body ?? before.body };
  assertClean(next);
  const audience = input.audience ?? before.audience;
  const employeeIds = audience === "PEOPLE" ? (input.employeeIds ?? (before.employeeIds as string[])) : [];
  const segmentId = audience === "SEGMENT" ? (input.segmentId ?? before.segmentId) : null;
  if (audience === "PEOPLE") await assertPeopleInScope(employeeIds, viewer);
  if (audience === "SEGMENT") await resolveSegmentEmployeeIds(segmentId ?? "", viewer);
  const e = await prisma.massEmail.update({ where: { id }, data: { ...next, category: input.category === undefined ? before.category : input.category, audience, segmentId, employeeIds: [...new Set(employeeIds)] as Prisma.InputJsonValue } });
  await writeAuditLog({ ...meta, action: "communication.mass.updated", entityType: "MassEmail", entityId: id, before: { subject: before.subject, audience: before.audience }, after: { subject: e.subject, audience: e.audience } });
  return format(e);
}

export async function discardDraft(id: string, meta: ParityMeta) {
  const before = await loadDraft(id);
  if (before.status !== "DRAFT") throw new HttpError(409, "Only a draft can be discarded; a sent email stays in the history.", "NOT_DRAFT");
  await prisma.massEmail.update({ where: { id }, data: { status: "DISCARDED", discardedAt: new Date() } });
  await writeAuditLog({ ...meta, action: "communication.mass.discarded", entityType: "MassEmail", entityId: id, before: { subject: before.subject } });
}

/** How many people it would go to now, for this sender — the number the sender confirms. */
export async function countAudience(id: string, viewer: ParityViewer) {
  const e = await loadDraft(id);
  const ids = await resolveAudience(e, viewer);
  const withAddress = await prisma.employee.count({ where: { id: { in: ids }, OR: [{ officialEmail: { not: null } }, { personal: { personalEmail: { not: "" } } }] } });
  return { count: ids.length, withoutAddress: ids.length - withAddress };
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export async function sendMassEmail(id: string, expectedCount: number, viewer: ParityViewer, meta: ParityMeta) {
  const e = await loadDraft(id);
  if (e.status === "SENT" || e.status === "SENDING") return format(e); // sending twice sends once
  assertClean(e); // checked again: nothing from the draft is trusted
  const ids = await resolveAudience(e, viewer);
  if (ids.length === 0) throw new HttpError(400, "Nobody to send it to.", "VALIDATION_ERROR");
  if (ids.length !== expectedCount) throw new HttpError(409, `The audience is now ${ids.length} people, not ${expectedCount}. Check it and send again.`, "AUDIENCE_CHANGED", { count: ids.length });
  const claimed = await prisma.massEmail.updateMany({ where: { id, status: "DRAFT" }, data: { status: "SENDING" } });
  if (claimed.count === 0) return getMassEmail(id);

  const people = await prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, employeeCode: true, officialEmail: true, personal: { select: { personalEmail: true } }, nameHistory: { where: inForceOn(), select: { fullName: true } } } });
  const html = `<p>${escapeHtml(e.body).replace(/\r?\n/g, "<br>")}</p>`;
  let delivered = 0;
  let failed = 0;
  for (const person of people) {
    const to = person.officialEmail ?? person.personal?.personalEmail ?? "";
    let outcome: "SENT" | "FAILED" | "NO_ADDRESS" = "NO_ADDRESS";
    let detail: string | null = null;
    if (to) {
      try {
        await mailService.send({ to, subject: e.subject, html, text: e.body });
        outcome = "SENT";
        delivered += 1;
      } catch (err) {
        outcome = "FAILED";
        failed += 1;
        detail = err instanceof Error ? err.message.slice(0, 200) : "send failed";
        logger.warn({ err, massEmailId: id, employeeId: person.id }, "mass email: one message failed");
      }
    }
    await prisma.massEmailRecipient.create({ data: { massEmailId: id, employeeId: person.id, outcome, detail } });
  }
  const sent = await prisma.massEmail.update({ where: { id }, data: { status: "SENT", sentAt: new Date(), sentByUserId: viewer.userId, recipientCount: people.length, deliveredCount: delivered, failedCount: failed } });
  await writeAuditLog({ ...meta, action: "communication.mass.sent", entityType: "MassEmail", entityId: id, after: { subject: sent.subject, category: sent.category, audience: sent.audience, recipients: people.length, delivered, failed } });
  return format(sent);
}
