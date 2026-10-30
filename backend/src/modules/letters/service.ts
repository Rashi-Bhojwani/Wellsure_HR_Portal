import type { DataScope } from "@shared/constants/roles";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import sharp from "sharp";
import { formatLetterNumber, LETTER_PLACEHOLDERS, type LetterExtraField } from "@shared/constants/letters";
import { canReadSensitivity } from "@shared/constants/peopleDocuments";
import { storageService } from "../../integrations/storage";
import { writeAuditLog } from "../../lib/audit";
import { renderPdf } from "../../lib/pdf/renderer";
import { prisma } from "../../lib/prisma";
import { getSetting, setSetting } from "../../lib/settings";
import { HttpError } from "../../middleware/errorHandler";
import { emitLetterUpdated } from "../../realtime/emit";
import { findScopedEmployee } from "../employee/service";
import { notifyEmployee } from "../notifications/notifyEmployee";
import { letterDocument, mergeIntoBody, payFreeProof, payFreeValueProblem, sanitizeTemplateHtml, validateExtraFields, validatePlaceholders, type Letterhead } from "./template";
import { inForceOn } from "../../lib/effectiveDating";

// Letters (spec §7.2, Phase 5 commit D2). Letters are legal documents
// (user, 2026-10-01):
//   - every issued letter stores its template VERSION, every MERGE VALUE
//     (already formatted, plus a letterhead snapshot) and its GENERATION
//     TIMESTAMP, so it can be re-rendered exactly (reproduce());
//   - nothing issued is ever replaced: reissue() creates a new letter and a
//     new document. Database triggers back this up (see the migration).
// Generation is two-step: the API resolves and freezes the merge values,
// then a BullMQ job renders the PDF (Chromium lives in the worker's budget).

export interface LetterViewer {
  userId: string;
  employeeId: string;
  roleCodes: string[];
  dataScope: DataScope; // resolved per request (lib/permissions.ts)
  permissions: Set<string>;
}
export interface ActorMeta {
  actorUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export const SIGNATORY_NAME_KEY = "letters.signatoryName";
export const SIGNATORY_DESIGNATION_KEY = "letters.signatoryDesignation";
const LETTERS_CATEGORY_CODE = "LETTERS";
const TZ = "Asia/Kolkata";

// What a GeneratedLetter.mergeValues holds — everything needed to re-render.
export interface StoredMergeValues {
  values: Record<string, string>; // placeholder key → final text, e.g. "employee.fullName" → "Arjun Singh"
  letterhead: Letterhead;
  templateName: string;
  templateCode: string;
}

// ── Formatting (done once, at issue time; the stored strings are what print) ──
const longDate = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: TZ });
const dateOnlyLong = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }); // @db.Date columns
function istDateOnly(d: Date): Date {
  const [y, m, day] = d.toLocaleDateString("en-CA", { timeZone: TZ }).split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, day));
}
function formatExtra(field: LetterExtraField, raw: string): string {
  const v = raw.trim();
  if (v === "") return "";
  if (field.type === "currency" || field.type === "number") {
    const n = Number(v.replace(/,/g, ""));
    if (!Number.isFinite(n)) throw new HttpError(400, `"${field.label}" must be a number.`, "VALIDATION_ERROR");
    return field.type === "currency"
      ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2, minimumFractionDigits: n % 1 === 0 ? 0 : 2 }).format(n)
      : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);
  }
  if (field.type === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw new HttpError(400, `"${field.label}" must be a date (YYYY-MM-DD).`, "VALIDATION_ERROR");
    return dateOnlyLong(new Date(`${v}T00:00:00Z`));
  }
  return v;
}

const extraFieldsOf = (json: Prisma.JsonValue) => json as unknown as LetterExtraField[];

// Key-order-independent JSON (Postgres jsonb doesn't keep key order, so a
// round-tripped value never stringifies the same as the original).
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// ── Templates ──────────────────────────────────────────────────────────

async function currentVersion(templateId: string) {
  return prisma.letterTemplateVersion.findFirst({ where: { templateId }, orderBy: { version: "desc" } });
}

