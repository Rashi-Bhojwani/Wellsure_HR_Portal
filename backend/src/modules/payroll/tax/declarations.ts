import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { financialYearOf, monthsLeftInYear, parseFinancialYearLabel } from "@shared/utils/financialYear";
import { storageService } from "../../../integrations/storage";
import { writeAuditLog } from "../../../lib/audit";
import { businessToday } from "../../../lib/businessDate";
import { requireDirector } from "../../../lib/directorAuthority";
import { salariesOn } from "../../../lib/effectiveDating";
import { getPeopleDocumentsSettings } from "../../../lib/peopleDocumentsSettings";
import { prisma } from "../../../lib/prisma";
import { prepareDocumentUpload } from "../../../lib/uploads";
import { HttpError } from "../../../middleware/errorHandler";
import { canonicalDecimal, dec, sum, ZERO } from "../money";
import { keysIn, loadItems, summarise } from "../items";
import { namesOn } from "../../../lib/effectiveDating";
import type { ComponentValue } from "../salary/schemas";
import { computeAnnualTax, TaxValueNotSetError, type EngineResult, type Regime } from "./engine";
import { yearToDate } from "./projection";
import { projectTaxablePay, splitTaxable, type HeadLookup } from "./taxable";
import { missingForTds, type SectionDef, type TaxYearValue } from "./schema";
import { taxYearForEngine } from "./years";

// Declarations, proof of investment and the side-by-side of the two regimes (docs/plans/STAGE_7_PLAN.md, P7-2). An employee reads and writes only their own. Directors read all and are
// the only verifiers. HR, managers and the Developer role have no route here. Everything is append-only: a save is the next version, a decision is a new row.

type Actor = { userId: string; ip?: string | null };
type Self = { userId: string; employeeId: string; ip?: string | null };
const iso = (d: Date) => d.toISOString().slice(0, 10);
const NOTE_MIN = 3;

const fyOf = (raw: string): string => {
  try {
    return parseFinancialYearLabel(raw).label;
  } catch (err) {
    throw new HttpError(400, (err as Error).message, "VALIDATION_ERROR");
  }
};

// ── Windows ──

export type WindowState = "NOT_SET" | "NOT_OPEN_YET" | "OPEN" | "CLOSED";
export interface WindowView {
  kind: "DECLARATION" | "PROOF";
  state: WindowState;
  opensOn: string | null;
  closesOn: string | null;
}

export const windowSchema = z.object({ fy: z.string().min(7).max(7), kind: z.enum(["DECLARATION", "PROOF"]), opensOn: z.iso.date(), closesOn: z.iso.date() }).strict();

async function windowOf(fy: string, kind: "DECLARATION" | "PROOF", today = iso(businessToday())): Promise<WindowView> {
  const row = await prisma.taxWindow.findFirst({ where: { fy, kind }, orderBy: { createdAt: "desc" } });
  if (!row) return { kind, state: "NOT_SET", opensOn: null, closesOn: null };
  const [opensOn, closesOn] = [iso(row.opensOn), iso(row.closesOn)];
  return { kind, state: today < opensOn ? "NOT_OPEN_YET" : today > closesOn ? "CLOSED" : "OPEN", opensOn, closesOn };
}

export async function setWindow(raw: unknown, actor: Actor): Promise<WindowView> {
  const parsed = windowSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  await requireDirector(actor.userId, "set a declaration window");
  const fy = fyOf(parsed.data.fy);
  if (parsed.data.closesOn < parsed.data.opensOn) throw new HttpError(400, "The window cannot close before it opens.", "VALIDATION_ERROR");
  await prisma.taxWindow.create({ data: { fy, kind: parsed.data.kind, opensOn: new Date(`${parsed.data.opensOn}T00:00:00Z`), closesOn: new Date(`${parsed.data.closesOn}T00:00:00Z`), setByUserId: actor.userId } });
  await writeAuditLog({ actorUserId: actor.userId, action: "tax.window.set", entityType: "TaxWindow", entityId: `${fy}:${parsed.data.kind}`, after: { opensOn: parsed.data.opensOn, closesOn: parsed.data.closesOn }, ipAddress: actor.ip ?? null });
  return windowOf(fy, parsed.data.kind);
}

