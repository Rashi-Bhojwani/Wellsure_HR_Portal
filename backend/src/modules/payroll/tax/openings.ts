import { createHash } from "node:crypto";
import { z } from "zod";
import { parseFinancialYearLabel } from "@shared/utils/financialYear";
import { writeAuditLog } from "../../../lib/audit";
import { requireDirector } from "../../../lib/directorAuthority";
import { namesOn } from "../../../lib/effectiveDating";
import { businessToday } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { decide, liveApproval, noteFiguresChanged, registerSubject, submit } from "../approvals";
import { payrollHash } from "../hash";
import { canonicalDecimal, dec, ZERO, type Money } from "../money";
import { readTable, normaliseHeader } from "../inputs/importParse";
import { parseAmountText } from "../inputs/rules";

// A-3 (docs/plans/A3_OPENING_FIGURES.md): opening figures. Directors only, append-only, confirmed as a whole per financial year by a different director
// (TAX_OPENING). The year-to-date reader adds confirmed figures only; with income tax on (PROJECTED) a run refuses until the year's figures are confirmed.

export const OPENING_KINDS = ["GO_LIVE", "PREVIOUS_EMPLOYER"] as const;
export type OpeningKind = (typeof OPENING_KINDS)[number];
export const OPENING_KIND_LABEL: Record<OpeningKind, string> = { GO_LIVE: "Before this system (this employer)", PREVIOUS_EMPLOYER: "Previous employer this year" };
export const MAX_OPENING_ROWS = 2000;

export interface Actor {
  userId: string;
  ip?: string | null;
}

const yearSchema = z.string().regex(/^\d{4}-\d{2}$/, "A financial year such as 2026-27").refine((s) => {
  try {
    parseFinancialYearLabel(s);
    return true;
  } catch {
    return false;
  }
}, "Not a financial year");

export interface OpeningFigure {
  employeeId: string;
  kind: OpeningKind;
  taxable: string;
  tds: string;
  sourceNote: string;
  enteredByUserId: string;
  enteredAt: string;
}

/** The figures in force for a year: the latest row per person and kind, cleared rows left out. */
export async function currentOpenings(year: string): Promise<OpeningFigure[]> {
  const rows = await prisma.taxOpening.findMany({ where: { financialYear: year }, orderBy: { seq: "asc" } });
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) latest.set(`${r.employeeId}|${r.kind}`, r);
  return [...latest.values()]
    .filter((r) => !r.cleared)
    .map((r) => ({ employeeId: r.employeeId, kind: r.kind, taxable: canonicalDecimal(dec(r.taxable!.toString())), tds: canonicalDecimal(dec(r.tds!.toString())), sourceNote: r.sourceNote, enteredByUserId: r.enteredByUserId, enteredAt: r.createdAt.toISOString() }))
    .sort((a, b) => (a.employeeId === b.employeeId ? a.kind.localeCompare(b.kind) : a.employeeId.localeCompare(b.employeeId)));
}

export async function hashOfYear(year: string): Promise<string> {
  const figures = await currentOpenings(year);
  return payrollHash({ year, figures: figures.map((f) => [f.employeeId, f.kind, f.taxable, f.tds]) });
}
const fingerprintOf = (year: string, hash: string) => createHash("sha256").update(`${year}|${hash}`).digest("hex");

/** Whether the year's opening figures are confirmed by a different director and unchanged since. */
export async function openingsConfirmed(year: string): Promise<boolean> {
  const approval = await liveApproval("TAX_OPENING", year);
  if (!approval || approval.status !== "APPROVED") return false;
  return approval.contentHash === (await hashOfYear(year));
}

/** The confirmed opening amounts for one person and year (zero when none or not confirmed): what the year-to-date reader adds. */
export async function confirmedOpeningFor(employeeId: string, year: string): Promise<{ taxable: Money; tds: Money; confirmed: boolean }> {
  if (!(await openingsConfirmed(year))) return { taxable: ZERO, tds: ZERO, confirmed: false };
  const mine = (await currentOpenings(year)).filter((f) => f.employeeId === employeeId);
  return { taxable: mine.reduce((s, f) => s.plus(dec(f.taxable)), ZERO), tds: mine.reduce((s, f) => s.plus(dec(f.tds)), ZERO), confirmed: true };
}