export async function listTemplates() {
  const rows = await prisma.letterTemplate.findMany({
    include: { versions: { orderBy: { version: "desc" }, take: 1 }, _count: { select: { versions: true } } },
    orderBy: { name: "asc" },
  });
  return rows.map((t) => ({
    id: t.id,
    code: t.code,
    name: t.name,
    description: t.description,
    isActive: t.isActive,
    visibleToEmployeeDefault: t.visibleToEmployeeDefault,
    currentVersion: t.versions[0]?.version ?? 0,
    extraFields: t.versions[0] ? extraFieldsOf(t.versions[0].extraFields) : [],
    // What HR without the pay-letters key may issue: shown on the screen, enforced again when issuing.
    payFree: t.versions[0] ? payFreeProof(t.versions[0].bodyHtml, extraFieldsOf(t.versions[0].extraFields)) : { ok: false, reasons: ["The template has no content yet."] },
    lastEditedAt: (t.versions[0]?.createdAt ?? t.updatedAt).toISOString(),
  }));
}

export async function getTemplate(id: string) {
  const t = await prisma.letterTemplate.findUnique({ where: { id }, include: { versions: { orderBy: { version: "desc" } } } });
  if (!t) throw new HttpError(404, "Template not found.", "NOT_FOUND");
  return {
    id: t.id,
    code: t.code,
    name: t.name,
    description: t.description,
    isActive: t.isActive,
    visibleToEmployeeDefault: t.visibleToEmployeeDefault,
    versions: t.versions.map((v) => ({
      id: v.id,
      version: v.version,
      bodyHtml: v.bodyHtml,
      extraFields: extraFieldsOf(v.extraFields),
      createdByUserId: v.createdByUserId,
      createdAt: v.createdAt.toISOString(),
    })),
  };
}

function prepareBody(bodyHtml: string, extraFields: LetterExtraField[]): string {
  validateExtraFields(extraFields);
  const clean = sanitizeTemplateHtml(bodyHtml);
  if (!clean) throw new HttpError(400, "The letter can't be empty.", "VALIDATION_ERROR");
  validatePlaceholders(clean, extraFields);
  return clean;
}

export async function createTemplate(
  input: { code: string; name: string; description?: string | null; visibleToEmployeeDefault?: boolean; bodyHtml: string; extraFields: LetterExtraField[] },
  meta: ActorMeta,
) {
  const bodyHtml = prepareBody(input.bodyHtml, input.extraFields);
  try {
    const t = await prisma.letterTemplate.create({
      data: {
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        visibleToEmployeeDefault: input.visibleToEmployeeDefault ?? true,
        versions: { create: { version: 1, bodyHtml, extraFields: input.extraFields as unknown as Prisma.InputJsonValue, createdByUserId: meta.actorUserId } },
      },
    });
    await writeAuditLog({ ...meta, action: "letters.template.created", entityType: "LetterTemplate", entityId: t.id, after: { code: t.code, name: t.name, version: 1 } });
    return getTemplate(t.id);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new HttpError(409, `A template with code "${input.code}" already exists.`, "CONFLICT");
    throw err;
  }
}

