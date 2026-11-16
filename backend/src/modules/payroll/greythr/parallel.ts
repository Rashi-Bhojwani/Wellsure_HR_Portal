import { z } from "zod";
import { writeAuditLog } from "../../../lib/audit";
import { requireDirector } from "../../../lib/directorAuthority";
import { decryptField, encryptField } from "../../../lib/encryption";
import { prisma } from "../../../lib/prisma";
import { buildXlsx } from "../../../lib/xlsx";
import { HttpError } from "../../../middleware/errorHandler";
import { behaviourValue } from "../../behaviours/service";
import { canonicalDecimal, dec } from "../money";
import { pinStatuses, watermarkFromStatuses, type RulePin } from "../rules/context";
import { csvOf } from "../reports/service";
import { autoMapping, compareStatements, type CompareResult, type HeadMapping, type SidePerson } from "./compare";
import { readStatement, type Statement } from "./statement";

// Stage 8 (docs/plans/STAGE_8_PLAN.md, IE-12, PY-32): the parallel-run kit. Directors only. A director uploads greytHR's salary statement and chooses the portal run
// for the same month (finalised, or calculated on TEST rules); the kit compares and saves the result ENCRYPTED. It writes no payroll data. The uploaded file is
// read in memory and dropped; what is kept is the statement's parsed figures inside the encrypted result (so a director can change the head mapping and compare
// again) and counts that hold no figure. Every audit row names the month and the counts, never a figure.

export interface Actor {
  userId: string;
  ip?: string | null;
}

export const compareSchema = z.object({ runId: z.string().min(1).max(40), mapping: z.string().max(20_000).optional() }).strict();
export const recompareSchema = z.object({ mapping: z.record(z.string().max(120), z.string().max(40).nullable()) }).strict();

interface Saved {
  statement: Statement;
  fileName: string;
  run: { id: string; label: string; cycleStart: string; status: string; test: boolean };
  mapping: HeadMapping;
  portalHeads: Array<{ code: string; label: string }>;
  result: CompareResult;
}

const seal = (v: Saved) => encryptField(JSON.stringify(v));
const open = (b: Uint8Array): Saved => JSON.parse(decryptField(b)) as Saved;

/** Runs a statement can be compared with: finalised ones, and calculated ones on TEST (placeholder) rules. */
export async function comparableRuns(actor: Actor) {
  await requireDirector(actor.userId, "use the parallel-run kit");
  const runs = await prisma.payrollRun.findMany({ where: { status: { in: ["FINALISED", "CALCULATED", "SUBMITTED", "APPROVED"] } }, orderBy: { cycleStart: "desc" }, take: 60, select: { id: true, cycleLabel: true, cycleStart: true, status: true, pins: true } });
  const out = [];
  for (const r of runs) {
    const test = watermarkFromStatuses(await pinStatuses((r.pins as unknown as RulePin[]) ?? [])).test;
    if (r.status === "FINALISED" || test) out.push({ id: r.id, label: r.cycleLabel, cycleStart: r.cycleStart.toISOString().slice(0, 10), status: r.status, test });
  }
  return { runs: out };
}

async function portalSide(runId: string) {
  const run = await prisma.payrollRun.findUnique({ where: { id: runId }, select: { id: true, cycleLabel: true, cycleStart: true, status: true, pins: true } });
  if (!run) throw new HttpError(404, "There is no such payroll run.", "NOT_FOUND");
  const test = watermarkFromStatuses(await pinStatuses((run.pins as unknown as RulePin[]) ?? [])).test;
  if (run.status !== "FINALISED" && !(test && ["CALCULATED", "SUBMITTED", "APPROVED"].includes(run.status))) throw new HttpError(409, "Choose a finalised run, or a run calculated on TEST rules.", "RUN_NOT_COMPARABLE");
  const items = await prisma.payrollRunItem.findMany({ where: { runId, status: { in: ["PAYABLE", "HELD"] } }, select: { id: true, paidDays: true, lopDays: true, gross: true, deductions: true, netPay: true, employee: { select: { employeeCode: true } } } });
  const lines = await prisma.payrollRunLine.findMany({ where: { runItemId: { in: items.map((i) => i.id) }, kind: { not: "ROUNDING" } }, select: { runItemId: true, code: true, label: true, kind: true, amount: true } });
  const labels: Record<string, string> = {};
  const byItem = new Map<string, Record<string, string>>();
  for (const l of lines) {
    labels[l.code] = l.kind === "EMPLOYER_CONTRIBUTION" ? `${l.label} (employer)` : l.label;
    const m = byItem.get(l.runItemId) ?? {};
    m[l.code] = canonicalDecimal(dec(m[l.code] ?? "0").plus(dec(l.amount.toString())));
    byItem.set(l.runItemId, m);
  }
  const people: SidePerson[] = items.map((i) => ({
    code: i.employee.employeeCode,
    days: { workdays: canonicalDecimal(dec(i.paidDays.toString())), lop: canonicalDecimal(dec(i.lopDays.toString())) },
    totals: { gross: canonicalDecimal(dec(i.gross.toString())), deductions: canonicalDecimal(dec(i.deductions.toString())), net: canonicalDecimal(dec(i.netPay.toString())) },
    heads: byItem.get(i.id) ?? {},
  }));
  return { run: { id: run.id, label: run.cycleLabel, cycleStart: run.cycleStart.toISOString().slice(0, 10), status: run.status, test }, people, labels };
}

