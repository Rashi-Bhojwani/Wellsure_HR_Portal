import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { z } from "zod";
import { cycleForRules, loadCycleRules } from "../../../lib/attendanceCycle";
import { writeAuditLog } from "../../../lib/audit";
import { requireDirector } from "../../../lib/directorAuthority";
import { recordDirectorNotice, scheduleDelivery } from "../../../lib/directorNotices";
import { namesOn, notifyPayrollInputsChanged } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { noteFiguresChanged } from "../approvals";
import { recordEvent } from "../events";
import { payrollHash } from "../hash";
import { addCalendarDays, businessToday } from "../../../lib/businessDate";
import { iso } from "../run/days";
import { assertNotOwnPay } from "../salary/guards";
import { FIXED_COLUMNS, fixedColumnOf, normaliseHeader, parseDateText, readTable, type RawTable } from "./importParse";
import { parseAmountText, type MonthState } from "./rules";
import { inputHeads, monthView, peopleInMonth, type Actor, type Head } from "./service";

// Importing Monthly Inputs from a file (docs/plans/STAGE_4_PLAN.md): upload → preview → a director confirms. Nothing is a figure of any month until the confirm; the
// same file (by hash) is applied once; one invalid row refuses the whole file unless the director chooses to skip the invalid rows, and that choice is recorded.
//
// UNCONFIRMED BY THE OWNERS: "Override From" and "Override Till" are read as an inclusive range of payroll months (the months that contain those two dates), and the
// figures apply to each month in the range. Principal Part and Interest Part belong to loans, a later stage: they are read, shown and kept, and not posted to any month.

const MAX_MONTHS_PER_ROW = 12;

export interface PreviewRow {
  line: number;
  employeeNumber: string;
  employeeId: string | null;
  name: string | null;
  from: string | null;
  till: string | null;
  months: string[];
  /** head code → canonical amount, for the cells this row fills. A blank cell enters nothing. */
  figures: Record<string, string>;
  principal: string | null;
  interest: string | null;
  remarks: string;
  problems: string[];
}

export interface ColumnView {
  header: string;
  kind: "FIXED" | "HEAD" | "IGNORED_EMPTY" | "UNKNOWN";
  head?: string;
}

export interface Analysis {
  columns: ColumnView[];
  fileProblems: string[];
  rows: PreviewRow[];
  valid: number;
  invalid: number;
  /** Cells that would be written if every valid row is applied. */
  cells: number;
  months: string[];
  notices: string[];
}

export const IMPORT_NOTICES = [
  "Override From and Override Till are read as an inclusive range of payroll months: the figures apply to each month from the one containing From to the one containing Till. The owners have not confirmed this reading.",
  "Principal Part and Interest Part belong to loans, a later stage. They are shown here and kept with the file, and are not posted to any month.",
  "A blank figure enters nothing. A 0 enters zero. Importing never clears a figure.",
];

const matchHeads = (headers: string[], heads: Head[]): Map<number, Head> => {
  const byKey = new Map<string, Head>();
  for (const h of heads) {
    byKey.set(normaliseHeader(h.name), h);
    byKey.set(normaliseHeader(h.code), h);
  }
  const out = new Map<number, Head>();
  headers.forEach((h, i) => {
    const hit = byKey.get(normaliseHeader(h));
    if (hit && !fixedColumnOf(h)) out.set(i, hit);
  });
  return out;
};

async function monthsOf(from: string, till: string): Promise<string[] | string> {
  if (till < from) return "Override Till is before Override From.";
  const rules = await loadCycleRules();
  let cycle = cycleForRules(rules, new Date(`${from}T00:00:00Z`));
  const last = iso(cycleForRules(rules, new Date(`${till}T00:00:00Z`)).start);
  const out: string[] = [];
  while (iso(cycle.start) <= last) {
    out.push(iso(cycle.start));
    if (out.length > MAX_MONTHS_PER_ROW) return `The range covers more than ${MAX_MONTHS_PER_ROW} months.`;
    cycle = cycleForRules(rules, addCalendarDays(cycle.end, 1));
  }
  return out;
}

