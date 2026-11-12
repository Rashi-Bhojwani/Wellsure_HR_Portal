import { createHash } from "node:crypto";
import { z } from "zod";
import { parseFinancialYearLabel } from "@shared/utils/financialYear";
import { writeAuditLog } from "../../../lib/audit";
import { requireDirector } from "../../../lib/directorAuthority";
import { businessToday } from "../../../lib/businessDate";
import { namesOn } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { decide, liveApproval, registerSubject, submit } from "../approvals";
import { payrollHash } from "../hash";
import { canonicalDecimal, dec, fixed, sum, ZERO, type Money } from "../money";
import { keyedHash, seal } from "../sealed";
import { statementFor } from "./statement";
import { renderPdf } from "../../../lib/pdf/renderer";
import { getLetterhead } from "../../letters/service";
import type { EngineResult } from "./engine";
import { form16Html } from "./form16Html";
import { buildXlsx } from "../../../lib/xlsx";
import { csvOf } from "../reports/service";

// P7-7 (docs/plans/P7_7_FORM16.md): the challan register, quarterly data and Form 16 Part B data. Directors only, except a person's own Form 16. Nothing talks to a
// bank or the tax portal; no official file format is built. Form 16 data stays DRAFT until a different director confirms the year as a whole.

export interface Actor {
  userId: string;
  ip?: string | null;
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const MONEY = /^\d+(\.\d{1,2})?$/;

function fyOf(raw: string) {
  try {
    return parseFinancialYearLabel(raw);
  } catch (err) {
    throw new HttpError(400, (err as Error).message, "VALIDATION_ERROR");
  }
}
/** The twelve months of a financial year, "YYYY-MM", April first. */
export function monthsOf(fyLabel: string): string[] {
  const start = parseFinancialYearLabel(fyLabel).startYear;
  return Array.from({ length: 12 }, (_, i) => {
    const m = (3 + i) % 12; // allow-number: calendar months, April first
    const y = start + (3 + i >= 12 ? 1 : 0); // allow-number: calendar arithmetic
    return `${y}-${String(m + 1).padStart(2, "0")}`;
  });
}

// ── TDS deducted, month by month (finalised runs only) ─────────────────────────────────────────────────────────────────────

export async function deductedByMonth(fyLabel: string): Promise<Map<string, Money>> {
  const fy = parseFinancialYearLabel(fyLabel);
  const lines = await prisma.payrollRunLine.findMany({ where: { source: "TDS", run: { status: "FINALISED", cycleEnd: { gte: day(fy.start), lte: day(fy.end) } } }, select: { amount: true, run: { select: { cycleEnd: true } } } });
  const out = new Map<string, Money>();
  for (const l of lines) {
    const m = iso(l.run.cycleEnd).slice(0, 7);
    out.set(m, (out.get(m) ?? ZERO).plus(dec(l.amount.toString())));
  }
  return out;
}

// ── The challan register ───────────────────────────────────────────────────────────────────────────────────────────────

export const challanSchema = z
  .object({
    fy: z.string().length(7),
    month: z.string().regex(/^\d{4}-\d{2}$/),
    depositedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    amount: z.string().regex(MONEY, "Digits with up to two decimals"),
    bsrCode: z.string().trim().regex(/^[0-9]{7}$/, "Seven digits"),
    serial: z.string().trim().regex(/^[0-9]{1,10}$/, "Up to ten digits"),
  })
  .strict();

export async function enterChallan(raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "enter a challan");
  const parsed = challanSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const v = parsed.data;
  const fy = fyOf(v.fy);
  if (!monthsOf(fy.label).includes(v.month)) throw new HttpError(400, "That month is not in that financial year.", "VALIDATION_ERROR");
  if (v.depositedOn > iso(businessToday())) throw new HttpError(400, "A deposit cannot be in the future.", "VALIDATION_ERROR");
  const row = await prisma.tdsChallan.create({
    data: { financialYear: fy.label, month: v.month, depositedOn: day(v.depositedOn), amount: v.amount, bsrCode: seal(v.bsrCode) as unknown as object, serial: seal(v.serial) as unknown as object, serialHash: keyedHash("tds-challan-serial", v.serial), bsrLast: v.bsrCode.slice(-3), serialLast: v.serial.slice(-3), enteredByUserId: actor.userId },
  });
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.challan.entered", entityType: "TdsChallan", entityId: row.id, after: { fy: fy.label, month: v.month } }); // never the figures or the numbers
  return { id: row.id };
}