export async function windowsFor(fyRaw: string, actor: Actor): Promise<{ year: string; declaration: WindowView; proof: WindowView }> {
  await requireDirector(actor.userId, "see the declaration windows");
  const year = fyOf(fyRaw);
  return { year, declaration: await windowOf(year, "DECLARATION"), proof: await windowOf(year, "PROOF") };
}

// ── What the year allows ──

async function currentYear(fy: string) {
  const y = await taxYearForEngine(fy);
  return y ? { ...y, sections: y.value.sections?.value ?? [] } : null;
}

const sectionMap = (sections: readonly SectionDef[]) => new Map(sections.map((s) => [s.code, s]));

async function headsNow(): Promise<HeadLookup> {
  const data = await loadItems("COMPONENT");
  const current = new Map(keysIn(data).map((k) => [k, summarise(data, k).current?.value as ComponentValue | undefined]));
  return (code) => current.get(code);
}

// ── Declarations (the employee's own) ──

export const saveDeclarationSchema = z
  .object({
    fy: z.string().min(7).max(7),
    regime: z.enum(["NEW", "OLD"]),
    lines: z.array(z.object({ section: z.string().min(2).max(20), amount: z.string().regex(/^\d{1,12}(\.\d{1,6})?$/, "Write an amount in digits, with no commas or sign") }).strict()).max(60),
  })
  .strict();

async function latestDeclaration(employeeId: string, fy: string) {
  return prisma.taxDeclaration.findFirst({ where: { employeeId, fy }, orderBy: { version: "desc" }, include: { lines: true } });
}

export async function saveMyDeclaration(raw: unknown, who: Self) {
  const parsed = saveDeclarationSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const fy = fyOf(parsed.data.fy);
  const win = await windowOf(fy, "DECLARATION");
  if (win.state !== "OPEN") throw new HttpError(409, win.state === "NOT_SET" ? "The declaration window for this year has not been opened by the directors." : win.state === "NOT_OPEN_YET" ? `The declaration window opens on ${win.opensOn}.` : `The declaration window closed on ${win.closesOn}.`, "WINDOW_CLOSED");
  const year = await currentYear(fy);
  if (!year || year.sections.length === 0) throw new HttpError(409, "The sections you can declare under have not been entered for this year yet.", "TAX_NOT_SET");
  const sections = sectionMap(year.sections);
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const l of parsed.data.lines) {
    if (!sections.has(l.section)) problems.push(`${l.section} is not a section you can declare under.`);
    if (seen.has(l.section)) problems.push(`${l.section} is listed twice.`);
    seen.add(l.section);
  }
  if (problems.length > 0) throw new HttpError(400, `Nothing was saved. ${problems.join(" ")}`, "VALIDATION_ERROR", { problems });
  const last = await latestDeclaration(who.employeeId, fy);
  const row = await prisma.taxDeclaration.create({ data: { employeeId: who.employeeId, fy, version: (last?.version ?? 0) + 1, regime: parsed.data.regime, lines: { create: parsed.data.lines.map((l) => ({ section: l.section, amount: canonicalDecimal(dec(l.amount)) })) } } });
  await writeAuditLog({ actorUserId: who.userId, action: "tax.declaration.saved", entityType: "TaxDeclaration", entityId: row.id, after: { fy, version: row.version, regime: row.regime, lines: parsed.data.lines.length }, ipAddress: who.ip ?? null });
  return myDeclaration(who.employeeId, fy);
}

// ── Proofs ──

type ProofView = { id: string; section: string; fileName: string; uploadedAt: string; decision: null | { decision: "ACCEPTED" | "REJECTED"; amountVerified: string | null; reason: string; at: string } };

async function proofsOf(employeeId: string, fy: string): Promise<ProofView[]> {
  const rows = await prisma.taxProof.findMany({ where: { employeeId, fy }, orderBy: { createdAt: "asc" }, include: { decisions: { orderBy: { createdAt: "desc" }, take: 1 } } });
  return rows.map((p) => {
    const d = p.decisions[0];
    return { id: p.id, section: p.section, fileName: p.fileName, uploadedAt: p.createdAt.toISOString(), decision: d ? { decision: d.decision, amountVerified: d.amountVerified === null ? null : canonicalDecimal(dec(d.amountVerified.toString())), reason: d.reason, at: d.createdAt.toISOString() } : null };
  });
}