// Wording/fields changes always add a version; earlier versions (and every
// letter issued from them) stay exactly as they were.
export async function saveNewVersion(templateId: string, input: { bodyHtml: string; extraFields: LetterExtraField[] }, meta: ActorMeta) {
  const template = await prisma.letterTemplate.findUnique({ where: { id: templateId } });
  if (!template) throw new HttpError(404, "Template not found.", "NOT_FOUND");
  const bodyHtml = prepareBody(input.bodyHtml, input.extraFields);
  const latest = await currentVersion(templateId);
  if (latest && latest.bodyHtml === bodyHtml && canonicalJson(latest.extraFields) === canonicalJson(input.extraFields)) {
    return getTemplate(templateId); // nothing changed — no empty version
  }
  const version = (latest?.version ?? 0) + 1;
  try {
    await prisma.letterTemplateVersion.create({
      data: { templateId, version, bodyHtml, extraFields: input.extraFields as unknown as Prisma.InputJsonValue, createdByUserId: meta.actorUserId },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new HttpError(409, "Someone else saved this template just now. Reload and try again.", "CONFLICT");
    throw err;
  }
  await writeAuditLog({ ...meta, action: "letters.template.versioned", entityType: "LetterTemplate", entityId: templateId, before: { version: latest?.version ?? 0 }, after: { version } });
  return getTemplate(templateId);
}

export async function updateTemplateSettings(
  templateId: string,
  input: { name?: string; description?: string | null; isActive?: boolean; visibleToEmployeeDefault?: boolean },
  meta: ActorMeta,
) {
  const before = await prisma.letterTemplate.findUnique({ where: { id: templateId } });
  if (!before) throw new HttpError(404, "Template not found.", "NOT_FOUND");
  const after = await prisma.letterTemplate.update({ where: { id: templateId }, data: input });
  await writeAuditLog({
    ...meta,
    action: "letters.template.updated",
    entityType: "LetterTemplate",
    entityId: templateId,
    before: { name: before.name, description: before.description, isActive: before.isActive, visibleToEmployeeDefault: before.visibleToEmployeeDefault },
    after: { name: after.name, description: after.description, isActive: after.isActive, visibleToEmployeeDefault: after.visibleToEmployeeDefault },
  });
  return getTemplate(templateId);
}

// ── Letterhead and signatory ───────────────────────────────────────────

export async function getLetterhead() {
  const company = await prisma.company.findFirst({ orderBy: { createdAt: "asc" } });
  const [signatoryName, signatoryDesignation] = await Promise.all([getSetting<string>(SIGNATORY_NAME_KEY, ""), getSetting<string>(SIGNATORY_DESIGNATION_KEY, "")]);
  return {
    legalName: company?.legalName ?? "",
    registeredAddress: company?.registeredAddress ?? "",
    hasLogo: Boolean(company?.logoStorageKey),
    signatoryName,
    signatoryDesignation,
  };
}

export async function updateLetterhead(
  input: { legalName?: string; registeredAddress?: string; signatoryName?: string; signatoryDesignation?: string },
  meta: ActorMeta,
) {
  const before = await getLetterhead();
  const company = await prisma.company.findFirst({ orderBy: { createdAt: "asc" } });
  if (!company) throw new HttpError(409, "No company record exists.", "CONFLICT");
  if (input.legalName !== undefined || input.registeredAddress !== undefined) {
    await prisma.company.update({
      where: { id: company.id },
      data: { ...(input.legalName !== undefined && { legalName: input.legalName }), ...(input.registeredAddress !== undefined && { registeredAddress: input.registeredAddress }) },
    });
  }
  if (input.signatoryName !== undefined) await setSetting(SIGNATORY_NAME_KEY, input.signatoryName, meta.actorUserId);
  if (input.signatoryDesignation !== undefined) await setSetting(SIGNATORY_DESIGNATION_KEY, input.signatoryDesignation, meta.actorUserId);
  const after = await getLetterhead();
  await writeAuditLog({ ...meta, action: "letters.letterhead.updated", entityType: "Company", entityId: company.id, before, after });
  return after;
}

// A new logo always gets a NEW storage key; earlier logos are kept, because
// earlier letters reference them by key (and hash) for reproduction.
export async function uploadLogo(file: Express.Multer.File, meta: ActorMeta) {
  if (file.size > 2 * 1024 * 1024) throw new HttpError(400, "The logo must be 2 MB or smaller.", "INVALID_UPLOAD");
  if (file.mimetype !== "image/png" && file.mimetype !== "image/jpeg") throw new HttpError(400, "The logo must be a PNG or JPEG image.", "INVALID_UPLOAD");
  let png: Buffer;
  try {
    png = await sharp(file.buffer, { limitInputPixels: 64e6, failOn: "error" }).rotate().resize({ height: 240, withoutEnlargement: true }).png().toBuffer();
  } catch {
    throw new HttpError(400, "That image couldn't be read.", "INVALID_UPLOAD");
  }
  const company = await prisma.company.findFirst({ orderBy: { createdAt: "asc" } });
  if (!company) throw new HttpError(409, "No company record exists.", "CONFLICT");
  const key = `company/logo/${randomUUID()}.png`;
  await storageService.putObject(key, png, "image/png");
  await prisma.company.update({ where: { id: company.id }, data: { logoStorageKey: key } });
  await writeAuditLog({ ...meta, action: "letters.letterhead.logo_uploaded", entityType: "Company", entityId: company.id, before: { logoStorageKey: company.logoStorageKey }, after: { logoStorageKey: key } });
  return getLetterhead();
}

export async function removeLogo(meta: ActorMeta) {
  const company = await prisma.company.findFirst({ orderBy: { createdAt: "asc" } });
  if (!company) throw new HttpError(409, "No company record exists.", "CONFLICT");
  await prisma.company.update({ where: { id: company.id }, data: { logoStorageKey: null } });
  await writeAuditLog({ ...meta, action: "letters.letterhead.logo_removed", entityType: "Company", entityId: company.id, before: { logoStorageKey: company.logoStorageKey }, after: { logoStorageKey: null } });
  return getLetterhead();
}

async function snapshotLetterhead(): Promise<{ letterhead: Letterhead; signatoryName: string; signatoryDesignation: string }> {
  const lh = await getLetterhead();
  const missing = [
    !lh.legalName.trim() && "company legal name",
    !lh.registeredAddress.trim() && "registered address",
    !lh.signatoryName.trim() && "signatory name",
    !lh.signatoryDesignation.trim() && "signatory designation",
  ].filter(Boolean);
  if (missing.length > 0) throw new HttpError(409, `Set the letterhead first (System Settings → Letters): ${missing.join(", ")}.`, "LETTERHEAD_INCOMPLETE");
  const company = await prisma.company.findFirst({ orderBy: { createdAt: "asc" } });
  let logo: Letterhead["logo"] = null;
  if (company?.logoStorageKey) {
    const obj = await storageService.getObject(company.logoStorageKey);
    logo = { storageKey: company.logoStorageKey, sha256: createHash("sha256").update(obj.body).digest("hex"), mimeType: "image/png" };
  }
  return { letterhead: { legalName: lh.legalName, address: lh.registeredAddress, logo }, signatoryName: lh.signatoryName, signatoryDesignation: lh.signatoryDesignation };
}

// ── Merge values ───────────────────────────────────────────────────────

// Everything about the employee as it stood ON the letter's date — the name
// in force that day, the job row in force that day (spec §11: a letter keeps
// the name as of its own date after a later change).
async function employeeValues(employeeId: string, asOf: Date, needed: Set<string>): Promise<Record<string, string>> {
  const day = istDateOnly(asOf);
  const inForce = inForceOn(day);
  const employee = await prisma.employee.findUniqueOrThrow({
    where: { id: employeeId },
    include: {
      personal: true,
      nameHistory: { where: inForce, orderBy: { effectiveFrom: "desc" }, take: 1 },
      jobHistory: { where: inForce, orderBy: { effectiveFrom: "desc" }, take: 1, include: { department: true, designation: true, location: true } },
      separations: { where: { status: { not: "CANCELLED" } }, orderBy: { lastWorkingDate: "desc" }, take: 1 },
    },
  });
  const job = employee.jobHistory[0];
  const separation = employee.separations[0];
  if (needed.has("employee.lastWorkingDate") && !separation) {
    throw new HttpError(409, "This letter needs a last working day, but the employee has no separation recorded. Record the separation first.", "NO_SEPARATION");
  }
  return {
    "employee.fullName": employee.nameHistory[0]?.fullName ?? employee.employeeCode,
    "employee.code": employee.employeeCode,
    "employee.designation": job?.designation.name ?? "",
    "employee.department": job?.department.name ?? "",
    "employee.branch": job?.location.name ?? "",
    "employee.dateOfJoining": dateOnlyLong(employee.dateOfJoining),
    "employee.lastWorkingDate": separation ? dateOnlyLong(separation.lastWorkingDate) : "",
    "employee.currentAddress": employee.personal?.currentAddress ?? "",
  };
}

function placeholdersIn(bodyHtml: string): Set<string> {
  return new Set([...bodyHtml.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g)].map((m) => m[1]!));
}

async function resolveMergeValues(
  version: { bodyHtml: string; extraFields: Prisma.JsonValue },
  template: { name: string; code: string },
  employeeId: string,
  extraValues: Record<string, string>,
  generatedAt: Date,
  letterNumber: string,
): Promise<StoredMergeValues> {
  const fields = extraFieldsOf(version.extraFields);
  const extras: Record<string, string> = {};
  for (const f of fields) {
    const raw = extraValues[f.key] ?? "";
    if (f.required && raw.trim() === "") throw new HttpError(400, `"${f.label}" is required for this letter.`, "VALIDATION_ERROR");
    extras[`extra.${f.key}`] = formatExtra(f, raw);
  }
  const { letterhead, signatoryName, signatoryDesignation } = await snapshotLetterhead();
  const values: Record<string, string> = {
    ...(await employeeValues(employeeId, generatedAt, placeholdersIn(version.bodyHtml))),
    "company.legalName": letterhead.legalName,
    "company.address": letterhead.address,
    "letter.date": longDate(generatedAt),
    "letter.reference": letterNumber,
    "signatory.name": signatoryName,
    "signatory.designation": signatoryDesignation,
    ...extras,
  };
  // Defensive: every key the catalog defines is present, so a stored letter
  // is complete even if a later template version uses more of them.
  for (const key of Object.keys(LETTER_PLACEHOLDERS)) values[key] ??= "";
  return { values, letterhead, templateName: template.name, templateCode: template.code };
}

// ── Rendering ──────────────────────────────────────────────────────────

async function renderStored(bodyHtml: string, merge: StoredMergeValues, generatedAt: Date) {
  let logoBytes: Buffer | null = null;
  if (merge.letterhead.logo) {
    logoBytes = (await storageService.getObject(merge.letterhead.logo.storageKey)).body;
    const sha = createHash("sha256").update(logoBytes).digest("hex");
    if (sha !== merge.letterhead.logo.sha256) throw new Error(`Letterhead logo ${merge.letterhead.logo.storageKey} no longer matches the hash recorded with the letter.`);
  }
  const html = letterDocument(mergeIntoBody(bodyHtml, merge.values), merge.letterhead, logoBytes);
  return renderPdf(html, generatedAt);
}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

// Draft preview while editing: render against a chosen employee, store nothing.
export async function previewTemplate(
  input: { bodyHtml: string; extraFields: LetterExtraField[]; employeeId: string; extraValues: Record<string, string>; templateName: string },
  viewer: LetterViewer,
): Promise<Buffer> {
  await findScopedEmployee(input.employeeId, viewer.employeeId, viewer.dataScope);
  const bodyHtml = prepareBody(input.bodyHtml, input.extraFields);
  const now = new Date();
  const merge = await resolveMergeValues({ bodyHtml, extraFields: input.extraFields as unknown as Prisma.JsonValue }, { name: input.templateName, code: "PREVIEW" }, input.employeeId, input.extraValues, now, "PREVIEW");
  return (await renderStored(bodyHtml, merge, now)).pdf;
}

// ── Issuing ────────────────────────────────────────────────────────────

const letterInclude = {
  templateVersion: { include: { template: true } },
  employeeDocument: { select: { id: true, title: true, archivedAt: true } },
  reissueOf: { select: { id: true, number: true } },
  reissues: { select: { id: true, number: true } },
} as const;
type LetterRow = Prisma.GeneratedLetterGetPayload<{ include: typeof letterInclude }>;

// Every issued letter is filed under LETTERS, a PAY category (an offer
// letter carries the CTC HR typed in). Whoever can't read PAY documents —
// every manager, whatever they're granted, and HR Executives — sees that a
// letter exists (reference, template, date, status) but never its typed
// values or its PDF, and can't reissue or reproduce it (2026-10-03).
async function canReadLetterContents(viewer: { permissions: ReadonlySet<string> }): Promise<boolean> {
  const category = await prisma.documentCategory.findUnique({ where: { code: LETTERS_CATEGORY_CODE }, select: { sensitivity: true } });
  return canReadSensitivity(category?.sensitivity ?? "PAY", viewer.permissions);
}

async function requireLetterContents(viewer: { permissions: ReadonlySet<string> }) {
  if (!(await canReadLetterContents(viewer))) {
    throw new HttpError(403, "Issued letters can contain pay figures, so only people who can see pay documents can reissue or reproduce them.", "CONTENTS_WITHHELD");
  }
}

function withheld(l: ReturnType<typeof formatLetter>) {
  return { ...l, document: null, extraValues: null, pdfSha256: null, contentsWithheld: true as const };
}

async function present(rows: LetterRow[], viewer: { permissions: ReadonlySet<string> }) {
  const full = rows.map(formatLetter);
  return (await canReadLetterContents(viewer)) ? full : full.map(withheld);
}

function formatLetter(l: LetterRow) {
  return {
    contentsWithheld: false as boolean,
    id: l.id,
    reference: formatLetterNumber(l.number),
    employeeId: l.employeeId,
    template: { id: l.templateVersion.template.id, code: l.templateVersion.template.code, name: l.templateVersion.template.name },
    templateVersion: l.templateVersion.version,
    status: l.status,
    failureReason: l.failureReason,
    visibleToEmployee: l.visibleToEmployee,
    generatedAt: l.generatedAt.toISOString(),
    generatedByUserId: l.generatedByUserId,
    document: l.employeeDocument ? { id: l.employeeDocument.id, title: l.employeeDocument.title, archived: l.employeeDocument.archivedAt !== null } : null,
    pdfSha256: l.pdfSha256,
    rendererVersion: l.rendererVersion,
    reissueOf: l.reissueOf ? { id: l.reissueOf.id, reference: formatLetterNumber(l.reissueOf.number) } : null,
    reissuedAs: l.reissues.map((r) => ({ id: r.id, reference: formatLetterNumber(r.number) })),
    extraValues: Object.fromEntries(
      Object.entries((l.mergeValues as unknown as StoredMergeValues).values).filter(([k]) => k.startsWith("extra.")).map(([k, v]) => [k.slice(6), v]),
    ),
  };
}

export type EnqueueLetter = (letterId: string) => Promise<void>;

export async function issueLetter(
  input: { templateId: string; employeeId: string; extraValues: Record<string, string>; visibleToEmployee?: boolean; reissueOfId?: string | null },
  viewer: LetterViewer,
  meta: ActorMeta,
  enqueue: EnqueueLetter,
) {
  await findScopedEmployee(input.employeeId, viewer.employeeId, viewer.dataScope);
  const template = await prisma.letterTemplate.findUnique({ where: { id: input.templateId } });
  if (!template || !template.isActive) throw new HttpError(400, "Choose an active letter template.", "VALIDATION_ERROR");
  const version = await currentVersion(template.id);
  if (!version) throw new HttpError(409, "This template has no content yet.", "CONFLICT");
  // Without Issue letters (the directors') a letter may be issued only when the template PROVES it cannot carry a pay figure, and what was typed is not a pay figure either.
  if (!viewer.permissions.has("letters.generate")) {
    if (!viewer.permissions.has("letters.issue.nopay")) throw new HttpError(403, "Missing permission: letters.generate", "FORBIDDEN");
    const fields = extraFieldsOf(version.extraFields);
    const proof = payFreeProof(version.bodyHtml, fields);
    if (!proof.ok) throw new HttpError(403, `This letter could carry a pay figure, so a director has to issue it. ${proof.reasons.join(" ")}`, "PAY_LETTER_DIRECTOR_ONLY", { reasons: proof.reasons });
    for (const f of fields) {
      const problem = payFreeValueProblem(f.label, input.extraValues[f.key] ?? "");
      if (problem) throw new HttpError(403, problem, "PAY_LETTER_DIRECTOR_ONLY", { reasons: [problem] });
    }
    // Keys the template does not ask for are not stored, but they are not carried either.
  }

  // The reference number and the timestamp are fixed now and frozen with
  // the values; the letter's own date never depends on when the job runs.
  const generatedAt = new Date();
  // Values first (they can refuse, e.g. no last working day), then the
  // number, so a refused attempt never burns a reference.
  const merge = await resolveMergeValues(version, template, input.employeeId, input.extraValues, generatedAt, "");
  const letter = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ nextval: bigint }>>`SELECT nextval(pg_get_serial_sequence('generated_letters', 'number'))`;
    const number = Number(rows[0]!.nextval);
    merge.values["letter.reference"] = formatLetterNumber(number);
    return tx.generatedLetter.create({
      data: {
        number,
        employeeId: input.employeeId,
        templateVersionId: version.id,
        mergeValues: merge as unknown as Prisma.InputJsonValue,
        generatedAt,
        generatedByUserId: viewer.userId,
        visibleToEmployee: input.visibleToEmployee ?? template.visibleToEmployeeDefault,
        reissueOfId: input.reissueOfId ?? null,
      },
      include: letterInclude,
    });
  });
  await writeAuditLog({
    ...meta,
    action: input.reissueOfId ? "letters.reissued" : "letters.issued",
    entityType: "GeneratedLetter",
    entityId: letter.id,
    after: { reference: formatLetterNumber(letter.number), employeeId: letter.employeeId, template: template.code, version: version.version, reissueOfId: input.reissueOfId ?? null },
  });
  await enqueue(letter.id);
  return (await present([letter], viewer))[0]!;
}