export const confirmChallanSchema = z.object({ amount: z.string().regex(MONEY), serial: z.string().trim().regex(/^[0-9]{1,10}$/) }).strict();

/** A different director confirms by typing the amount and the serial again; a mismatch is refused. */
export async function confirmChallan(id: string, raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "confirm a challan");
  const parsed = confirmChallanSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const c = await prisma.tdsChallan.findUnique({ where: { id }, include: { confirmation: true } });
  if (!c) throw new HttpError(404, "Challan not found.", "NOT_FOUND");
  if (c.confirmation) throw new HttpError(409, "Already confirmed.", "ALREADY_CONFIRMED");
  if (c.enteredByUserId === actor.userId) throw new HttpError(403, "You entered this challan, so a different director confirms it.", "CHECKER_IS_MAKER");
  if (!dec(parsed.data.amount).equals(dec(c.amount.toString())) || keyedHash("tds-challan-serial", parsed.data.serial) !== c.serialHash) throw new HttpError(409, "What you typed does not match what was entered. Check the challan and try again.", "RETYPE_MISMATCH");
  await prisma.tdsChallanConfirmation.create({ data: { challanId: id, confirmedByUserId: actor.userId } });
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.challan.confirmed", entityType: "TdsChallan", entityId: id });
  return { id, confirmed: true };
}

export async function register(fyRaw: string, actor: Actor) {
  await requireDirector(actor.userId, "see the challan register");
  const fy = fyOf(fyRaw);
  const [challans, deducted] = await Promise.all([prisma.tdsChallan.findMany({ where: { financialYear: fy.label }, include: { confirmation: true }, orderBy: [{ month: "asc" }, { createdAt: "asc" }] }), deductedByMonth(fy.label)]);
  const confirmedBy = new Map<string, Money>();
  for (const c of challans) if (c.confirmation) confirmedBy.set(c.month, (confirmedBy.get(c.month) ?? ZERO).plus(dec(c.amount.toString())));
  return {
    year: fy.label,
    challans: challans.map((c) => ({ id: c.id, month: c.month, depositedOn: iso(c.depositedOn), amount: canonicalDecimal(dec(c.amount.toString())), bsr: `…${c.bsrLast}`, serial: `…${c.serialLast}`, confirmed: !!c.confirmation, enteredByMe: c.enteredByUserId === actor.userId })),
    reconciliation: monthsOf(fy.label).map((m) => {
      const d = deducted.get(m) ?? ZERO;
      const p = confirmedBy.get(m) ?? ZERO;
      return { month: m, deducted: fixed(d, 2), deposited: fixed(p, 2), difference: fixed(d.minus(p), 2) };
    }),
  };
}

// ── Quarterly data (our own layout; the government utility's format is not built) ───────────────────────────────────────────────