function mappingFrom(statement: Statement, portalHeads: Array<{ code: string; label: string }>, chosen: HeadMapping | undefined): HeadMapping {
  const auto = autoMapping(statement.headColumns, portalHeads);
  const known = new Set(portalHeads.map((p) => p.code));
  for (const [h, v] of Object.entries(chosen ?? {})) {
    if (!statement.headColumns.includes(h)) throw new HttpError(400, `"${h}" is not a column of this statement.`, "VALIDATION_ERROR");
    if (v !== null && !known.has(v)) throw new HttpError(400, `"${v}" is not a pay head of this run.`, "VALIDATION_ERROR");
    auto[h] = v;
  }
  return auto;
}

function compute(statement: Statement, side: Awaited<ReturnType<typeof portalSide>>, mapping: HeadMapping, allowance: string): CompareResult {
  const greythr: SidePerson[] = statement.people.map((p) => ({ code: p.code, days: { workdays: p.days.workdays, lop: p.days.lop }, totals: p.totals, heads: p.heads }));
  return compareStatements(greythr, side.people, mapping, side.labels, allowance);
}

const view = (id: string, s: Saved, createdAt: Date) => ({ id, createdAt: createdAt.toISOString(), fileName: s.fileName, run: s.run, mapping: s.mapping, portalHeads: s.portalHeads, statement: { title: s.statement.title, headColumns: s.statement.headColumns, notCompared: s.statement.notCompared, people: s.statement.people.length }, result: s.result });

export async function compareUpload(file: { buffer: Buffer; originalname: string }, raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "use the parallel-run kit");
  const input = compareSchema.safeParse(raw);
  if (!input.success) throw new HttpError(400, input.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  let chosen: HeadMapping | undefined;
  if (input.data.mapping) {
    const m = recompareSchema.shape.mapping.safeParse(JSON.parse(input.data.mapping));
    if (!m.success) throw new HttpError(400, "The head mapping is not valid.", "VALIDATION_ERROR");
    chosen = m.data;
  }
  const statement = await readStatement(file.buffer, file.originalname);
  const side = await portalSide(input.data.runId);
  const portalHeads = Object.entries(side.labels).map(([code, label]) => ({ code, label })).sort((a, b) => a.label.localeCompare(b.label));
  const mapping = mappingFrom(statement, portalHeads, chosen);
  const allowance = (await behaviourValue("payroll.parallelTolerance")).value.allowance;
  const result = compute(statement, side, mapping, allowance);
  const saved: Saved = { statement, fileName: file.originalname.slice(0, 200), run: side.run, mapping, portalHeads, result };
  const row = await prisma.payrollParallelComparison.create({ data: { cycleStart: new Date(`${side.run.cycleStart}T00:00:00Z`), runId: side.run.id, fileName: saved.fileName, resultEncrypted: seal(saved), counts: result.counts, createdByUserId: actor.userId } });
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.parallel.compared", entityType: "PayrollParallelComparison", entityId: row.id, after: { cycle: side.run.label, runId: side.run.id, counts: result.counts } });
  return view(row.id, saved, row.createdAt);
}

async function load(id: string) {
  const row = await prisma.payrollParallelComparison.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, "That comparison was not found (it may have been deleted).", "NOT_FOUND");
  return { row, saved: open(row.resultEncrypted) };
}

export async function recompare(id: string, raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "use the parallel-run kit");
  const input = recompareSchema.safeParse(raw);
  if (!input.success) throw new HttpError(400, input.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const { row, saved } = await load(id);
  const side = await portalSide(saved.run.id);
  const portalHeads = Object.entries(side.labels).map(([code, label]) => ({ code, label })).sort((a, b) => a.label.localeCompare(b.label));
  const mapping = mappingFrom(saved.statement, portalHeads, input.data.mapping);
  const allowance = (await behaviourValue("payroll.parallelTolerance")).value.allowance;
  const next: Saved = { ...saved, run: side.run, mapping, portalHeads, result: compute(saved.statement, side, mapping, allowance) };
  await prisma.payrollParallelComparison.update({ where: { id }, data: { resultEncrypted: seal(next), counts: next.result.counts } });
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.parallel.recompared", entityType: "PayrollParallelComparison", entityId: id, after: { cycle: side.run.label, counts: next.result.counts } });
  return view(id, next, row.createdAt);
}

