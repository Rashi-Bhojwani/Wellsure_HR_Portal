import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { DOCUMENT_MIME_TYPES, type DocumentMimeType } from "@shared/constants/peopleDocuments";
import { prisma } from "../../lib/prisma";
import { redis } from "../../lib/redis";
import { logger } from "../../lib/logger";
import { resolveAccess } from "../../lib/permissions";
import { writeAuditLogs } from "../../lib/audit";
import { decryptField, encryptField } from "../../lib/encryption";
import { prepareDocumentUpload, requireFile } from "../../lib/uploads";
import { storageService } from "../../integrations/storage";
import { HttpError } from "../../middleware/errorHandler";
import type { AuthenticatedUser } from "../../middleware/types";
import { findScopedEmployee, updateBank, updateStatutory } from "../employee/service";
import * as identity from "../employee/identityChanges";
import { context as recruitmentContext } from "../recruitment/access";
import { fingerprint, normalizeEmail, normalizeName, normalizePhone, retained } from "../recruitment/candidates";
import { DOC_KINDS, FIELDS, SUBJECT_OF, fieldDef, parse, type Authority, type DocKind, type Suggestion } from "./fields";
import { ExtractionError, localProvider, type ExtractionProvider } from "./provider";

// Document autofill (Peeps stage 2). Upload → validation → queued extraction → suggestions a reviewer confirms or corrects field by
// field → the existing change workflow saves accepted data. Extraction NEVER writes to an employee or a candidate: only `apply`
// does, and only through the existing writers (bank and statutory entries go through the held-change controls, so a director
// confirms them while the director setting is on). Values never reach logs, queue payloads, notifications or audit diffs; the
// extraction result and reviewed values are encrypted at rest; the raw text is never stored.

type Meta = { actorUserId: string; ipAddress?: string | null; userAgent?: string | null };
export const SETTING_SCHEMAS = {
  uploads: z.object({ allowedMimeTypes: z.array(z.enum(Object.keys(DOCUMENT_MIME_TYPES) as [DocumentMimeType, ...DocumentMimeType[]])).min(1), maxMb: z.number().positive().max(25) }).strict(),
  retention: z.object({ days: z.number().int().min(1).max(3650) }).strict(),
} as const;
export type SettingKey = keyof typeof SETTING_SCHEMAS;
/** Conventional starting values (Default, change in settings). Retention has none: it stays Not set and uploads refuse until chosen. */
export const SETTING_DEFAULTS: Partial<{ [K in SettingKey]: z.infer<(typeof SETTING_SCHEMAS)[K]> }> = { uploads: { allowedMimeTypes: ["application/pdf", "image/png", "image/jpeg"], maxMb: 10 } };
export const keySchema = z.enum(Object.keys(SETTING_SCHEMAS) as [SettingKey, ...SettingKey[]]);
export const settingInput = z.object({ value: z.unknown(), version: z.number().int().min(0), reason: z.string().trim().min(1).max(2000) }).strict();
export const uploadFields = z.object({ subjectKind: z.enum(["CANDIDATE", "EMPLOYEE"]), subjectId: z.string().min(1).max(100), docKind: z.enum(DOC_KINDS) }).strict();
export const reviewInput = z.object({ decision: z.enum(["ACCEPTED", "CORRECTED", "REJECTED"]), value: z.string().trim().max(400).optional() }).strict();
export const rerunInput = z.object({ idempotencyKey: z.string().min(8).max(100) }).strict();
export const applyInput = z.object({ effectiveFrom: z.iso.date().optional() }).strict();
export const listInput = z.object({ subjectKind: z.enum(["CANDIDATE", "EMPLOYEE"]).optional(), subjectId: z.string().min(1).max(100).optional() }).strict();