export async function quarterly(fyRaw: string, quarter: number, actor: Actor) {
  await requireDirector(actor.userId, "see quarterly TDS data");
  const fy = fyOf(fyRaw);
  if (![1, 2, 3, 4].includes(quarter)) throw new HttpError(400, "A quarter is 1 to 4.", "VALIDATION_ERROR");
  const months = monthsOf(fy.label).slice((quarter - 1) * 3, quarter * 3);
  const items = await prisma.payrollRunItem.findMany({
    where: { run: { status: "FINALISED", cycleEnd: { gte: day(`${months[0]}-01`), lte: new Date(Date.UTC(Number(months[2]!.slice(0, 4)), Number(months[2]!.slice(5, 7)), 0)) } }, status: "PAYABLE" }, // allow-number: calendar arithmetic for the quarter's last day
    select: { employeeId: true, gross: true, run: { select: { cycleEnd: true } }, lines: { where: { source: "TDS" }, select: { amount: true } } },
  });
  const ids = [...new Set(items.map((i) => i.employeeId))];
  const [names, emps, stat, challans] = await Promise.all([
    namesOn(ids, businessToday()),
    prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, employeeCode: true } }),
    prisma.employeeStatutory.findMany({ where: { employeeId: { in: ids } }, select: { employeeId: true, panLast4: true } }),
    prisma.tdsChallan.findMany({ where: { financialYear: fy.label, month: { in: months }, confirmation: { isNot: null } }, select: { month: true, serialLast: true, depositedOn: true } }),
  ]);
  const code = new Map(emps.map((e) => [e.id, e.employeeCode]));
  const pan = new Map(stat.map((s) => [s.employeeId, s.panLast4]));
  const rows = ids.map((id) => {
    const mine = items.filter((i) => i.employeeId === id);
    const byMonth = Object.fromEntries(
      months.map((m) => {
        const ofMonth = mine.filter((i) => iso(i.run.cycleEnd).slice(0, 7) === m);
        return [m, { paid: fixed(sum(ofMonth.map((i) => dec(i.gross.toString()))), 2), tds: fixed(sum(ofMonth.flatMap((i) => i.lines.map((l) => dec(l.amount.toString())))), 2) }];
      }),
    );
    return { employeeCode: code.get(id) ?? "", name: names.get(id) ?? "", panLast4: pan.get(id) ?? null, byMonth };
  });
  return { year: fy.label, quarter, months, rows, challans: challans.map((c) => ({ month: c.month, serial: `…${c.serialLast}`, depositedOn: iso(c.depositedOn) })), note: "Our own layout. The government utility's input format is not built: its format has not been confirmed." };
}

// ── Form 16 Part B data ────────────────────────────────────────────────────────────────────────────────────────────────

function closedYear(fyRaw: string) {
  const fy = fyOf(fyRaw);
  if (iso(businessToday()) <= fy.end) throw new HttpError(409, `Form 16 data is made after the financial year ends (after ${fy.end}).`, "YEAR_NOT_CLOSED");
  return fy;
}

async function partB(employeeId: string, fyLabel: string) {
  const s = await statementFor(employeeId, fyLabel);
  const chosen = s.chosenRegime ?? s.defaultRegime;
  const result = chosen ? s.regimes[chosen] : null;
  return {
    year: fyLabel,
    employeeCode: s.employeeCode,
    regime: chosen,
    regimeSource: s.chosenRegime ? "CHOSEN" : s.defaultRegime ? "DEFAULT" : null,
    taxablePay: s.paidSoFar.taxable,
    tdsDeducted: s.paidSoFar.tds,
    computation: result ?? null,
    missing: s.missing,
    basis: s.basis,
    taxYearConfirmed: !s.draft,
  };
}

async function peopleOfYear(fyLabel: string): Promise<string[]> {
  const fy = parseFinancialYearLabel(fyLabel);
  const items = await prisma.payrollRunItem.findMany({ where: { status: "PAYABLE", run: { status: "FINALISED", cycleEnd: { gte: day(fy.start), lte: day(fy.end) } } }, select: { employeeId: true }, distinct: ["employeeId"] });
  return items.map((i) => i.employeeId).sort();
}

export async function hashOfYear(fyLabel: string): Promise<string> {
  const people = await peopleOfYear(fyLabel);
  const data = [];
  for (const id of people) {
    const b = await partB(id, fyLabel);
    data.push([id, b.regime, b.taxablePay, b.tdsDeducted, b.computation ? (b.computation as { annualTax?: string }).annualTax ?? null : null]);
  }
  return payrollHash({ fy: fyLabel, data });
}
const fingerprintOf = (fy: string, hash: string) => createHash("sha256").update(`${fy}|${hash}`).digest("hex");

async function confirmed(fyLabel: string): Promise<boolean> {
  const a = await liveApproval("FORM16_CONFIRM", fyLabel);
  return !!a && a.status === "APPROVED" && a.contentHash === (await hashOfYear(fyLabel));
}

export async function myForm16(employeeId: string, fyRaw: string) {
  const fy = closedYear(fyRaw);
  const b = await partB(employeeId, fy.label);
  const isConfirmed = (await confirmed(fy.label)) && b.taxYearConfirmed;
  return { ...b, draft: !isConfirmed, watermark: isConfirmed ? null : "DRAFT: not yet confirmed by a second director", partA: "Part A is issued from the tax department's portal; it is not made here." };
}

