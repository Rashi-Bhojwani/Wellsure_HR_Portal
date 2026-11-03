import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { writeAuditLog } from "../../lib/audit";
import { buildEmployeeScopeWhere } from "../../lib/dataScope";
import { inForceOn } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";
import { getSetting } from "../../lib/settings";
import { HttpError } from "../../middleware/errorHandler";
import { findScopedEmployee } from "../employee/service";
import { resolveSegmentEmployeeIds } from "../parity/segments";
import { issueLetter, renderDraftLetter, templatePayFree, type ActorMeta, type EnqueueLetter, type LetterViewer } from "./service";
import { assertDirector, isDirectorViewer } from "./starters";

// A-9 G3 (docs/plans/GREYTHR_PARITY_EMPLOYEE_ADMIN.md, item 12). A letter is PREPARED (one person, or many at once as a batch), signed by up to two signatories,
// then ISSUED through the existing issue path (issueLetter: it numbers the letter, freezes its values and files it to the person's documents). A mistake is VOID
// with a reason; nothing is deleted. Preparing and issuing are separate permissions per letter template: by default only the directors; a director may grant
// either to a role or a person (letter_template_grants). A non-director also needs the HR letters switch (letters.issue.nopay — so switching HR off takes effect
// on the next request) and a template the system has proved cannot carry a pay figure. A letter that can carry figures is the directors', whatever is granted.

export type LetterAction = "PREPARE" | "ISSUE";
export const SERIAL_SETTING_KEY = "letters.serialSequence";
export interface SerialSequence {
  prefix: string;
  nextNumber: number;
}
const MAX_BATCH = 200;

async function activeGrant(templateId: string, action: LetterAction, viewer: LetterViewer): Promise<boolean> {
  const n = await prisma.letterTemplateGrant.count({ where: { templateId, action, revokedAt: null, OR: [{ userId: viewer.userId }, { roleCode: { in: viewer.roleCodes } }] } });
  return n > 0;
}

/** May this person prepare (or issue) letters from this template? Throws the reason when not. */
export async function assertMayAct(templateId: string, action: LetterAction, viewer: LetterViewer): Promise<void> {
  const proof = await templatePayFree(templateId);
  if (!proof) throw new HttpError(404, "Template not found.", "NOT_FOUND");
  if (isDirectorViewer(viewer)) return;
  if (!viewer.permissions.has("letters.issue.nopay")) throw new HttpError(403, "Missing permission: letters.issue.nopay", "FORBIDDEN");
  if (!proof.ok) throw new HttpError(403, `This letter could carry a pay figure, so only a director can ${action === "PREPARE" ? "prepare" : "issue"} it. ${proof.reasons.join(" ")}`, "PAY_LETTER_DIRECTOR_ONLY", { reasons: proof.reasons });
  if (!(await activeGrant(templateId, action, viewer))) throw new HttpError(403, `A director has not allowed you to ${action === "PREPARE" ? "prepare" : "issue"} "${proof.name}" letters.`, "NO_LETTER_GRANT");
}

/** The templates this person may prepare from (directors: every active one). */
export async function preparableTemplates(viewer: LetterViewer) {
  const templates = await prisma.letterTemplate.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, code: true, name: true } });
  const out = [];
  for (const t of templates) {
    try {
      await assertMayAct(t.id, "PREPARE", viewer);
      const proof = await templatePayFree(t.id);
      out.push({ ...t, payFree: proof?.ok ?? false, mayIssue: await assertMayAct(t.id, "ISSUE", viewer).then(() => true, () => false) });
    } catch {
      /* not this person's */
    }
  }
  return out;
}

// ── Serial sequence (Not set until a director sets it) ──

export async function getSerial(viewer: LetterViewer): Promise<SerialSequence | null> {
  assertDirector(viewer, "see the letter serial");
  return getSetting<SerialSequence | null>(SERIAL_SETTING_KEY, null);
}