/** Reads the raw cells against the database as it is now. Run again at the confirm, so a month that has closed since the preview is caught. */
export async function analyse(raw: RawTable): Promise<Analysis> {
  const fileProblems: string[] = [];
  const notices = [...IMPORT_NOTICES];
  const allHeads = await inputHeads(new Date("9999-01-01T00:00:00Z")); // every flagged head with no end date; whether it is active in a given month is checked per month below
  const headColumns = matchHeads(raw.headers, allHeads);
  const columns: ColumnView[] = raw.headers.map((header, i) => {
    if (fixedColumnOf(header)) return { header, kind: "FIXED" };
    const head = headColumns.get(i);
    if (head) return { header, kind: "HEAD", head: head.code };
    const used = raw.rows.some((r) => (r.cells[i] ?? "") !== "");
    if (header === "") return { header: "(no heading)", kind: used ? "UNKNOWN" : "IGNORED_EMPTY" };
    return { header, kind: used ? "UNKNOWN" : "IGNORED_EMPTY" };
  });
  for (const f of FIXED_COLUMNS.slice(0, 3)) if (!raw.headers.some((h) => fixedColumnOf(h) === f)) fileProblems.push(`The column "${f}" is missing.`);
  const seenFixed = new Set<string>();
  for (const h of raw.headers) {
    const f = fixedColumnOf(h);
    if (f && seenFixed.has(f)) fileProblems.push(`The column "${f}" appears twice.`);
    if (f) seenFixed.add(f);
  }
  for (const c of columns) if (c.kind === "UNKNOWN") fileProblems.push(`The column "${c.header}" has figures but is not a pay head that takes its value from Monthly Inputs. Create and flag that pay head first, or remove the column. Nothing is guessed from a column name.`);
  if (!columns.some((c) => c.kind === "HEAD")) fileProblems.push("No column is a pay head that takes its value from Monthly Inputs.");
  const seenHead = new Map<string, number>();
  for (const [i, h] of headColumns) {
    if (seenHead.has(h.code)) fileProblems.push(`The pay head ${h.name} appears in two columns.`);
    seenHead.set(h.code, i);
  }

  const col = (name: (typeof FIXED_COLUMNS)[number]) => raw.headers.findIndex((h) => fixedColumnOf(h) === name);
  const cNo = col("Employee Number");
  const cFrom = col("Override From");
  const cTill = col("Override Till");
  const cPrin = col("Principal Part");
  const cInt = col("Interest Part");
  const cRem = col("Remarks");

  const codes = [...new Set(raw.rows.map((r) => (r.cells[cNo] ?? "").trim()).filter((x) => x !== ""))];
  const emps = await prisma.employee.findMany({ where: { employeeCode: { in: codes } }, select: { id: true, employeeCode: true } });
  const names = await namesOn(emps.map((e) => e.id), businessToday());
  const empByCode = new Map(emps.map((e) => [e.employeeCode.toLowerCase(), e]));

  const stateCache = new Map<string, { state: MonthState; reason: string | null; label: string; ids: Set<string>; heads: Set<string> }>();
  const monthInfo = async (start: string) => {
    let info = stateCache.get(start);
    if (!info) {
      const v = await monthView(start);
      const cycle = await cycleForRules(await loadCycleRules(), new Date(`${start}T00:00:00Z`));
      info = { state: v.state, reason: v.reason, label: v.label, ids: new Set((await peopleInMonth(cycle.start, cycle.end)).ids), heads: new Set(v.heads.map((h) => h.code)) };
      stateCache.set(start, info);
    }
    return info;
  };

  const rows: PreviewRow[] = [];
  const claimed = new Map<string, number>(); // employee|month|head → first line
  for (const r of raw.rows) {
    const problems: string[] = [];
    const get = (i: number) => (i >= 0 ? (r.cells[i] ?? "").trim() : "");
    const employeeNumber = get(cNo);
    const emp = employeeNumber ? empByCode.get(employeeNumber.toLowerCase()) : undefined;
    if (employeeNumber === "") problems.push("Employee Number is blank.");
    else if (!emp) problems.push(`No employee has the number ${employeeNumber}.`);
    const from = parseDateText(get(cFrom));
    const till = parseDateText(get(cTill));
    if (cFrom >= 0 && from === null) problems.push(`Override From "${get(cFrom)}" is not a date. Write it as 2026-04-01 or 01-Apr-2026.`);
    if (cTill >= 0 && till === null) problems.push(`Override Till "${get(cTill)}" is not a date. Write it as 2026-04-30 or 30-Apr-2026.`);
    let months: string[] = [];
    if (from && till) {
      const m = await monthsOf(from, till);
      if (typeof m === "string") problems.push(m);
      else months = m;
    }
    const figures: Record<string, string> = {};
    for (const [i, head] of headColumns) {
      const text = get(i);
      if (text === "") continue;
      const a = parseAmountText(text);
      if (a.ok) figures[head.code] = a.value;
      else problems.push(`${head.name}: ${a.message}`);
    }
    if (Object.keys(figures).length === 0 && problems.length === 0) problems.push("The row has no figure in any pay head column.");
    const parseOptional = (i: number, label: string) => {
      const t = get(i);
      if (t === "") return null;
      const a = parseAmountText(t);
      if (!a.ok) {
        problems.push(`${label}: ${a.message}`);
        return null;
      }
      return a.value;
    };
    const principal = parseOptional(cPrin, "Principal Part");
    const interest = parseOptional(cInt, "Interest Part");
    if (emp) {
      for (const month of months) {
        const info = await monthInfo(month);
        if (info.state === "CLOSED" || info.state === "LOCKED") problems.push(`${info.label}: ${info.reason ?? "not open for figures"}`);
        else {
          if (!info.ids.has(emp.id)) problems.push(`${info.label}: ${employeeNumber} was not employed in that month.`);
          for (const head of Object.keys(figures)) if (!info.heads.has(head)) problems.push(`${info.label}: ${allHeads.find((h) => h.code === head)?.name ?? head} is not active in that month.`);
        }
      }
      for (const month of months)
        for (const head of Object.keys(figures)) {
          const key = `${emp.id}|${month}|${head}`;
          const first = claimed.get(key);
          if (first !== undefined) problems.push(`The same cell (${employeeNumber}, ${month}, ${allHeads.find((h) => h.code === head)?.name ?? head}) is also on line ${first}.`);
          else claimed.set(key, r.line);
        }
    }
    rows.push({ line: r.line, employeeNumber, employeeId: emp?.id ?? null, name: emp ? (names.get(emp.id) ?? emp.employeeCode) : null, from, till, months, figures, principal, interest, remarks: get(cRem).slice(0, 200), problems });
  }
  const valid = rows.filter((r) => r.problems.length === 0);
  return {
    columns,
    fileProblems,
    rows,
    valid: valid.length,
    invalid: rows.length - valid.length,
    cells: valid.reduce((n, r) => n + r.months.length * Object.keys(r.figures).length, 0),
    months: [...new Set(valid.flatMap((r) => r.months))].sort(),
    notices,
  };
}