// ── The directors' view ─────────────────────────────────────────────────────────────────────────────────────────────────────

export async function yearView(year: string, actorUserId: string) {
  await requireDirector(actorUserId, "see opening figures");
  const parsed = yearSchema.safeParse(year);
  if (!parsed.success) throw new HttpError(400, "Choose a financial year such as 2026-27.", "VALIDATION_ERROR");
  const [figures, approval, hash] = await Promise.all([currentOpenings(year), liveApproval("TAX_OPENING", year), hashOfYear(year)]);
  const ids = [...new Set(figures.map((f) => f.employeeId))];
  const [emps, names] = await Promise.all([prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, employeeCode: true } }), namesOn(ids, businessToday())]);
  const code = new Map(emps.map((e) => [e.id, e.employeeCode]));
  const state = !approval ? "NOT_CONFIRMED" : approval.status === "PENDING" ? "WAITING" : approval.status === "APPROVED" && approval.contentHash === hash ? "CONFIRMED" : "NOT_CONFIRMED";
  return {
    year,
    state,
    waiting: approval?.status === "PENDING" ? { makerUserId: approval.makerUserId, mine: approval.makerUserId === actorUserId } : null,
    fingerprint: fingerprintOf(year, hash),
    totals: { people: ids.length, taxable: canonicalDecimal(figures.reduce((s, f) => s.plus(dec(f.taxable)), ZERO)), tds: canonicalDecimal(figures.reduce((s, f) => s.plus(dec(f.tds)), ZERO)) },
    rows: figures.map((f) => ({ ...f, employeeCode: code.get(f.employeeId) ?? "", name: names.get(f.employeeId) ?? code.get(f.employeeId) ?? "", kindLabel: OPENING_KIND_LABEL[f.kind] })),
  };
}

export const enterSchema = z
  .object({
    year: yearSchema,
    employeeId: z.string().min(1).max(64),
    kind: z.enum(OPENING_KINDS),
    clear: z.boolean().default(false),
    taxable: z.string().trim().max(20).optional(),
    tds: z.string().trim().max(20).optional(),
    sourceNote: z.string().trim().min(3, "Say where the figure comes from").max(300),
  })
  .strict();

interface PlannedOpening {
  employeeId: string;
  kind: OpeningKind;
  cleared: boolean;
  taxable: string | null;
  tds: string | null;
  sourceNote: string;
}

async function write(year: string, rows: PlannedOpening[], actor: Actor, batchId: string | null, what: string) {
  if (rows.length === 0) return { written: 0, voidedConfirmation: false };
  await prisma.taxOpening.createMany({ data: rows.map((r) => ({ employeeId: r.employeeId, financialYear: year, kind: r.kind, cleared: r.cleared, taxable: r.taxable, tds: r.tds, sourceNote: r.sourceNote, batchId, enteredByUserId: actor.userId })) });
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.tax_opening.entered", entityType: "TaxOpening", entityId: year, after: { year, rows: rows.length, batchId } }); // never a figure in the audit row
  const { voided } = await noteFiguresChanged("TAX_OPENING", year, actor.userId, what);
  return { written: rows.length, voidedConfirmation: voided };
}

export async function enter(raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "enter opening figures");
  const parsed = enterSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const input = parsed.data;
  const employee = await prisma.employee.findUnique({ where: { id: input.employeeId }, select: { id: true } });
  if (!employee) throw new HttpError(404, "Employee not found.", "NOT_FOUND");
  if (await isPending(input.year)) throw new HttpError(409, "These figures are waiting for the other director's decision. Ask them to decide (or reject) first.", "WAITING_FOR_DECISION");
  if (input.clear) return write(input.year, [{ employeeId: input.employeeId, kind: input.kind, cleared: true, taxable: null, tds: null, sourceNote: input.sourceNote }], actor, null, "An opening figure was cleared");
  const t = parseAmountText(input.taxable ?? "");
  const d = parseAmountText(input.tds ?? "");
  if (!t.ok) throw new HttpError(400, `Taxable pay: ${t.message}`, "VALIDATION_ERROR");
  if (!d.ok) throw new HttpError(400, `Tax deducted: ${d.message}`, "VALIDATION_ERROR");
  return write(input.year, [{ employeeId: input.employeeId, kind: input.kind, cleared: false, taxable: t.value, tds: d.value, sourceNote: input.sourceNote }], actor, null, "An opening figure was entered");
}