export async function setSerial(input: SerialSequence, viewer: LetterViewer, meta: ActorMeta): Promise<SerialSequence> {
  assertDirector(viewer, "set the letter serial");
  const before = await getSetting<SerialSequence | null>(SERIAL_SETTING_KEY, null);
  await prisma.systemSetting.upsert({ where: { key: SERIAL_SETTING_KEY }, create: { key: SERIAL_SETTING_KEY, value: input as unknown as Prisma.InputJsonValue, updatedByUserId: viewer.userId }, update: { value: input as unknown as Prisma.InputJsonValue, updatedByUserId: viewer.userId } });
  await writeAuditLog({ ...meta, action: "letters.serial.set", entityType: "SystemSetting", entityId: SERIAL_SETTING_KEY, before, after: input });
  return input;
}

/** Takes the next serial inside the caller's transaction (row lock): two letters issued at once never share one. Null while Not set. */
async function takeSerial(tx: Prisma.TransactionClient): Promise<string | null> {
  const rows = await tx.$queryRaw<Array<{ value: SerialSequence }>>`SELECT value FROM system_settings WHERE key = ${SERIAL_SETTING_KEY} FOR UPDATE`;
  const seq = rows[0]?.value;
  if (!seq || typeof seq.nextNumber !== "number") return null;
  await tx.systemSetting.update({ where: { key: SERIAL_SETTING_KEY }, data: { value: { ...seq, nextNumber: seq.nextNumber + 1 } as unknown as Prisma.InputJsonValue } });
  return `${seq.prefix}${seq.nextNumber}`;
}

// ── Requests ──

const requestInclude = {
  template: { select: { id: true, code: true, name: true } },
  employee: { select: { id: true, employeeCode: true, nameHistory: { where: inForceOn(), select: { fullName: true } } } },
  signatories: { orderBy: { position: "asc" as const }, include: { signatory: { select: { id: true, employeeCode: true, nameHistory: { where: inForceOn(), select: { fullName: true } } } } } },
  generatedLetter: { select: { id: true, number: true, status: true, employeeDocumentId: true } },
} satisfies Prisma.LetterRequestInclude;
type RequestRow = Prisma.LetterRequestGetPayload<{ include: typeof requestInclude }>;

function format(r: RequestRow, viewer: LetterViewer) {
  const name = (e: { employeeCode: string; nameHistory: Array<{ fullName: string }> }) => e.nameHistory[0]?.fullName ?? e.employeeCode;
  return {
    id: r.id,
    batchId: r.batchId,
    status: r.status,
    template: r.template,
    employee: { id: r.employee.id, employeeCode: r.employee.employeeCode, fullName: name(r.employee) },
    // The typed values are shown to whoever may prepare or issue it (the route checked); a director-only letter is never listed to anyone else.
    extraValues: r.extraValues as Record<string, string>,
    remarks: r.remarks,
    serial: r.serial,
    signatories: r.signatories.map((s) => ({ position: s.position, employeeId: s.signatory.id, name: name(s.signatory), status: s.status, signedAt: s.signedAt?.toISOString() ?? null, isMe: s.signatory.id === viewer.employeeId })),
    letter: r.generatedLetter ? { id: r.generatedLetter.id, reference: `LTR-${String(r.generatedLetter.number).padStart(6, "0")}`, status: r.generatedLetter.status, documentId: r.generatedLetter.employeeDocumentId } : null,
    preparedAt: r.preparedAt.toISOString(),
    issuedAt: r.issuedAt?.toISOString() ?? null,
    voidedAt: r.voidedAt?.toISOString() ?? null,
    voidReason: r.voidReason,
  };
}

/** Which templates' requests this person may see in the lists: everything for a director; otherwise the templates they hold a live grant on. */
async function visibleTemplateIds(viewer: LetterViewer): Promise<string[] | null> {
  if (isDirectorViewer(viewer)) return null;
  if (!viewer.permissions.has("letters.issue.nopay")) return [];
  const grants = await prisma.letterTemplateGrant.findMany({ where: { revokedAt: null, OR: [{ userId: viewer.userId }, { roleCode: { in: viewer.roleCodes } }] }, select: { templateId: true } });
  const ids = [...new Set(grants.map((g) => g.templateId))];
  const ok = [];
  for (const id of ids) if ((await templatePayFree(id))?.ok) ok.push(id);
  return ok;
}