export async function uploadMyProof(fyRaw: string, section: string, file: Express.Multer.File | undefined, who: Self) {
  const fy = fyOf(fyRaw);
  const win = await windowOf(fy, "PROOF");
  if (win.state !== "OPEN") throw new HttpError(409, win.state === "NOT_SET" ? "The proof window for this year has not been opened by the directors." : win.state === "NOT_OPEN_YET" ? `The proof window opens on ${win.opensOn}.` : `The proof window closed on ${win.closesOn}.`, "WINDOW_CLOSED");
  if (!file) throw new HttpError(400, "Choose a file to upload.", "INVALID_UPLOAD");
  const decl = await latestDeclaration(who.employeeId, fy);
  const line = decl?.lines.find((l) => l.section === section);
  if (!line || dec(line.amount.toString()).isZero()) throw new HttpError(409, "Declare an amount under this section first; a proof belongs to a declared line.", "NOT_DECLARED");
  const prepared = await prepareDocumentUpload(file, await getPeopleDocumentsSettings());
  const fileKey = `tax/${fy}/${who.employeeId}/${randomUUID()}${path.extname(prepared.fileName).toLowerCase()}`;
  await storageService.putObject(fileKey, prepared.buffer, prepared.mimeType);
  const { createHash } = await import("node:crypto");
  const row = await prisma.taxProof.create({ data: { employeeId: who.employeeId, fy, section, fileKey, fileName: prepared.fileName.slice(0, 120), fileSha256: createHash("sha256").update(prepared.buffer).digest("hex") } });
  await writeAuditLog({ actorUserId: who.userId, action: "tax.proof.uploaded", entityType: "TaxProof", entityId: row.id, after: { fy, section }, ipAddress: who.ip ?? null });
  return { id: row.id };
}

// ── What counts: declared until the proof window closes, then verified only ──

export interface CountedAmounts {
  deductions: Array<{ section: string; amount: string }>;
  basis: "DECLARED" | "VERIFIED";
  regime: Regime | null;
  declarationVersion: number | null;
}

export async function countedDeductions(employeeId: string, fy: string, sections: readonly SectionDef[], today = iso(businessToday())): Promise<CountedAmounts> {
  const decl = await latestDeclaration(employeeId, fy);
  if (!decl) return { deductions: [], basis: "DECLARED", regime: null, declarationVersion: null };
  const proofWindow = await windowOf(fy, "PROOF", today);
  const afterCutoff = proofWindow.state === "CLOSED";
  const defs = sectionMap(sections);
  if (!afterCutoff) return { deductions: decl.lines.map((l) => ({ section: l.section, amount: canonicalDecimal(dec(l.amount.toString())) })), basis: "DECLARED", regime: decl.regime, declarationVersion: decl.version };
  const proofs = await proofsOf(employeeId, fy);
  const out: Array<{ section: string; amount: string }> = [];
  for (const l of decl.lines) {
    const declared = dec(l.amount.toString());
    if (!(defs.get(l.section)?.proofRequired ?? true)) {
      out.push({ section: l.section, amount: canonicalDecimal(declared) });
      continue;
    }
    const verified = sum(proofs.filter((p) => p.section === l.section && p.decision?.decision === "ACCEPTED").map((p) => dec(p.decision!.amountVerified ?? "0")));
    out.push({ section: l.section, amount: canonicalDecimal(verified.greaterThan(declared) ? declared : verified) });
  }
  return { deductions: out, basis: "VERIFIED", regime: decl.regime, declarationVersion: decl.version };
}

// ── The screen of one person: their declaration, proofs, windows and the two regimes side by side ──

export interface RegimeComparison {
  available: boolean;
  /** Said in words when it is not available. */
  missing: string[];
  /** The tax year is entered but a different director has not confirmed it: anything shown is a draft. */
  draft: boolean;
  basis: "DECLARED" | "VERIFIED";
  taxablePay: string | null;
  results: Partial<Record<Regime, EngineResult>>;
  /** Only the person chooses. This is never set by the system. */
  chosen: Regime | null;
  defaultRegime: Regime | null;
}

