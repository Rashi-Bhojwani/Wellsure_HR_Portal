import { z } from "zod";
import { PAYROLL_REPORTS, PAYROLL_REPORT_KEYS, type PayrollReportKey, type PayrollReportResult } from "@shared/constants/payrollReports";
import { writeAuditLog } from "../../../lib/audit";
import { requireDirector } from "../../../lib/directorAuthority";
import { buildXlsx } from "../../../lib/xlsx";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { build, totalsOf, type Filters } from "./definitions";

// Stage 6 (docs/plans/STAGE_6_PAYROLL_REPORTS.md): the payroll reports. Directors only (the router gate plus requireDirector here). Column layouts start from the
// conventional set ("Default, change in settings"); a director may save the company's layout for a report (append-only, audited). Every export is audited.

export const DEFAULT_LABEL = "Default, change in settings";
export interface Actor {
  userId: string;
  ip?: string | null;
}

const month = z.string().regex(/^\d{4}-\d{2}(-01)?$/, "A month, YYYY-MM");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date, YYYY-MM-DD");
export const filtersSchema = z
  .object({ month: month.optional(), compareMonth: month.optional(), fromMonth: month.optional(), toMonth: month.optional(), fromDate: date.optional(), toDate: date.optional(), asOf: date.optional(), department: z.string().min(1).max(64).optional(), location: z.string().min(1).max(64).optional() })
  .strict();