/** Technical controls (not business values): timeout per extraction, runs per document, requests per person per 10 minutes. */
export const CONTROLS = { timeoutMs: 60_000, maxRunsPerDocument: 5, perUserPer10Min: 30 } as const;
let provider: ExtractionProvider = localProvider;
/** Tests only: swap the provider (for example a slow or failing one). */
export function useProviderForTests(p: ExtractionProvider | null) { provider = p ?? localProvider; }

// ── Settings ──
const latest = (key: SettingKey) => prisma.autofillSettingVersion.findFirst({ where: { key }, orderBy: { version: "desc" } });
export async function getSetting<K extends SettingKey>(key: K): Promise<z.infer<(typeof SETTING_SCHEMAS)[K]> | null> {
  const row = await latest(key);
  if (!row) return (SETTING_DEFAULTS[key] as z.infer<(typeof SETTING_SCHEMAS)[K]> | undefined) ?? null;
  return row.value == null ? null : (SETTING_SCHEMAS[key].parse(row.value) as z.infer<(typeof SETTING_SCHEMAS)[K]>);
}

// ── Who may do what ──
async function viewerOf(actor: AuthenticatedUser) {
  const access = await resolveAccess(actor.userId);
  if (access.roleCodes.includes("DEVELOPER")) throw new HttpError(403, "Document autofill is unavailable to Developer.", "FORBIDDEN");
  let recruitment = false;
  try { recruitment = (await recruitmentContext({ ...actor, ...access })).manage; } catch { recruitment = false; }
  const can: Record<Authority, boolean> = { RECRUITMENT: recruitment, PERSONAL: access.permissions.has("employee.edit"), STATUTORY: access.permissions.has("employee.statutory.edit"), BANK: access.permissions.has("employee.bank.edit") };
  return { ...actor, access, isDirector: access.isSuperAdmin, can };
}
type Viewer = Awaited<ReturnType<typeof viewerOf>>;
const notFound = () => new HttpError(404, "Document not found.", "NOT_FOUND");
async function assertSubject(v: Viewer, subjectKind: "CANDIDATE" | "EMPLOYEE", subjectId: string, kind: DocKind) {
  if (SUBJECT_OF[kind] !== subjectKind) throw new HttpError(400, `${kind} documents belong to a ${SUBJECT_OF[kind].toLowerCase()}.`, "VALIDATION_ERROR");
  const authorities = new Set(FIELDS[kind].map((f) => f.authority));
  if (![...authorities].some((a) => v.can[a])) throw new HttpError(403, "You cannot review this kind of document.", "FORBIDDEN");
  if (subjectKind === "CANDIDATE") {
    const c = await prisma.candidate.findUnique({ where: { id: subjectId } });
    if (!c || !retained(c)) throw notFound();
  } else {
    try { await findScopedEmployee(subjectId, v.employeeId, v.access.dataScope); } catch { throw notFound(); }
  }
}
async function readDocument(id: string, v: Viewer) {
  const doc = await prisma.autofillDocument.findUnique({ where: { id }, include: { extraction: true, reviews: true } });
  if (!doc || doc.purgedAt) throw notFound();
  await assertSubject(v, doc.subjectKind as "CANDIDATE" | "EMPLOYEE", doc.subjectId, doc.docKind as DocKind).catch((e: unknown) => { throw e instanceof HttpError && e.status === 400 ? notFound() : e; });
  return doc;
}
async function rateLimit(userId: string) {
  const key = `ratelimit:autofill:${userId}`;
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, 600);
  if (n > CONTROLS.perUserPer10Min) throw new HttpError(429, "Too many document reads. Try again later.", "RATE_LIMITED");
}