async function loadRequest(id: string, viewer: LetterViewer): Promise<RequestRow> {
  const row = await prisma.letterRequest.findUnique({ where: { id }, include: requestInclude });
  const templates = row ? await visibleTemplateIds(viewer) : [];
  if (!row || (templates && !templates.includes(row.templateId))) throw new HttpError(404, "Letter not found.", "NOT_FOUND");
  try {
    await findScopedEmployee(row.employeeId, viewer.employeeId, viewer.dataScope);
  } catch {
    throw new HttpError(404, "Letter not found.", "NOT_FOUND");
  }
  return row;
}

export async function listRequests(viewer: LetterViewer, q: { status: "IN_PROGRESS" | "ISSUED" | "VOID"; batchId?: string; page: number; pageSize: number }) {
  const templates = await visibleTemplateIds(viewer);
  const scope = await buildEmployeeScopeWhere(viewer.employeeId, viewer.dataScope);
  const where: Prisma.LetterRequestWhereInput = { status: q.status, ...(q.batchId ? { batchId: q.batchId } : {}), ...(templates ? { templateId: { in: templates } } : {}), employee: scope };
  const [total, rows] = await Promise.all([
    prisma.letterRequest.count({ where }),
    prisma.letterRequest.findMany({ where, include: requestInclude, orderBy: [{ preparedAt: "desc" }, { id: "asc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  return { total, page: q.page, pageSize: q.pageSize, rows: rows.map((r) => format(r, viewer)) };
}

export async function getRequest(id: string, viewer: LetterViewer) {
  return format(await loadRequest(id, viewer), viewer);
}

async function assertSignatories(ids: string[]) {
  if (new Set(ids).size !== ids.length) throw new HttpError(400, "The two signatories must be different people.", "VALIDATION_ERROR");
  if (ids.length === 0) return;
  const found = await prisma.employee.count({ where: { id: { in: ids }, status: { not: "SEPARATED" } } });
  if (found !== ids.length) throw new HttpError(400, "Choose signatories who are current employees.", "VALIDATION_ERROR");
}

export interface PrepareInput {
  clientKey: string;
  templateId: string;
  employeeIds?: string[];
  segmentId?: string;
  extraValues: Record<string, string>;
  remarks?: string | null;
  signatoryEmployeeIds: string[];
}

export async function prepare(input: PrepareInput, viewer: LetterViewer, meta: ActorMeta) {
  // The same submit again (a double click, a retry after a timeout) returns what the first one made.
  const again = await prisma.letterRequest.findMany({ where: { preparedByUserId: viewer.userId, clientKey: input.clientKey }, include: requestInclude, orderBy: { id: "asc" } });
  if (again.length > 0) return { batchId: again[0]!.batchId, created: 0, requests: again.map((r) => format(r, viewer)) };

  await assertMayAct(input.templateId, "PREPARE", viewer);
  const template = await prisma.letterTemplate.findUniqueOrThrow({ where: { id: input.templateId } });
  if (!template.isActive) throw new HttpError(400, "Choose an enabled letter template.", "VALIDATION_ERROR");
  // The audience is resolved here, on the server, inside the viewer's own scope — a segment never widens it.
  const ids = input.segmentId ? await resolveSegmentEmployeeIds(input.segmentId, { ...viewer }) : [...new Set(input.employeeIds ?? [])];
  if (ids.length === 0) throw new HttpError(400, "Nobody to prepare a letter for.", "VALIDATION_ERROR");
  if (ids.length > MAX_BATCH) throw new HttpError(400, `At most ${MAX_BATCH} letters in one batch.`, "VALIDATION_ERROR");
  const scope = await buildEmployeeScopeWhere(viewer.employeeId, viewer.dataScope);
  if ((await prisma.employee.count({ where: { AND: [scope, { id: { in: ids } }] } })) !== ids.length) throw new HttpError(404, "One or more of those people were not found.", "NOT_FOUND");
  await assertSignatories(input.signatoryEmployeeIds);

  const batchId = randomUUID();
  try {
    await prisma.$transaction(async (tx) => {
      for (const employeeId of ids) {
        await tx.letterRequest.create({
          data: {
            batchId,
            clientKey: input.clientKey,
            templateId: input.templateId,
            employeeId,
            extraValues: input.extraValues as Prisma.InputJsonValue,
            remarks: input.remarks ?? null,
            preparedByUserId: viewer.userId,
            signatories: { create: input.signatoryEmployeeIds.map((signatoryEmployeeId, i) => ({ position: i + 1, signatoryEmployeeId })) },
          },
        });
      }
    });
  } catch (err) {
    // Two copies of the same submit raced: the other one won; return what it made.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return prepare(input, viewer, meta);
    throw err;
  }
  // The typed values may hold a figure on a director's letter: the audit keeps which fields were filled, never their values.
  await writeAuditLog({ ...meta, action: "letters.request.prepared", entityType: "LetterRequestBatch", entityId: batchId, after: { template: template.code, count: ids.length, fields: Object.keys(input.extraValues), signatories: input.signatoryEmployeeIds.length, viaSegment: Boolean(input.segmentId) } });
  const rows = await prisma.letterRequest.findMany({ where: { batchId }, include: requestInclude, orderBy: { id: "asc" } });
  return { batchId, created: rows.length, requests: rows.map((r) => format(r, viewer)) };
}

export async function updateRequest(id: string, input: { extraValues?: Record<string, string>; remarks?: string | null; signatoryEmployeeIds?: string[] }, viewer: LetterViewer, meta: ActorMeta) {
  const row = await loadRequest(id, viewer);
  await assertMayAct(row.templateId, "PREPARE", viewer);
  if (row.status !== "IN_PROGRESS") throw new HttpError(409, "Only a letter still in progress can be changed.", "NOT_IN_PROGRESS");
  if (input.signatoryEmployeeIds) await assertSignatories(input.signatoryEmployeeIds);
  // Anything a signatory signed off changes → every signature is asked for again.
  const resign = input.extraValues !== undefined || input.signatoryEmployeeIds !== undefined;
  const signatories = input.signatoryEmployeeIds ?? row.signatories.map((s) => s.signatoryEmployeeId);
  await prisma.$transaction(async (tx) => {
    await tx.letterRequest.update({ where: { id }, data: { ...(input.extraValues !== undefined && { extraValues: input.extraValues as Prisma.InputJsonValue }), ...(input.remarks !== undefined && { remarks: input.remarks }) } });
    if (resign) {
      await tx.letterRequestSignatory.deleteMany({ where: { requestId: id } });
      await tx.letterRequestSignatory.createMany({ data: signatories.map((signatoryEmployeeId, i) => ({ requestId: id, position: i + 1, signatoryEmployeeId })) });
    }
  });
  await writeAuditLog({ ...meta, action: "letters.request.updated", entityType: "LetterRequest", entityId: id, before: { remarks: row.remarks, fields: Object.keys(row.extraValues as object), signatories: row.signatories.length }, after: { remarks: input.remarks ?? row.remarks, fields: Object.keys((input.extraValues ?? row.extraValues) as object), signatories: signatories.length, signaturesReset: resign } });
  return getRequest(id, viewer);
}

/** The named signatory marks their own signature (a director may record it for them). Signing twice changes nothing. */
export async function sign(id: string, position: number, viewer: LetterViewer, meta: ActorMeta) {
  const row = await prisma.letterRequest.findUnique({ where: { id }, include: requestInclude });
  const slot = row?.signatories.find((s) => s.position === position);
  if (!row || !slot || (slot.signatoryEmployeeId !== viewer.employeeId && !isDirectorViewer(viewer))) throw new HttpError(404, "Letter not found.", "NOT_FOUND");
  if (row.status !== "IN_PROGRESS") throw new HttpError(409, "Only a letter still in progress can be signed.", "NOT_IN_PROGRESS");
  if (slot.status === "SIGNED") return format(row, viewer);
  await prisma.letterRequestSignatory.update({ where: { id: slot.id }, data: { status: "SIGNED", signedAt: new Date(), markedByUserId: viewer.userId } });
  await writeAuditLog({ ...meta, action: "letters.request.signed", entityType: "LetterRequest", entityId: id, after: { position, signatoryEmployeeId: slot.signatoryEmployeeId, recordedByDirector: slot.signatoryEmployeeId !== viewer.employeeId } });
  return format(await prisma.letterRequest.findUniqueOrThrow({ where: { id }, include: requestInclude }), viewer);
}

/** The letters waiting for this person's own signature. */
export async function toSign(viewer: LetterViewer) {
  const rows = await prisma.letterRequest.findMany({ where: { status: "IN_PROGRESS", signatories: { some: { signatoryEmployeeId: viewer.employeeId, status: "PENDING" } } }, include: requestInclude, orderBy: { preparedAt: "asc" }, take: 200 });
  return rows.map((r) => {
    const f = format(r, viewer);
    // A signatory sees what they sign for, not the typed values of a letter they could not otherwise read.
    return { id: f.id, template: f.template, employee: f.employee, signatories: f.signatories, preparedAt: f.preparedAt, remarks: f.remarks };
  });
}

export async function issue(id: string, viewer: LetterViewer, meta: ActorMeta, enqueue: EnqueueLetter) {
  const row = await loadRequest(id, viewer);
  await assertMayAct(row.templateId, "ISSUE", viewer);
  if (row.status === "ISSUED") return format(row, viewer); // issuing twice issues once
  if (row.status !== "IN_PROGRESS") throw new HttpError(409, "This letter was voided.", "NOT_IN_PROGRESS");
  if (row.signatories.some((s) => s.status !== "SIGNED")) throw new HttpError(409, "Every signatory has to sign before the letter is issued.", "SIGNATURES_PENDING");
  // Claim it first, so two issue clicks at once make one letter.
  const claimed = await prisma.letterRequest.updateMany({ where: { id, status: "IN_PROGRESS" }, data: { status: "ISSUED", issuedAt: new Date(), issuedByUserId: viewer.userId } });
  if (claimed.count === 0) return getRequest(id, viewer);
  let letter: Awaited<ReturnType<typeof issueLetter>>;
  try {
    letter = await issueLetter({ templateId: row.templateId, employeeId: row.employeeId, extraValues: row.extraValues as Record<string, string> }, viewer, meta, enqueue);
  } catch (err) {
    // Refused (for example a typed value that looks like pay, or no last working day yet): back to in progress, nothing issued, no serial used.
    await prisma.letterRequest.update({ where: { id }, data: { status: "IN_PROGRESS", issuedAt: null, issuedByUserId: null } });
    throw err;
  }
  await prisma.$transaction(async (tx) => {
    const serial = await takeSerial(tx);
    await tx.letterRequest.update({ where: { id }, data: { generatedLetterId: letter.id, serial } });
  });
  const after = await getRequest(id, viewer);
  await writeAuditLog({ ...meta, action: "letters.request.issued", entityType: "LetterRequest", entityId: id, after: { letter: after.letter?.reference ?? null, serial: after.serial } });
  return after;
}

export async function voidRequest(id: string, reason: string, viewer: LetterViewer, meta: ActorMeta) {
  const row = await loadRequest(id, viewer);
  if (row.status === "VOID") throw new HttpError(409, "This letter is already void.", "ALREADY_VOID");
  if (row.status === "ISSUED") {
    // An issued letter is filed among the person's pay documents; only a director takes it back.
    assertDirector(viewer, "void a letter that has been issued");
    const letter = row.generatedLetter;
    if (!letter || letter.status !== "GENERATED" || !letter.employeeDocumentId) throw new HttpError(409, "The letter is still being produced. Try again in a moment.", "LETTER_NOT_READY");
    // The letter record and its PDF stay exactly as issued (a legal record); the copy in the person's documents is archived, so they no longer see it.
    await prisma.employeeDocument.updateMany({ where: { id: letter.employeeDocumentId, archivedAt: null }, data: { archivedAt: new Date(), archivedByUserId: viewer.userId } });
    await writeAuditLog({ ...meta, action: "employee.document.archived", entityType: "Employee", entityId: row.employeeId, after: { documentId: letter.employeeDocumentId, why: "letter voided" } });
  } else {
    await assertMayAct(row.templateId, "PREPARE", viewer);
  }
  await prisma.letterRequest.update({ where: { id }, data: { status: "VOID", voidedAt: new Date(), voidedByUserId: viewer.userId, voidReason: reason } });
  await writeAuditLog({ ...meta, action: "letters.request.voided", entityType: "LetterRequest", entityId: id, before: { status: row.status }, after: { status: "VOID", reason } });
  return getRequest(id, viewer);
}

export async function previewRequest(id: string, viewer: LetterViewer): Promise<Buffer> {
  const row = await loadRequest(id, viewer);
  await assertMayAct(row.templateId, "PREPARE", viewer).catch(() => assertMayAct(row.templateId, "ISSUE", viewer));
  if (row.status !== "IN_PROGRESS") throw new HttpError(409, "Only a letter in progress has a draft; an issued one is in the person's documents.", "NOT_IN_PROGRESS");
  return renderDraftLetter(row.templateId, row.employeeId, row.extraValues as Record<string, string>);
}

// ── Grants (directors only) ──

export async function listGrants(viewer: LetterViewer) {
  assertDirector(viewer, "see who may prepare or issue letters");
  const rows = await prisma.letterTemplateGrant.findMany({ where: { revokedAt: null }, include: { template: { select: { id: true, code: true, name: true } } }, orderBy: { grantedAt: "desc" } });
  return rows.map((g) => ({ id: g.id, template: g.template, action: g.action, roleCode: g.roleCode, userId: g.userId, grantedAt: g.grantedAt.toISOString() }));
}

export async function createGrant(input: { templateId: string; action: LetterAction; roleCode?: string; userId?: string }, viewer: LetterViewer, meta: ActorMeta) {
  assertDirector(viewer, "allow others to prepare or issue letters");
  const proof = await templatePayFree(input.templateId);
  if (!proof) throw new HttpError(404, "Template not found.", "NOT_FOUND");
  if (!proof.ok) throw new HttpError(403, `This letter could carry a pay figure, so it stays with the directors. ${proof.reasons.join(" ")}`, "PAY_LETTER_DIRECTOR_ONLY", { reasons: proof.reasons });
  if (input.roleCode && !(await prisma.role.findUnique({ where: { code: input.roleCode } }))) throw new HttpError(400, "No such role.", "VALIDATION_ERROR");
  if (input.userId && !(await prisma.user.findUnique({ where: { id: input.userId } }))) throw new HttpError(400, "No such person.", "VALIDATION_ERROR");
  const same = await prisma.letterTemplateGrant.findFirst({ where: { templateId: input.templateId, action: input.action, revokedAt: null, roleCode: input.roleCode ?? null, userId: input.userId ?? null } });
  if (same) return { id: same.id, created: false };
  const g = await prisma.letterTemplateGrant.create({ data: { templateId: input.templateId, action: input.action, roleCode: input.roleCode ?? null, userId: input.userId ?? null, grantedByUserId: viewer.userId } });
  await writeAuditLog({ ...meta, action: "letters.grant.created", entityType: "LetterTemplateGrant", entityId: g.id, after: { template: proof.code, action: input.action, roleCode: input.roleCode ?? null, userId: input.userId ?? null } });
  return { id: g.id, created: true };
}

export async function revokeGrant(id: string, viewer: LetterViewer, meta: ActorMeta) {
  assertDirector(viewer, "withdraw a letter permission");
  const g = await prisma.letterTemplateGrant.findUnique({ where: { id } });
  if (!g || g.revokedAt) throw new HttpError(404, "Not found.", "NOT_FOUND");
  await prisma.letterTemplateGrant.update({ where: { id }, data: { revokedAt: new Date(), revokedByUserId: viewer.userId } });
  await writeAuditLog({ ...meta, action: "letters.grant.revoked", entityType: "LetterTemplateGrant", entityId: id, before: { templateId: g.templateId, action: g.action, roleCode: g.roleCode, userId: g.userId } });
}