export async function reissueLetter(
  letterId: string,
  input: { extraValues?: Record<string, string>; visibleToEmployee?: boolean },
  viewer: LetterViewer,
  meta: ActorMeta,
  enqueue: EnqueueLetter,
) {
  const original = await prisma.generatedLetter.findUnique({ where: { id: letterId }, include: letterInclude });
  if (!original) throw new HttpError(404, "Letter not found.", "NOT_FOUND");
  await findScopedEmployee(original.employeeId, viewer.employeeId, viewer.dataScope).catch(() => {
    throw new HttpError(404, "Letter not found.", "NOT_FOUND");
  });
  // A reissue copies the original's typed values, so it needs to read them.
  await requireLetterContents(viewer);
  const previous = formatLetter(original);
  // A reissue is a brand-new letter from the template's CURRENT version,
  // today's values and a new reference; the original stays untouched.
  return issueLetter(
    {
      templateId: original.templateVersion.templateId,
      employeeId: original.employeeId,
      extraValues: input.extraValues ?? previous.extraValues,
      visibleToEmployee: input.visibleToEmployee ?? original.visibleToEmployee,
      reissueOfId: original.id,
    },
    viewer,
    meta,
    enqueue,
  );
}

export async function listEmployeeLetters(employeeId: string, viewer: LetterViewer) {
  await findScopedEmployee(employeeId, viewer.employeeId, viewer.dataScope);
  const rows = await prisma.generatedLetter.findMany({ where: { employeeId }, include: letterInclude, orderBy: { number: "desc" } });
  return present(rows, viewer);
}