export async function status(actor: AuthenticatedUser) {
  const v = await viewerOf(actor);
  const retention = await getSetting("retention");
  return { canResume: v.can.RECRUITMENT, canIdentity: v.can.STATUTORY, canBank: v.can.BANK, isDirector: v.isDirector, retentionSet: retention !== null, uploads: await getSetting("uploads") };
}
export async function viewSettings(actor: AuthenticatedUser) {
  const v = await viewerOf(actor);
  if (!v.isDirector && !v.can.BANK && !v.can.STATUTORY && !v.can.RECRUITMENT) throw new HttpError(403, "Document autofill is unavailable.", "FORBIDDEN");
  return { canEdit: v.isDirector, settings: await Promise.all((Object.keys(SETTING_SCHEMAS) as SettingKey[]).map(async (key) => { const r = await latest(key); const d = SETTING_DEFAULTS[key]; if (!r && d) return { key, state: "DEFAULT", version: 0, value: d }; return { key, state: r?.value == null ? "NOT_SET" : "CONFIRMED", version: r?.version ?? 0, value: r?.value ?? null }; })) };
}
export async function setSetting(key: SettingKey, input: z.infer<typeof settingInput>, actor: AuthenticatedUser, meta: Meta) {
  const v = await viewerOf(actor);
  if (!v.isDirector) throw new HttpError(403, "Only a director chooses autofill settings.", "FORBIDDEN");
  const value = input.value === null ? null : SETTING_SCHEMAS[key].parse(input.value);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('peeps.autofill.setting'), hashtext(${key}))::text`;
    const prior = await tx.autofillSettingVersion.findFirst({ where: { key }, orderBy: { version: "desc" } });
    if ((prior?.version ?? 0) !== input.version) throw new HttpError(409, "This setting changed. Reload before saving.", "CONFLICT");
    const row = await tx.autofillSettingVersion.create({ data: { key, version: input.version + 1, value: value === null ? Prisma.JsonNull : value, reason: input.reason, changedByUserId: actor.userId } });
    await writeAuditLogs([{ ...meta, action: "autofill.setting.confirmed", entityType: "AutofillSettingVersion", entityId: row.id, after: { key, version: row.version } }], tx);
  });
  return viewSettings(actor);
}

// ── Upload and extraction ──
export async function upload(actor: AuthenticatedUser, input: z.infer<typeof uploadFields>, file: Express.Multer.File | undefined, meta: Meta, enqueue: (extractionId: string) => Promise<void>) {
  const v = await viewerOf(actor);
  await assertSubject(v, input.subjectKind, input.subjectId, input.docKind);
  const retention = await getSetting("retention");
  if (!retention) throw new HttpError(409, "Autofill: retention is Not set. A director must choose how long documents are kept first.", "AUTOFILL_NOT_SET");
  const limits = (await getSetting("uploads"))!;
  await rateLimit(actor.userId);
  const prepared = await prepareDocumentUpload(requireFile(file), { documentMaxUploadMb: limits.maxMb, documentAllowedMimeTypes: limits.allowedMimeTypes });
  const id = randomUUID();
  const key = `autofill/${id}`;
  await storageService.putObject(key, prepared.buffer, prepared.mimeType);
  try {
    const doc = await prisma.$transaction(async (tx) => {
      const d = await tx.autofillDocument.create({ data: { id, subjectKind: input.subjectKind, subjectId: input.subjectId, docKind: input.docKind, storageKey: key, mimeType: prepared.mimeType, sizeBytes: prepared.sizeBytes, sha256: createHash("sha256").update(prepared.buffer).digest("hex"), uploadedByUserId: actor.userId, retentionUntil: new Date(Date.now() + retention.days * 86_400_000) } });
      await tx.autofillExtraction.create({ data: { documentId: d.id, provider: provider.name, providerVersion: provider.version } });
      await writeAuditLogs([{ ...meta, action: "autofill.document.uploaded", entityType: "AutofillDocument", entityId: d.id, after: { subjectKind: input.subjectKind, docKind: input.docKind } }], tx);
      return tx.autofillDocument.findUniqueOrThrow({ where: { id: d.id }, include: { extraction: true } });
    });
    await enqueue(doc.extraction!.id); // the queue payload is this id only
    return { id: doc.id, extractionStatus: doc.extraction!.status };
  } catch (error) {
    await storageService.deleteObject(key).catch(() => undefined);
    throw error;
  }
}

/**
 * Runs one extraction. Concurrent runs for one document collapse to one: the claim is a single conditional UPDATE, so a second
 * caller finds the row already RUNNING and returns. The result replaces only the suggestions; reviewers' decisions live in their
 * own rows and are never touched here. Nothing is written to an employee or a candidate.
 */
export async function runExtraction(extractionId: string): Promise<{ claimed: boolean; status: string }> {
  const claimed = await prisma.$queryRaw<Array<{ id: string }>>`UPDATE autofill_extractions SET status = 'RUNNING', attempts = attempts + 1, runs = runs + 1, started_at = now() WHERE id = ${extractionId} AND status = 'QUEUED' RETURNING id`;
  if (!claimed.length) return { claimed: false, status: (await prisma.autofillExtraction.findUnique({ where: { id: extractionId } }))?.status ?? "MISSING" };
  const row = await prisma.autofillExtraction.findUniqueOrThrow({ where: { id: extractionId }, include: { document: true } });
  const started = Date.now();
  try {
    if (!row.document.storageKey || row.document.purgedAt) throw new ExtractionError("EMPTY", "The document is no longer kept.");
    const object = await storageService.getObject(row.document.storageKey);
    const out = await provider.extract({ buffer: object.body, mimeType: row.document.mimeType, timeoutMs: CONTROLS.timeoutMs });
    const suggestions = parse(row.document.docKind as DocKind, out.text, out.confidence);
    if (Object.values(suggestions).every((s) => s.missing)) throw new ExtractionError("EMPTY", "Nothing usable was found. Enter the details by hand.");
    await prisma.autofillExtraction.update({ where: { id: extractionId }, data: { status: "DONE", engine: out.engine, provider: provider.name, providerVersion: provider.version, resultEncrypted: encryptField(JSON.stringify(suggestions)), failureCode: null, durationMs: Date.now() - started, finishedAt: new Date() } });
    return { claimed: true, status: "DONE" };
  } catch (error) {
    const code = error instanceof ExtractionError ? error.code : "UNSUPPORTED";
    // Never the document text or a value in the log: only ids and the failure code.
    logger.info({ event: "autofill.extraction.failed", extractionId, code }, "Document autofill could not read a document");
    await prisma.autofillExtraction.update({ where: { id: extractionId }, data: { status: "FAILED", failureCode: code, resultEncrypted: null, durationMs: Date.now() - started, finishedAt: new Date() } });
    return { claimed: true, status: "FAILED" };
  }
}

export async function rerun(id: string, actor: AuthenticatedUser, input: z.infer<typeof rerunInput>, meta: Meta, enqueue: (extractionId: string) => Promise<void>) {
  const v = await viewerOf(actor);
  const doc = await readDocument(id, v);
  if (doc.extraction?.idempotencyKey === input.idempotencyKey) return { id, extractionStatus: doc.extraction.status }; // a retried request
  if (doc.extraction?.status === "RUNNING" || doc.extraction?.status === "QUEUED") return { id, extractionStatus: doc.extraction.status };
  if ((doc.extraction?.runs ?? 0) >= CONTROLS.maxRunsPerDocument) throw new HttpError(429, "This document has been read the maximum number of times. Enter the details by hand.", "RATE_LIMITED");
  await rateLimit(actor.userId);
  const n = await prisma.autofillExtraction.updateMany({ where: { documentId: id, status: { in: ["DONE", "FAILED"] } }, data: { status: "QUEUED", idempotencyKey: input.idempotencyKey } });
  if (n.count) {
    await writeAuditLogs([{ ...meta, action: "autofill.extraction.requeued", entityType: "AutofillDocument", entityId: id }]);
    await enqueue(doc.extraction!.id);
  }
  return { id, extractionStatus: "QUEUED" };
}

// ── Reading and reviewing ──
const open = (b: Uint8Array | null) => (b ? decryptField(b) : null);
export async function getDocument(id: string, actor: AuthenticatedUser) {
  const v = await viewerOf(actor);
  const doc = await readDocument(id, v);
  const suggestions: Record<string, Suggestion> = doc.extraction?.resultEncrypted ? JSON.parse(open(doc.extraction.resultEncrypted)!) : {};
  return {
    id: doc.id, subjectKind: doc.subjectKind, subjectId: doc.subjectId, docKind: doc.docKind, mimeType: doc.mimeType, sizeBytes: doc.sizeBytes, createdAt: doc.createdAt.toISOString(),
    appliedAt: doc.appliedAt?.toISOString() ?? null, appliedVia: doc.appliedVia,
    provenance: { provider: doc.extraction?.provider ?? null, providerVersion: doc.extraction?.providerVersion ?? null, engine: doc.extraction?.engine ?? null, sha256: doc.sha256, runs: doc.extraction?.runs ?? 0, durationMs: doc.extraction?.durationMs ?? null, finishedAt: doc.extraction?.finishedAt?.toISOString() ?? null },
    extraction: { status: doc.extraction?.status ?? "MISSING", failureCode: doc.extraction?.failureCode ?? null },
    notice: "Suggestions are readings of the document, not a verified identity or verified bank ownership.",
    fields: FIELDS[doc.docKind as DocKind].map((def) => {
      const authorized = v.can[def.authority];
      const review = doc.reviews.find((r) => r.field === def.field);
      const s = suggestions[def.field];
      return authorized
        ? { field: def.field, label: def.label, authorized, suggestion: s ?? null, review: review ? { decision: review.decision, value: open(review.valueEncrypted), at: review.createdAt.toISOString() } : null }
        : { field: def.field, label: def.label, authorized, suggestion: null, review: review ? { decision: review.decision, value: null, at: review.createdAt.toISOString() } : null };
    }),
  };
}
export async function listDocuments(actor: AuthenticatedUser, input: z.infer<typeof listInput>) {
  const v = await viewerOf(actor);
  if (!v.can.RECRUITMENT && !v.can.BANK && !v.can.STATUTORY) throw new HttpError(403, "Document autofill is unavailable.", "FORBIDDEN");
  const rows = await prisma.autofillDocument.findMany({ where: { purgedAt: null, ...(input.subjectKind ? { subjectKind: input.subjectKind } : {}), ...(input.subjectId ? { subjectId: input.subjectId } : {}) }, include: { extraction: { select: { status: true, failureCode: true } } }, orderBy: { createdAt: "desc" }, take: 100 });
  const out = [];
  for (const r of rows) {
    try { await assertSubject(v, r.subjectKind as "CANDIDATE" | "EMPLOYEE", r.subjectId, r.docKind as DocKind); } catch { continue; }
    out.push({ id: r.id, subjectKind: r.subjectKind, subjectId: r.subjectId, docKind: r.docKind, createdAt: r.createdAt.toISOString(), status: r.extraction?.status ?? "MISSING", failureCode: r.extraction?.failureCode ?? null, applied: Boolean(r.appliedAt) });
  }
  return { items: out };
}
export async function file(id: string, actor: AuthenticatedUser, meta: Meta) {
  const v = await viewerOf(actor);
  const doc = await readDocument(id, v);
  if (!doc.storageKey) throw notFound();
  const object = await storageService.getObject(doc.storageKey);
  await writeAuditLogs([{ ...meta, action: "autofill.document.opened", entityType: "AutofillDocument", entityId: id }]);
  return object;
}

/** One field: the reviewer must hold that field's own authority, whatever the screen showed. */
export async function review(id: string, field: string, actor: AuthenticatedUser, input: z.infer<typeof reviewInput>, meta: Meta) {
  const v = await viewerOf(actor);
  const doc = await readDocument(id, v);
  const def = fieldDef(doc.docKind as DocKind, field);
  if (!def) throw new HttpError(404, "This document has no such field.", "NOT_FOUND");
  if (!v.can[def.authority]) throw new HttpError(403, "You are not authorised to review this field.", "FORBIDDEN");
  if (doc.appliedAt) throw new HttpError(409, "This document's values were already saved.", "CONFLICT");
  let value: string | null = null;
  if (input.decision === "ACCEPTED") {
    const s: Record<string, Suggestion> = doc.extraction?.resultEncrypted ? JSON.parse(open(doc.extraction.resultEncrypted)!) : {};
    const sug = s[field];
    if (!sug?.value || sug.error) throw new HttpError(409, "There is no valid suggestion to accept. Correct it instead.", "CONFLICT");
    value = sug.value;
  } else if (input.decision === "CORRECTED") {
    const checked = def.check.safeParse(input.value ?? "");
    if (!checked.success) throw new HttpError(400, checked.error.issues[0]?.message ?? "Not valid.", "VALIDATION_ERROR");
    value = checked.data;
  }
  const valueEncrypted = value === null ? null : encryptField(value);
  await prisma.$transaction(async (tx) => {
    await tx.autofillFieldReview.upsert({ where: { documentId_field: { documentId: id, field } }, create: { documentId: id, field, decision: input.decision, valueEncrypted, reviewerUserId: actor.userId }, update: { decision: input.decision, valueEncrypted, reviewerUserId: actor.userId } });
    await writeAuditLogs([{ ...meta, action: "autofill.field.reviewed", entityType: "AutofillDocument", entityId: id, after: { field, decision: input.decision } }], tx);
  });
  return getDocument(id, actor);
}

/**
 * Saves the reviewed values through the existing workflows. Only fields a reviewer ACCEPTED or CORRECTED are used, and only by a
 * person who holds every authority involved. Bank and statutory values go through the held-change controls exactly as the employee
 * screen does (a director confirms them while `identity.directorConfirmsHrChanges` is on). Never an empty or guessed value.
 */
export async function apply(id: string, actor: AuthenticatedUser, input: z.infer<typeof applyInput>, meta: Meta) {
  const v = await viewerOf(actor);
  const doc = await readDocument(id, v);
  if (doc.appliedAt) return { id, appliedVia: doc.appliedVia, alreadyApplied: true };
  const kind = doc.docKind as DocKind;
  const accepted = new Map(doc.reviews.filter((r) => r.decision !== "REJECTED" && r.valueEncrypted).map((r) => [r.field, decryptField(r.valueEncrypted!)]));
  if (!accepted.size) throw new HttpError(409, "Confirm or correct at least one field first.", "NOTHING_TO_SAVE");
  for (const f of accepted.keys()) if (!v.can[fieldDef(kind, f)!.authority]) throw new HttpError(403, "You are not authorised to save one of these fields.", "FORBIDDEN");
  const reqMeta = { actorUserId: actor.userId, ipAddress: meta.ipAddress ?? null, userAgent: meta.userAgent ?? null };
  let via = "";
  if (kind === "BANK") {
    const need = ["accountHolderName", "accountNumber", "ifsc", "bankName", "branchName"];
    const missing = need.filter((f) => !accepted.has(f));
    if (missing.length) throw new HttpError(409, `Confirm or correct every bank field first (missing: ${missing.join(", ")}).`, "INCOMPLETE");
    const bank = { accountHolderName: accepted.get("accountHolderName")!, accountNumber: accepted.get("accountNumber")!, ifsc: accepted.get("ifsc")!, bankName: accepted.get("bankName")!, branchName: accepted.get("branchName")! };
    const reason = await identity.holdReasonFor(actor.userId, doc.subjectId);
    if (reason) { await identity.hold({ employeeId: doc.subjectId, kind: "BANK", payload: identity.packBank(bank), effectiveFrom: input.effectiveFrom ? new Date(input.effectiveFrom) : null, source: reason === "HR_ENTRY" ? "HR_EDIT" : "DIRECTOR_EDIT" }, reason, reqMeta); via = "HELD_FOR_DIRECTOR"; }
    else { await updateBank(doc.subjectId, { ...bank, effectiveFrom: input.effectiveFrom }, reqMeta); via = "SAVED"; }
  } else if (kind === "IDENTITY") {
    if (!accepted.has("pan") && !accepted.has("aadhaar")) throw new HttpError(409, "Confirm or correct the PAN or Aadhaar first; the name on the document is never saved.", "NOTHING_TO_SAVE");
    const statutory = { ...(accepted.has("pan") ? { pan: accepted.get("pan")! } : {}), ...(accepted.has("aadhaar") ? { aadhaar: accepted.get("aadhaar")! } : {}) };
    const reason = await identity.holdReasonFor(actor.userId, doc.subjectId);
    if (reason) { await identity.hold({ employeeId: doc.subjectId, kind: "STATUTORY", payload: identity.packStatutory(statutory), effectiveFrom: null, source: reason === "HR_ENTRY" ? "HR_EDIT" : "DIRECTOR_EDIT" }, reason, reqMeta); via = "HELD_FOR_DIRECTOR"; }
    else { await updateStatutory(doc.subjectId, statutory, reqMeta); via = "SAVED"; }
  } else {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM candidates WHERE id=${doc.subjectId} FOR UPDATE`;
      const c = await tx.candidate.findUniqueOrThrow({ where: { id: doc.subjectId } });
      if (!retained(c)) throw notFound();
      const data: Prisma.CandidateUpdateInput = {};
      if (accepted.has("fullName")) { data.nameEncrypted = encryptField(accepted.get("fullName")!); data.nameHash = fingerprint(normalizeName(accepted.get("fullName")!)); }
      if (accepted.has("email")) { data.emailEncrypted = encryptField(accepted.get("email")!); data.emailHash = fingerprint(normalizeEmail(accepted.get("email")!)); }
      if (accepted.has("phone")) { data.phoneEncrypted = encryptField(accepted.get("phone")!); data.phoneHash = fingerprint(normalizePhone(accepted.get("phone")!)); }
      try { await tx.candidate.update({ where: { id: doc.subjectId }, data }); }
      catch (e) { if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new HttpError(409, "Another candidate already has this email or phone.", "DUPLICATE_CANDIDATE"); throw e; }
      await writeAuditLogs([{ ...meta, action: "recruitment.candidate.updated", entityType: "Candidate", entityId: doc.subjectId, after: { fields: [...accepted.keys()], source: "AUTOFILL" } }], tx);
    });
    via = "SAVED";
  }
  const marked = await prisma.autofillDocument.updateMany({ where: { id, appliedAt: null }, data: { appliedAt: new Date(), appliedByUserId: actor.userId, appliedVia: via } });
  if (marked.count) await writeAuditLogs([{ ...meta, action: "autofill.applied", entityType: "AutofillDocument", entityId: id, after: { fields: [...accepted.keys()], via } }]);
  return { id, appliedVia: via, alreadyApplied: false };
}

// ── Retention ──
export async function purgeExpired(now = new Date()) {
  const rows = await prisma.autofillDocument.findMany({ where: { purgedAt: null, retentionUntil: { lte: now } }, select: { id: true, storageKey: true }, take: 500 });
  for (const r of rows) {
    if (r.storageKey) await storageService.deleteObject(r.storageKey);
    await prisma.$transaction([
      prisma.autofillExtraction.updateMany({ where: { documentId: r.id }, data: { resultEncrypted: null } }),
      prisma.autofillFieldReview.updateMany({ where: { documentId: r.id }, data: { valueEncrypted: null } }),
      prisma.autofillDocument.update({ where: { id: r.id }, data: { storageKey: null, purgedAt: now } }),
    ]);
  }
  return { purged: rows.length };
}