/** Saved comparisons, newest first; ones older than the retention a director set are deleted first (Not set: kept until a director deletes them). */
export async function listComparisons(actor: Actor) {
  await requireDirector(actor.userId, "use the parallel-run kit");
  const days = (await behaviourValue("payroll.parallelRetentionDays")).value;
  if (days) {
    const before = new Date(Date.now() - days * 86_400_000); // allow-clock: retention age
    const old = await prisma.payrollParallelComparison.findMany({ where: { createdAt: { lt: before } }, select: { id: true } });
    if (old.length) {
      await prisma.payrollParallelComparison.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
      await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.parallel.expired", entityType: "PayrollParallelComparison", entityId: "retention", after: { deleted: old.length, retentionDays: days } });
    }
  }
  const rows = await prisma.payrollParallelComparison.findMany({ orderBy: { createdAt: "desc" }, take: 100, select: { id: true, cycleStart: true, runId: true, fileName: true, counts: true, createdAt: true, createdByUserId: true } });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdByUserId))] } }, select: { id: true, employee: { select: { employeeCode: true } } } });
  const who = new Map(users.map((u) => [u.id, u.employee.employeeCode]));
  const tolerance = await behaviourValue("payroll.parallelTolerance");
  return {
    tolerance: { allowance: tolerance.value.allowance, isDefault: tolerance.isDefault },
    retentionDays: days,
    comparisons: rows.map((r) => ({ id: r.id, month: r.cycleStart.toISOString().slice(0, 7), runId: r.runId, fileName: r.fileName, counts: r.counts, createdAt: r.createdAt.toISOString(), by: who.get(r.createdByUserId) ?? "A director" })),
  };
}

export async function getComparison(id: string, actor: Actor) {
  await requireDirector(actor.userId, "use the parallel-run kit");
  const { row, saved } = await load(id);
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.parallel.viewed", entityType: "PayrollParallelComparison", entityId: id, after: { cycle: saved.run.label } });
  return view(id, saved, row.createdAt);
}

export async function deleteComparison(id: string, actor: Actor) {
  await requireDirector(actor.userId, "delete a comparison");
  const { saved } = await load(id);
  await prisma.payrollParallelComparison.delete({ where: { id } });
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.parallel.deleted", entityType: "PayrollParallelComparison", entityId: id, after: { cycle: saved.run.label } });
}

const DIFF_COLUMNS = [
  { key: "code", header: "Employee number", type: "text" },
  { key: "side", header: "In", type: "text" },
  { key: "item", header: "Item", type: "text" },
  { key: "greythr", header: "greytHR", type: "money" },
  { key: "portal", header: "Portal", type: "money" },
  { key: "difference", header: "Difference (portal minus greytHR)", type: "money" },
  { key: "higher", header: "Higher", type: "text" },
  { key: "hint", header: "Likely cause (only where certain)", type: "text" },
] as const;

/** Every difference (not the matches), as .xlsx (with the totals) or .csv. The export is audited without a figure. */
export async function exportComparison(id: string, format: "xlsx" | "csv", actor: Actor): Promise<{ buffer: Buffer; contentType: string; fileName: string }> {
  await requireDirector(actor.userId, "export a comparison");
  const { saved } = await load(id);
  const sideText = { BOTH: "Both", GREYTHR_ONLY: "greytHR only", PORTAL_ONLY: "Portal only" } as const;
  const rows = saved.result.people.flatMap((p) =>
    p.lines.filter((l) => !l.matched).map((l) => ({ code: p.code, side: sideText[p.side], item: l.item, greythr: l.greythr, portal: l.portal, difference: l.difference, higher: l.higher === "PORTAL" ? "Portal" : l.higher === "GREYTHR" ? "greytHR" : "", hint: l.hint ?? p.hint ?? "" })),
  );
  const stamp = saved.run.cycleStart.slice(0, 7);
  const preamble = [`Parallel run: greytHR statement against the portal's run for ${saved.run.label}`, `Allowance: ${saved.result.allowance}`];
  const buffer =
    format === "csv"
      ? Buffer.from(csvOf(DIFF_COLUMNS.map((c) => ({ ...c })), rows, preamble), "utf8")
      : await buildXlsx([
          { name: "Differences", columns: DIFF_COLUMNS.map((c) => ({ key: c.key, header: c.header, type: c.type })), rows, footer: preamble },
          { name: "Totals", columns: [{ key: "item", header: "Item", type: "text" }, { key: "greythr", header: "greytHR", type: "money" }, { key: "portal", header: "Portal", type: "money" }, { key: "difference", header: "Difference", type: "money" }], rows: saved.result.totals.map((t) => ({ ...t })), footer: [`Overall net difference: ${saved.result.overallNetDifference}`] },
        ]);
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.parallel.exported", entityType: "PayrollParallelComparison", entityId: id, after: { cycle: saved.run.label, format, rows: rows.length } });
  return { buffer, contentType: format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fileName: `parallel-run-${stamp}.${format}` };
}