async function isPending(year: string) {
  return (await liveApproval("TAX_OPENING", year))?.status === "PENDING";
}

// ── Import (our own layout; the greytHR layout waits for its sample) ─────────────────────────────────────────────────────

export const IMPORT_COLUMNS = ["Employee number", "Kind", "Taxable pay", "Tax deducted", "Source note"] as const;
const KIND_WORDS: Record<string, OpeningKind> = { go_live: "GO_LIVE", golive: "GO_LIVE", previous_employer: "PREVIOUS_EMPLOYER", previousemployer: "PREVIOUS_EMPLOYER" };

export interface ImportPreview {
  year: string;
  fileName: string;
  fingerprint: string;
  valid: number;
  rows: Array<{ line: number; employeeCode: string; kind: string; taxable: string; tds: string; note: string; problem: string | null }>;
}

async function analyseImport(year: string, file: { buffer: Buffer; originalname: string }, actor: Actor): Promise<ImportPreview & { planned: PlannedOpening[] }> {
  await requireDirector(actor.userId, "import opening figures");
  if (!yearSchema.safeParse(year).success) throw new HttpError(400, "Choose a financial year such as 2026-27.", "VALIDATION_ERROR");
  const table = await readTable(file.buffer, file.originalname);
  const idx = (name: string) => table.headers.findIndex((h) => normaliseHeader(h) === normaliseHeader(name));
  const cols = IMPORT_COLUMNS.map(idx);
  const missingCols = IMPORT_COLUMNS.filter((_, i) => cols[i] === -1);
  if (missingCols.length) throw new HttpError(400, `The file has no column called ${missingCols.map((c) => `"${c}"`).join(", ")}. Download the template.`, "INVALID_FILE");
  if (table.rows.length > MAX_OPENING_ROWS) throw new HttpError(400, `At most ${MAX_OPENING_ROWS} rows in one file.`, "INVALID_FILE");
  const codes = [...new Set(table.rows.map((r) => r.cells[cols[0]!] ?? ""))];
  const emps = new Map((await prisma.employee.findMany({ where: { employeeCode: { in: codes } }, select: { id: true, employeeCode: true } })).map((e) => [e.employeeCode, e.id]));
  const seen = new Set<string>();
  const planned: PlannedOpening[] = [];
  const rows = table.rows.map((r) => {
    const [code, kindText, taxable, tds, note] = cols.map((c) => (r.cells[c!] ?? "").trim()) as [string, string, string, string, string];
    let problem: string | null = null;
    const employeeId = emps.get(code);
    const kind = KIND_WORDS[kindText.toLowerCase().replace(/[\s-]+/g, "_")] ?? KIND_WORDS[kindText.toLowerCase().replace(/[\s_-]+/g, "")];
    const t = parseAmountText(taxable);
    const d = parseAmountText(tds);
    if (!employeeId) problem = `No employee with number "${code}".`;
    else if (!kind) problem = `Kind must be GO_LIVE or PREVIOUS_EMPLOYER, not "${kindText}".`;
    else if (!t.ok) problem = `Taxable pay: ${t.message}`;
    else if (!d.ok) problem = `Tax deducted: ${d.message}`;
    else if (note.length < 3) problem = "Say where the figure comes from (Source note).";
    else if (seen.has(`${employeeId}|${kind}`)) problem = "The same person and kind appear twice in this file.";
    if (!problem && employeeId && kind && t.ok && d.ok) {
      seen.add(`${employeeId}|${kind}`);
      planned.push({ employeeId, kind, cleared: false, taxable: t.value, tds: d.value, sourceNote: note });
    }
    return { line: r.line, employeeCode: code, kind: kindText, taxable, tds, note, problem };
  });
  const fingerprint = createHash("sha256").update(JSON.stringify({ year, planned, user: actor.userId })).digest("hex");
  return { year, fileName: file.originalname, fingerprint, valid: planned.length, rows, planned };
}