const fingerprintOf = (batchHash: string, a: Analysis) => payrollHash({ t: "MONTHLY_INPUTS_IMPORT", file: batchHash, rows: a.rows.map((r) => [r.line, r.problems.length, r.months, Object.entries(r.figures).sort()]), fileProblems: a.fileProblems });

export interface BatchView {
  id: string;
  fileName: string;
  fileHash: string;
  status: "PREVIEW" | "APPLIED" | "DISCARDED";
  analysis: Analysis;
  /** Set when the same file was already applied: it cannot be applied again. */
  alreadyApplied: { batchId: string; at: string } | null;
  fingerprint: string;
  canApply: boolean;
  canApplySkippingInvalid: boolean;
}

async function viewOf(batch: { id: string; fileName: string; fileHash: string; status: "PREVIEW" | "APPLIED" | "DISCARDED"; parsed: unknown }): Promise<BatchView> {
  const analysis = await analyse(batch.parsed as RawTable);
  const applied = batch.status === "APPLIED" ? null : await prisma.payrollInputBatch.findFirst({ where: { fileHash: batch.fileHash, status: "APPLIED" }, select: { id: true, appliedAt: true } });
  const blocked = analysis.fileProblems.length > 0 || applied !== null || batch.status !== "PREVIEW";
  return {
    id: batch.id,
    fileName: batch.fileName,
    fileHash: batch.fileHash,
    status: batch.status,
    analysis,
    alreadyApplied: applied ? { batchId: applied.id, at: applied.appliedAt?.toISOString() ?? "" } : null,
    fingerprint: fingerprintOf(batch.fileHash, analysis),
    canApply: !blocked && analysis.invalid === 0 && analysis.valid > 0,
    canApplySkippingInvalid: !blocked && analysis.invalid > 0 && analysis.valid > 0,
  };
}