async function loadScopedLetter(letterId: string, viewer: LetterViewer) {
  const letter = await prisma.generatedLetter.findUnique({ where: { id: letterId }, include: letterInclude });
  if (!letter) throw new HttpError(404, "Letter not found.", "NOT_FOUND");
  try {
    await findScopedEmployee(letter.employeeId, viewer.employeeId, viewer.dataScope);
  } catch {
    throw new HttpError(404, "Letter not found.", "NOT_FOUND");
  }
  return letter;
}

export async function getLetter(letterId: string, viewer: LetterViewer) {
  return (await present([await loadScopedLetter(letterId, viewer)], viewer))[0]!;
}

// Re-renders an issued letter from exactly what was stored — template
// version, merge values, timestamp — and says whether the bytes match the
// PDF that was issued.
export async function reproduceLetter(letterId: string, viewer: LetterViewer, meta: ActorMeta) {
  const letter = await loadScopedLetter(letterId, viewer);
  await requireLetterContents(viewer);
  if (letter.status !== "GENERATED") throw new HttpError(409, "Only a generated letter can be reproduced.", "CONFLICT");
  const rendered = await renderStored(letter.templateVersion.bodyHtml, letter.mergeValues as unknown as StoredMergeValues, letter.generatedAt);
  const hash = sha256(rendered.pdf);
  const matches = hash === letter.pdfSha256;
  await writeAuditLog({
    ...meta,
    action: "letters.reproduced",
    entityType: "GeneratedLetter",
    entityId: letter.id,
    after: { matches, storedSha256: letter.pdfSha256, reproducedSha256: hash, storedRenderer: letter.rendererVersion, renderer: rendered.rendererVersion },
  });
  return { pdf: rendered.pdf, matches, fileName: `${formatLetterNumber(letter.number)}-reproduced.pdf`, storedRenderer: letter.rendererVersion, renderer: rendered.rendererVersion };
}