/** The preview: every row with its problem, and a fingerprint of the rows that would be written. */
export async function previewImport(year: string, file: { buffer: Buffer; originalname: string }, actor: Actor): Promise<ImportPreview> {
  await requireDirector(actor.userId, "import opening figures");
  const { planned: _planned, ...view } = await analyseImport(year, file, actor);
  return view;
}

export const applyImportSchema = z.object({ year: yearSchema, fingerprint: z.string().length(64), reason: z.string().trim().min(3, "Say why").max(200) }).strict();

/** Applying sends the same file again with the preview's fingerprint: what is written is exactly what was previewed, or nothing (no state between calls). */
export async function applyImport(raw: unknown, file: { buffer: Buffer; originalname: string }, actor: Actor) {
  await requireDirector(actor.userId, "import opening figures");
  const parsed = applyImportSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const a = await analyseImport(parsed.data.year, file, actor);
  if (a.fingerprint !== parsed.data.fingerprint) throw new HttpError(409, "The file is not the one you previewed. Preview it again.", "PREVIEW_STALE");
  if (a.planned.length === 0) throw new HttpError(400, "No row in the file can be written.", "NOTHING_TO_WRITE");
  if (await isPending(a.year)) throw new HttpError(409, "These figures are waiting for the other director's decision. Ask them to decide (or reject) first.", "WAITING_FOR_DECISION");
  return write(a.year, a.planned, actor, a.fingerprint.slice(0, 24), `Opening figures were imported (${parsed.data.reason})`);
}

/** The template: the columns, one made-up example row marked as such. */
export function importTemplateCsv(): string {
  return `${IMPORT_COLUMNS.join(",")}\nEXAMPLE-ONLY,GO_LIVE,0,0,delete this example row\n`;
}

// ── Confirmation by a different director (always: every tax value is confirmed by a different director) ─────────────────────

export const requestSchema = z.object({ year: yearSchema, fingerprint: z.string().length(64), note: z.string().trim().max(300).optional() }).strict();
export const decisionSchema = z.object({ fingerprint: z.string().length(64), decision: z.enum(["APPROVE", "REJECT"]), note: z.string().trim().max(300).optional() }).strict();

export async function requestConfirmation(raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "ask for opening figures to be confirmed");
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const { year, fingerprint, note } = parsed.data;
  if (fingerprintOf(year, await hashOfYear(year)) !== fingerprint) throw new HttpError(409, "The figures changed since you looked at them. Look at them again.", "PREVIEW_STALE");
  const people = new Set((await currentOpenings(year)).map((f) => f.employeeId)).size;
  return submit({ subject: "TAX_OPENING", subjectId: year, makerUserId: actor.userId, previewFingerprint: fingerprint, ...(note ? { note } : {}), ip: actor.ip ?? null, notify: { step: "RULE_CONFIRM", subjectLabel: `the opening figures for ${year}`, itemCount: people } });
}

export async function decideConfirmation(year: string, raw: unknown, checker: Actor) {
  await requireDirector(checker.userId, "confirm opening figures");
  const parsed = decisionSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const approval = await liveApproval("TAX_OPENING", year);
  if (!approval || approval.status !== "PENDING") throw new HttpError(409, "Nothing is waiting for a decision for this year.", "NOT_PENDING");
  const hash = await hashOfYear(year);
  if (fingerprintOf(year, hash) !== parsed.data.fingerprint) throw new HttpError(409, "What you were looking at is not what is there now. Look at it again.", "PREVIEW_STALE");
  return decide({ approvalId: approval.id, checkerUserId: checker.userId, decision: parsed.data.decision, ...(parsed.data.note ? { note: parsed.data.note } : {}), ip: checker.ip ?? null, expectedHash: hash });
}

registerSubject({
  subject: "TAX_OPENING",
  makerPermission: "payroll.salary.edit",
  checkerPermission: "payroll.approve",
  async describe(year) {
    return `the opening figures for ${year}`;
  },
  hash: (year) => hashOfYear(year),
});