export async function upload(file: { buffer: Buffer; originalname: string }, actor: Actor): Promise<BatchView> {
  await requireDirector(actor.userId, "import Monthly Inputs");
  const raw = await readTable(file.buffer, file.originalname);
  const fileHash = createHash("sha256").update(file.buffer).digest("hex");
  const existing = await prisma.payrollInputBatch.findFirst({ where: { fileHash, status: { in: ["PREVIEW", "APPLIED"] } }, orderBy: { createdAt: "desc" } });
  if (existing) return viewOf(existing);
  const analysis = await analyse(raw);
  const batch = await prisma.payrollInputBatch.create({
    data: { fileName: file.originalname.slice(0, 200), fileHash, parsed: raw as unknown as object, summary: { rows: analysis.rows.length, valid: analysis.valid, invalid: analysis.invalid, cells: analysis.cells }, uploadedByUserId: actor.userId },
  });
  await writeAuditLog({ actorUserId: actor.userId, action: "payroll.monthly_inputs.import_previewed", entityType: "PayrollInputBatch", entityId: batch.id, after: { rows: analysis.rows.length, invalid: analysis.invalid, amounts: "redacted" }, ipAddress: actor.ip ?? null });
  return viewOf(batch);
}

export async function getBatch(id: string): Promise<BatchView> {
  const batch = await prisma.payrollInputBatch.findUnique({ where: { id } });
  if (!batch) throw new HttpError(404, "That import was not found.", "NOT_FOUND");
  return viewOf(batch);
}

export async function listBatches(): Promise<Array<{ id: string; fileName: string; status: string; summary: unknown; createdAt: string; appliedAt: string | null }>> {
  const rows = await prisma.payrollInputBatch.findMany({ orderBy: { createdAt: "desc" }, take: 100, select: { id: true, fileName: true, status: true, summary: true, createdAt: true, appliedAt: true } });
  return rows.map((r) => ({ id: r.id, fileName: r.fileName, status: r.status, summary: r.summary, createdAt: r.createdAt.toISOString(), appliedAt: r.appliedAt?.toISOString() ?? null }));
}

export const applySchema = z.object({ fingerprint: z.string().min(1).max(200), skipInvalid: z.boolean(), reason: z.string().trim().min(3, "Say why").max(200) }).strict();

export async function discard(id: string, actor: Actor): Promise<void> {
  await requireDirector(actor.userId, "discard an import");
  const { count } = await prisma.payrollInputBatch.updateMany({ where: { id, status: "PREVIEW" }, data: { status: "DISCARDED" } });
  if (count !== 1) throw new HttpError(409, "That import is not a preview any more.", "CONFLICT");
  await writeAuditLog({ actorUserId: actor.userId, action: "payroll.monthly_inputs.import_discarded", entityType: "PayrollInputBatch", entityId: id, ipAddress: actor.ip ?? null });
}