function keyOf(raw: string): PayrollReportKey {
  if (!(PAYROLL_REPORT_KEYS as readonly string[]).includes(raw)) throw new HttpError(404, "There is no such payroll report.", "NOT_FOUND");
  return raw as PayrollReportKey;
}
function parseFilters(key: PayrollReportKey, raw: unknown): Filters {
  const parsed = filtersSchema.safeParse(raw ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const allowed = new Set<string>(PAYROLL_REPORTS[key].filters);
  const extra = Object.keys(parsed.data).filter((k) => !allowed.has(k));
  if (extra.length) throw new HttpError(400, `This report does not take: ${extra.join(", ")}.`, "VALIDATION_ERROR");
  return parsed.data;
}

async function layoutOf(key: PayrollReportKey) {
  const saved = await prisma.payrollReportLayout.findFirst({ where: { reportKey: key }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  const known = new Set(PAYROLL_REPORTS[key].columns.map((c) => c.key));
  if (saved) return { columns: saved.columns.filter((c) => known.has(c)), isDefault: false, label: null as string | null, savedAt: saved.createdAt.toISOString(), reason: saved.reason };
  return { columns: PAYROLL_REPORTS[key].columns.filter((c) => c.on).map((c) => c.key), isDefault: true, label: DEFAULT_LABEL as string | null, savedAt: null as string | null, reason: null as string | null };
}

export async function catalog(actor: Actor) {
  await requireDirector(actor.userId, "see the payroll reports");
  return { reports: await Promise.all(PAYROLL_REPORT_KEYS.map(async (k) => ({ ...PAYROLL_REPORTS[k], layout: await layoutOf(k) }))) };
}

export async function run(rawKey: string, rawFilters: unknown, actor: Actor): Promise<PayrollReportResult & { layout: Awaited<ReturnType<typeof layoutOf>> }> {
  await requireDirector(actor.userId, "see a payroll report");
  const key = keyOf(rawKey);
  const f = parseFilters(key, rawFilters);
  const built = await build(key, f, actor);
  return { key, title: PAYROLL_REPORTS[key].title, generatedAt: new Date().toISOString() /* allow-clock: when the report was made */, filtersApplied: built.filtersApplied, columns: [...PAYROLL_REPORTS[key].columns], rows: built.rows, totals: totalsOf(key, built.rows), notes: built.notes, layout: await layoutOf(key) };
}

export const layoutSchema = z.object({ columns: z.array(z.string().min(1).max(40)).min(1).max(40), reason: z.string().trim().min(3).max(300) }).strict();

export async function saveLayout(rawKey: string, raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "change a payroll report's layout");
  const key = keyOf(rawKey);
  const parsed = layoutSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const known = new Set(PAYROLL_REPORTS[key].columns.map((c) => c.key));
  const unknown = parsed.data.columns.filter((c) => !known.has(c));
  if (unknown.length) throw new HttpError(400, `Not a column of this report: ${unknown.join(", ")}.`, "VALIDATION_ERROR");
  const before = await layoutOf(key);
  const columns = PAYROLL_REPORTS[key].columns.map((c) => c.key).filter((c) => parsed.data.columns.includes(c)); // the report's own order
  await prisma.payrollReportLayout.create({ data: { reportKey: key, columns, reason: parsed.data.reason, setByUserId: actor.userId } });
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.report.layout_saved", entityType: "PayrollReportLayout", entityId: key, before: { columns: before.columns, isDefault: before.isDefault }, after: { columns, reason: parsed.data.reason } });
  return layoutOf(key);
}

export const exportSchema = z.object({ format: z.enum(["xlsx", "csv"]), columns: z.string().max(800).optional() }).passthrough();

/** CSV: quoted cells; a text cell that a spreadsheet would read as a formula gets a leading apostrophe. */
export function csvOf(columns: Array<{ key: string; header: string; type: string }>, rows: Array<Record<string, unknown>>, preamble: string[]): string {
  const cell = (v: unknown, type: string) => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    if (type === "text" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) || s.startsWith("'") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [...preamble.map((p) => cell(p, "text")), "", columns.map((c) => cell(c.header, "text")).join(","), ...rows.map((r) => columns.map((c) => cell(r[c.key], c.type)).join(","))];
  return `${lines.join("\r\n")}\r\n`;
}

export async function exportReport(rawKey: string, rawQuery: Record<string, unknown>, actor: Actor): Promise<{ buffer: Buffer; fileName: string; contentType: string }> {
  await requireDirector(actor.userId, "export a payroll report");
  const key = keyOf(rawKey);
  const q = exportSchema.safeParse(rawQuery);
  if (!q.success) throw new HttpError(400, q.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const { format, columns: colList, ...filterPart } = q.data as { format: "xlsx" | "csv"; columns?: string } & Record<string, unknown>;
  const f = parseFilters(key, filterPart);
  const built = await build(key, f, actor);
  const def = PAYROLL_REPORTS[key];
  const chosen = colList ? colList.split(",").filter(Boolean) : (await layoutOf(key)).columns;
  const unknown = chosen.filter((c) => !def.columns.some((d) => d.key === c));
  if (unknown.length || chosen.length === 0) throw new HttpError(400, `Not a column of this report: ${unknown.join(", ") || "(none chosen)"}.`, "VALIDATION_ERROR");
  const columns = def.columns.filter((c) => chosen.includes(c.key));
  const totals = totalsOf(key, built.rows);
  const stamp = new Date().toISOString().slice(0, 10); // allow-clock: the file's date
  const fileName = `${key}-${stamp}.${format}`;
  const preamble = [def.title, ...built.filtersApplied];
  const rows = built.rows.map((r) => Object.fromEntries(columns.map((c) => [c.key, r[c.key] ?? null])));
  const buffer =
    format === "csv"
      ? Buffer.from(csvOf(columns, [...rows, ...(Object.keys(totals).length ? [Object.fromEntries(columns.map((c, i) => [c.key, i === 0 && totals[c.key] === undefined ? "Total" : (totals[c.key] ?? "")]))] : [])], preamble), "utf8")
      : await buildXlsx([{ name: def.title, columns: columns.map((c) => ({ key: c.key, header: c.header, type: c.type })), rows, totals: Object.fromEntries(columns.map((c) => [c.key, totals[c.key] ?? null])), footer: [...built.filtersApplied, ...built.notes] }]);
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.report.exported", entityType: "PayrollReport", entityId: key, after: { format, filters: f, columns: columns.map((c) => c.key), rows: rows.length } }); // never a figure
  return { buffer, fileName, contentType: format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
}