export async function compareRegimes(employeeId: string, fy: string): Promise<RegimeComparison> {
  const year = await taxYearForEngine(fy);
  const base: RegimeComparison = { available: false, missing: [], draft: year ? !year.confirmed : true, basis: "DECLARED", taxablePay: null, results: {}, chosen: null, defaultRegime: year?.value.defaultRegime?.value ?? null };
  const lacking = missingForTds(year?.value ?? null);
  if (lacking.length > 0) return { ...base, missing: lacking };
  const value = year!.value as TaxYearValue;
  const today = iso(businessToday());
  const counted = await countedDeductions(employeeId, fy, value.sections!.value, today);
  const head = await headsNow();
  const salary = (await salariesOn([employeeId], businessToday())).get(employeeId);
  const recurringLines = (salary?.lines ?? []).map((l) => ({ code: l.componentCode, kind: "EARNING" as const, source: "COMPONENT", amount: dec(l.amount.toString()) }));
  const split = splitTaxable(recurringLines, head);
  if (split.notSet.length > 0) return { ...base, missing: [`whether ${split.notSet.join(", ")} is taxable`] };
  const ytd = await yearToDate(employeeId, fy, iso(new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 1))), head);
  const taxablePay = projectTaxablePay({ paidSoFar: ytd.taxable, recurring: split.recurring, oneOff: ZERO, monthsLeft: monthsLeftInYear(today) });
  const results: Partial<Record<Regime, EngineResult>> = {};
  for (const regime of ["NEW", "OLD"] as const) results[regime] = computeAnnualTax({ year: value, regime, taxablePay: canonicalDecimal(taxablePay), deductions: counted.deductions });
  return { ...base, available: true, draft: !year!.confirmed, basis: counted.basis, taxablePay: canonicalDecimal(taxablePay), results, chosen: counted.regime };
}

export async function myDeclaration(employeeId: string, fyRaw?: string) {
  const fy = fyRaw ? fyOf(fyRaw) : financialYearOf(iso(businessToday())).label;
  const [declaration, proof, decl, proofs, year, comparison] = [await windowOf(fy, "DECLARATION"), await windowOf(fy, "PROOF"), await latestDeclaration(employeeId, fy), await proofsOf(employeeId, fy), await currentYear(fy), await compareRegimes(employeeId, fy)];
  const sections = year?.confirmed ? year.sections : [];
  return {
    year: fy,
    windows: { declaration, proof },
    sections: sections.map((s) => ({ code: s.code, label: s.label, appliesTo: s.appliesTo, cap: s.cap, proofRequired: s.proofRequired })),
    sectionsConfirmed: year?.confirmed ?? false,
    declaration: decl ? { version: decl.version, regime: decl.regime, submittedAt: decl.submittedAt.toISOString(), lines: decl.lines.map((l) => ({ section: l.section, amount: canonicalDecimal(dec(l.amount.toString())) })) } : null,
    proofs,
    comparison,
  };
}

export async function myProofFile(proofId: string, who: Self) {
  const p = await prisma.taxProof.findUnique({ where: { id: proofId } });
  if (!p || p.employeeId !== who.employeeId) throw new HttpError(404, "There is no such proof.", "NOT_FOUND");
  await writeAuditLog({ actorUserId: who.userId, action: "tax.proof.downloaded", entityType: "TaxProof", entityId: p.id, after: { own: true }, ipAddress: who.ip ?? null });
  return { url: await storageService.getObjectSignedUrl(p.fileKey, 120, { downloadFileName: p.fileName }), fileName: p.fileName };
}

// ── Directors ──

export const decisionSchema = z
  .object({ decision: z.enum(["ACCEPTED", "REJECTED"]), amountVerified: z.string().regex(/^\d{1,12}(\.\d{1,6})?$/).optional(), reason: z.string().trim().max(300).default("") })
  .strict();