export async function yearForm16(fyRaw: string, actor: Actor) {
  await requireDirector(actor.userId, "see Form 16 data");
  const fy = closedYear(fyRaw);
  const people = await peopleOfYear(fy.label);
  const names = await namesOn(people, businessToday());
  const rows = [];
  for (const id of people) rows.push({ employeeId: id, name: names.get(id) ?? "", ...(await partB(id, fy.label)) });
  const approval = await liveApproval("FORM16_CONFIRM", fy.label);
  const hash = await hashOfYear(fy.label);
  const isConfirmed = !!approval && approval.status === "APPROVED" && approval.contentHash === hash;
  return { year: fy.label, state: isConfirmed ? "CONFIRMED" : approval?.status === "PENDING" ? "WAITING" : "DRAFT", waitingMine: approval?.status === "PENDING" ? approval.makerUserId === actor.userId : null, fingerprint: fingerprintOf(fy.label, hash), rows };
}

export const confirmSchema = z.object({ fingerprint: z.string().length(64) }).strict();
export const decisionSchema = z.object({ fingerprint: z.string().length(64), decision: z.enum(["APPROVE", "REJECT"]), note: z.string().trim().max(300).optional() }).strict();

export async function requestConfirmation(fyRaw: string, raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "ask for Form 16 data to be confirmed");
  const fy = closedYear(fyRaw);
  const parsed = confirmSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, "Look at the data first.", "VALIDATION_ERROR");
  if (fingerprintOf(fy.label, await hashOfYear(fy.label)) !== parsed.data.fingerprint) throw new HttpError(409, "The data changed since you looked at it.", "PREVIEW_STALE");
  return submit({ subject: "FORM16_CONFIRM", subjectId: fy.label, makerUserId: actor.userId, previewFingerprint: parsed.data.fingerprint, ip: actor.ip ?? null, notify: { step: "RULE_CONFIRM", subjectLabel: `Form 16 data for ${fy.label}`, itemCount: (await peopleOfYear(fy.label)).length } });
}

export async function decideConfirmation(fyRaw: string, raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "confirm Form 16 data");
  const fy = closedYear(fyRaw);
  const parsed = decisionSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const approval = await liveApproval("FORM16_CONFIRM", fy.label);
  if (!approval || approval.status !== "PENDING") throw new HttpError(409, "Nothing is waiting for a decision for this year.", "NOT_PENDING");
  const hash = await hashOfYear(fy.label);
  if (fingerprintOf(fy.label, hash) !== parsed.data.fingerprint) throw new HttpError(409, "What you were looking at is not what is there now.", "PREVIEW_STALE");
  return decide({ approvalId: approval.id, checkerUserId: actor.userId, decision: parsed.data.decision, ...(parsed.data.note ? { note: parsed.data.note } : {}), ip: actor.ip ?? null, expectedHash: hash });
}

registerSubject({
  subject: "FORM16_CONFIRM",
  makerPermission: "payroll.salary.edit",
  checkerPermission: "payroll.approve",
  async describe(fy) {
    return `the Form 16 data for ${fy}`;
  },
  hash: (fy) => hashOfYear(fy),
});

// ── ST-24 / SS-05 (docs/plans/A_PARITY_ROWS.md): the Form 16 Part B PDF, DRAFT until confirmed; Part A never made here ─────────────────────────────────

async function form16Pdf(employeeId: string, fyLabel: string): Promise<{ pdf: Buffer; draft: boolean }> {
  const [b, confirmedYear, names, stat, letterhead] = await Promise.all([partB(employeeId, fyLabel), confirmed(fyLabel), namesOn([employeeId], businessToday()), prisma.employeeStatutory.findUnique({ where: { employeeId }, select: { panLast4: true } }), getLetterhead()]);
  const draft = !(confirmedYear && b.taxYearConfirmed);
  const html = form16Html({
    company: { legalName: letterhead.legalName, address: letterhead.registeredAddress },
    employee: { name: names.get(employeeId) ?? "", code: b.employeeCode, panLast4: stat?.panLast4 ?? null },
    year: fyLabel,
    regime: b.regime,
    taxablePay: b.taxablePay,
    tdsDeducted: b.tdsDeducted,
    computation: (b.computation as EngineResult | null) ?? null,
    missing: b.missing,
    watermark: draft ? "DRAFT: not yet confirmed by a second director" : null,
    partA: "Part A is issued from the tax department's portal; it is not made here.",
  });
  const { pdf } = await renderPdf(html, new Date(0)); // allow-clock: a fixed PDF date, not a business date
  return { pdf, draft };
}