// ── The job: render, store, file it in the employee's documents ────────

export async function processLetterJob(letterId: string): Promise<{ status: "GENERATED" | "FAILED" | "SKIPPED" }> {
  const letter = await prisma.generatedLetter.findUnique({ where: { id: letterId }, include: { templateVersion: { include: { template: true } } } });
  if (!letter || letter.status !== "QUEUED") return { status: "SKIPPED" }; // already done (retry / duplicate job)
  const merge = letter.mergeValues as unknown as StoredMergeValues;
  const reference = formatLetterNumber(letter.number);
  let fileKey: string | null = null;
  try {
    const category = await prisma.documentCategory.findUnique({ where: { code: LETTERS_CATEGORY_CODE } });
    if (!category) throw new Error(`Document category ${LETTERS_CATEGORY_CODE} is missing.`);
    // Structural: a letter is never filed where a manager could read it.
    if (category.sensitivity !== "PAY") throw new Error(`Document category ${LETTERS_CATEGORY_CODE} must be PAY sensitivity, not ${category.sensitivity}.`);
    const rendered = await renderStored(letter.templateVersion.bodyHtml, merge, letter.generatedAt);
    fileKey = `letters/${letter.employeeId}/${letter.id}.pdf`;
    await storageService.putObject(fileKey, rendered.pdf, "application/pdf");
    const title = `${merge.templateName} (${reference})`;
    const docId = await prisma.$transaction(async (tx) => {
      const doc = await tx.employeeDocument.create({
        data: {
          employeeId: letter.employeeId,
          categoryId: category.id,
          title,
          fileKey: fileKey!,
          fileName: `${merge.templateCode}-${reference}.pdf`,
          mimeType: "application/pdf",
          sizeBytes: rendered.pdf.length,
          visibleToEmployee: letter.visibleToEmployee,
          uploadedByUserId: letter.generatedByUserId,
        },
      });
      // Only a still-QUEUED letter can be completed — a concurrent run of
      // the same job rolls back here instead of filing a second document.
      const done = await tx.generatedLetter.updateMany({
        where: { id: letter.id, status: "QUEUED" },
        data: { status: "GENERATED", employeeDocumentId: doc.id, pdfSha256: sha256(rendered.pdf), rendererVersion: rendered.rendererVersion },
      });
      if (done.count !== 1) throw new AlreadyProcessed();
      return doc.id;
    });
    if (letter.visibleToEmployee) {
      await notifyEmployee(letter.employeeId, {
        type: "document.added",
        title: "New letter",
        body: `HR issued your ${merge.templateName} (${reference}).`,
        link: "/app/document-center?tab=mine",
        payload: { documentId: docId, letterId: letter.id },
      });
    }
    await emitToIssuer(letter.generatedByUserId, letter.id, letter.employeeId);
    return { status: "GENERATED" };
  } catch (err) {
    if (fileKey) await storageService.deleteObject(fileKey).catch(() => undefined); // nothing references it
    if (err instanceof AlreadyProcessed) return { status: "SKIPPED" };
    const reason = err instanceof Error ? err.message.slice(0, 500) : "Unknown error";
    await prisma.generatedLetter.updateMany({ where: { id: letter.id, status: "QUEUED" }, data: { status: "FAILED", failureReason: reason } });
    await emitToIssuer(letter.generatedByUserId, letter.id, letter.employeeId);
    return { status: "FAILED" };
  }
}

class AlreadyProcessed extends Error {}

async function emitToIssuer(userId: string, letterId: string, employeeId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { employeeId: true } });
  emitLetterUpdated(user?.employeeId ?? null, { letterId, employeeId });
}