export async function decideProof(proofId: string, raw: unknown, actor: Actor) {
  const parsed = decisionSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  await requireDirector(actor.userId, "verify a proof");
  const proof = await prisma.taxProof.findUnique({ where: { id: proofId } });
  if (!proof) throw new HttpError(404, "There is no such proof.", "NOT_FOUND");
  const me = await prisma.user.findUnique({ where: { id: actor.userId }, select: { employeeId: true } });
  if (me?.employeeId === proof.employeeId) throw new HttpError(403, "Nobody verifies their own proof. The other director does.", "NOT_YOUR_OWN");
  const d = parsed.data;
  if (d.decision === "REJECTED" && d.reason.length < NOTE_MIN) throw new HttpError(400, "Say why the proof is rejected.", "VALIDATION_ERROR");
  let amount: string | null = null;
  if (d.decision === "ACCEPTED") {
    if (d.amountVerified === undefined) throw new HttpError(400, "Enter the amount the proof verifies (it may be less than was declared).", "VALIDATION_ERROR");
    const line = (await latestDeclaration(proof.employeeId, proof.fy))?.lines.find((l) => l.section === proof.section);
    if (!line || dec(d.amountVerified).greaterThan(dec(line.amount.toString()))) throw new HttpError(400, "The verified amount cannot be more than the person declared.", "VALIDATION_ERROR");
    amount = canonicalDecimal(dec(d.amountVerified));
  }
  const row = await prisma.taxProofDecision.create({ data: { proofId, decision: d.decision, amountVerified: amount, reason: d.reason, decidedByUserId: actor.userId } });
  await writeAuditLog({ actorUserId: actor.userId, action: "tax.proof.decided", entityType: "TaxProof", entityId: proofId, after: { decision: d.decision, amountVerified: amount, reason: d.reason }, ipAddress: actor.ip ?? null });
  return { id: row.id, decision: row.decision };
}

export async function proofQueue(fyRaw: string, actor: Actor) {
  await requireDirector(actor.userId, "see the proofs");
  const fy = fyOf(fyRaw);
  const proofs = await prisma.taxProof.findMany({ where: { fy }, orderBy: { createdAt: "asc" }, include: { decisions: { orderBy: { createdAt: "desc" }, take: 1 } } });
  const names = await namesOn([...new Set(proofs.map((p) => p.employeeId))], new Date(`${financialYearOf(iso(businessToday())).end}T00:00:00Z`));
  const codes = new Map((await prisma.employee.findMany({ where: { id: { in: [...new Set(proofs.map((p) => p.employeeId))] } }, select: { id: true, employeeCode: true } })).map((e) => [e.id, e.employeeCode]));
  const declared = new Map<string, string>();
  for (const e of new Set(proofs.map((p) => p.employeeId))) for (const l of (await latestDeclaration(e, fy))?.lines ?? []) declared.set(`${e}|${l.section}`, canonicalDecimal(dec(l.amount.toString())));
  return {
    year: fy,
    proofs: proofs.map((p) => ({ id: p.id, employeeCode: codes.get(p.employeeId) ?? "", name: names.get(p.employeeId) ?? "", section: p.section, declared: declared.get(`${p.employeeId}|${p.section}`) ?? "0", fileName: p.fileName, uploadedAt: p.createdAt.toISOString(), decision: p.decisions[0] ? { decision: p.decisions[0].decision, amountVerified: p.decisions[0].amountVerified === null ? null : canonicalDecimal(dec(p.decisions[0].amountVerified.toString())), reason: p.decisions[0].reason } : null })),
  };
}

export async function proofFileForDirector(proofId: string, actor: Actor) {
  await requireDirector(actor.userId, "open a proof");
  const p = await prisma.taxProof.findUnique({ where: { id: proofId } });
  if (!p) throw new HttpError(404, "There is no such proof.", "NOT_FOUND");
  await writeAuditLog({ actorUserId: actor.userId, action: "tax.proof.downloaded", entityType: "TaxProof", entityId: p.id, after: { own: false }, ipAddress: actor.ip ?? null });
  return { url: await storageService.getObjectSignedUrl(p.fileKey, 120, { downloadFileName: p.fileName }), fileName: p.fileName };
}

export async function declarationsList(fyRaw: string, actor: Actor) {
  await requireDirector(actor.userId, "see the declarations");
  const fy = fyOf(fyRaw);
  const rows = await prisma.taxDeclaration.findMany({ where: { fy }, orderBy: [{ employeeId: "asc" }, { version: "desc" }], include: { lines: true } });
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!latest.has(r.employeeId)) latest.set(r.employeeId, r);
  const ids = [...latest.keys()];
  const names = await namesOn(ids, new Date(`${financialYearOf(iso(businessToday())).end}T00:00:00Z`));
  const codes = new Map((await prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, employeeCode: true } })).map((e) => [e.id, e.employeeCode]));
  return { year: fy, declarations: ids.map((id) => { const d = latest.get(id)!; return { employeeCode: codes.get(id) ?? "", name: names.get(id) ?? "", version: d.version, regime: d.regime, total: canonicalDecimal(sum(d.lines.map((l) => dec(l.amount.toString())))), lines: d.lines.length, submittedAt: d.submittedAt.toISOString() }; }) };
}

export { TaxValueNotSetError };