/** The person's own Form 16 PDF (their own only). */
export async function myForm16Pdf(employeeId: string, fyRaw: string, actor: Actor) {
  const fy = closedYear(fyRaw);
  if (!(await peopleOfYear(fy.label)).includes(employeeId)) throw new HttpError(404, "No finalised payroll run paid you in this year, so there is no Form 16 here.", "NOT_FOUND");
  const out = await form16Pdf(employeeId, fy.label);
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.form16.pdf_downloaded", entityType: "Employee", entityId: employeeId, after: { year: fy.label, draft: out.draft, own: true } });
  return { ...out, fileName: `form16-part-b-${fy.label}${out.draft ? "-DRAFT" : ""}.pdf` };
}

/** A director's copy of anyone's Form 16 PDF for a closed year. */
export async function directorForm16Pdf(fyRaw: string, employeeId: string, actor: Actor) {
  await requireDirector(actor.userId, "download a Form 16");
  const fy = closedYear(fyRaw);
  if (!(await peopleOfYear(fy.label)).includes(employeeId)) throw new HttpError(404, "That person was not paid by a finalised run in this year.", "NOT_FOUND");
  const out = await form16Pdf(employeeId, fy.label);
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.form16.pdf_downloaded", entityType: "Employee", entityId: employeeId, after: { year: fy.label, draft: out.draft, own: false } });
  return { ...out, fileName: `form16-part-b-${fy.label}-${employeeId.slice(-6)}${out.draft ? "-DRAFT" : ""}.pdf` };
}

// ── ST-21 (docs/plans/A_PARITY_ROWS.md): the quarterly data as .xlsx or .csv, our own layout; audited, never a figure in the audit ─────────────────────

export const quarterlyExportSchema = z.object({ fy: z.string().min(7).max(7), quarter: z.coerce.number().int().min(1).max(4), format: z.enum(["xlsx", "csv"]) }).strict();

export async function exportQuarterly(raw: unknown, actor: Actor): Promise<{ buffer: Buffer; fileName: string; contentType: string }> {
  const parsed = quarterlyExportSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const { fy, quarter, format } = parsed.data;
  const q = await quarterly(fy, quarter, actor);
  const columns = [
    { key: "employeeCode", header: "Employee code", type: "text" as const },
    { key: "name", header: "Name", type: "text" as const },
    { key: "pan", header: "PAN (last four)", type: "text" as const },
    ...q.months.flatMap((m) => [
      { key: `${m}|paid`, header: `${m} paid`, type: "money" as const },
      { key: `${m}|tds`, header: `${m} TDS`, type: "money" as const },
    ]),
  ];
  const rows = q.rows.map((r) => ({ employeeCode: r.employeeCode, name: r.name, pan: r.panLast4 ? `…${r.panLast4}` : "Not on record", ...Object.fromEntries(q.months.flatMap((m) => [[`${m}|paid`, r.byMonth[m]!.paid], [`${m}|tds`, r.byMonth[m]!.tds]])) }));
  const preamble = [`Quarterly TDS data, ${q.year}, quarter ${quarter}`, q.note, `Confirmed challans: ${q.challans.map((c) => `${c.month} ${c.serial} on ${c.depositedOn}`).join("; ") || "none"}`];
  const fileName = `quarterly-tds-${q.year}-q${quarter}.${format}`;
  const buffer = format === "csv" ? Buffer.from(csvOf(columns, rows, preamble), "utf8") : await buildXlsx([{ name: `Q${quarter} ${q.year}`, columns, rows, footer: preamble }]);
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.tax.quarterly_exported", entityType: "TaxYear", entityId: q.year, after: { quarter, format, rows: rows.length } });
  return { buffer, fileName, contentType: format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
}