export async function apply(id: string, raw: unknown, actor: Actor): Promise<{ written: number; skippedRows: number; months: string[] }> {
  const parsed = applySchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const input = parsed.data;
  await requireDirector(actor.userId, "import Monthly Inputs");
  const batch = await prisma.payrollInputBatch.findUnique({ where: { id } });
  if (!batch) throw new HttpError(404, "That import was not found.", "NOT_FOUND");
  if (batch.status !== "PREVIEW") throw new HttpError(409, `That import is already ${batch.status.toLowerCase()}.`, "CONFLICT");
  const twin = await prisma.payrollInputBatch.findFirst({ where: { fileHash: batch.fileHash, status: "APPLIED" }, select: { id: true } });
  if (twin) throw new HttpError(409, "This exact file was already applied. A file is never applied twice.", "FILE_ALREADY_APPLIED");
  const view = await viewOf(batch);
  if (view.fingerprint !== input.fingerprint) throw new HttpError(409, "What you were looking at is not what is there now (a month may have closed). Look at the preview again.", "PREVIEW_STALE");
  const a = view.analysis;
  if (a.fileProblems.length > 0) throw new HttpError(409, `The file cannot be applied: ${a.fileProblems.slice(0, 3).join(" ")}`, "FILE_REFUSED");
  if (a.invalid > 0 && !input.skipInvalid) throw new HttpError(409, `${a.invalid} ${a.invalid === 1 ? "row is" : "rows are"} invalid, so nothing was saved. Fix the file, or choose to skip the invalid rows.`, "FILE_HAS_INVALID_ROWS");
  const good = a.rows.filter((r) => r.problems.length === 0);
  if (good.length === 0) throw new HttpError(409, "No row is valid, so there is nothing to save.", "NOTHING_TO_SAVE");
  await assertNotOwnPay(actor.userId, good.flatMap((r) => (r.employeeId ? [r.employeeId] : [])), "This import");

  const planned = good.flatMap((r) => r.months.flatMap((month) => Object.entries(r.figures).map(([head, amount]) => ({ employeeId: r.employeeId!, head, amount, month }))));
  const months = [...new Set(planned.map((p) => p.month))].sort();
  const reason = input.reason;
  const noticeId = await prisma.$transaction(async (tx) => {
    await tx.payrollMonthlyInput.createMany({ data: planned.map((p) => ({ employeeId: p.employeeId, componentCode: p.head, cycleStart: new Date(`${p.month}T00:00:00Z`), amount: p.amount, cleared: false, reason: `Import ${batch.fileName.slice(0, 64)}: ${reason}`, enteredByUserId: actor.userId, batchId: batch.id })) });
    for (const month of months) await noteFiguresChanged("MONTHLY_INPUTS", month, actor.userId, "Monthly Inputs were imported from a file", tx);
    const flipped = await tx.payrollInputBatch.updateMany({ where: { id: batch.id, status: "PREVIEW" }, data: { status: "APPLIED", skipInvalid: input.skipInvalid, appliedByUserId: actor.userId, appliedAt: new Date() } }); // allow-clock: an instant
    if (flipped.count !== 1) throw new HttpError(409, "That import was just applied or discarded by somebody else.", "CONFLICT");
    await recordEvent({ subjectType: "MONTHLY_INPUTS_IMPORT", subjectId: batch.id, type: "APPLIED", actorUserId: actor.userId, payload: { cells: planned.length, months, skippedRows: a.invalid, skipInvalid: input.skipInvalid } }, tx);
    const n = await recordDirectorNotice({ kind: "ACTION", step: "MONTHLY_INPUTS", subjectType: "MONTHLY_INPUTS_IMPORT", subjectId: batch.id, subjectLabel: `an import of ${planned.length} Monthly Inputs ${planned.length === 1 ? "figure" : "figures"}${a.invalid ? ` (${a.invalid} invalid ${a.invalid === 1 ? "row" : "rows"} skipped)` : ""}`, itemCount: planned.length, actorUserId: actor.userId, approvalId: null, authority: null }, tx);
    return n.noticeId;
  });
  await writeAuditLog({ actorUserId: actor.userId, action: "payroll.monthly_inputs.import_applied", entityType: "PayrollInputBatch", entityId: batch.id, after: { cells: planned.length, months, rows: good.length, skippedInvalidRows: a.invalid, skipInvalid: input.skipInvalid, fileHash: batch.fileHash, amounts: "redacted" }, ipAddress: actor.ip ?? null });
  await scheduleDelivery(noticeId);
  await notifyPayrollInputsChanged("Monthly Inputs were imported from a file", actor.userId);
  return { written: planned.length, skippedRows: a.invalid, months };
}

/** The empty template: the fixed columns of the sample, then one column per pay head that takes its value from Monthly Inputs and is active now. No row of example figures. */
export async function template(format: "xlsx" | "csv"): Promise<{ buffer: Buffer; contentType: string; fileName: string }> {
  const heads = await inputHeads(new Date("9999-01-01T00:00:00Z"));
  const headers = [...FIXED_COLUMNS, ...heads.map((h) => h.name)];
  if (format === "csv") return { buffer: Buffer.from(headers.map((h) => (/[",]/.test(h) ? `"${h.replace(/"/g, '""')}"` : h)).join(",") + "\n", "utf8"), contentType: "text/csv; charset=utf-8", fileName: "monthly-inputs-template.csv" };
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Monthly Inputs");
  sheet.addRow(headers);
  sheet.getRow(1).font = { bold: true };
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fileName: "monthly-inputs-template.xlsx" };
}

