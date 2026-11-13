import { createHash } from "node:crypto";
import { z } from "zod";
import { ITEM_CODE_PATTERN } from "@shared/constants/payrollSalary";
import { writeAuditLog } from "../../../lib/audit";
import { requireDirector } from "../../../lib/directorAuthority";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { normaliseHeader, parseDateText, readTable } from "../inputs/importParse";
import { canonicalDecimal, dec } from "../money";
import { createRevision, previewRevision } from "./revisions";
import { loadStructureVersion } from "./structures";

// IE-09 (docs/plans/A_PARITY_ROWS.md): salary assignment import in OUR template (not greytHR's file: IE-12 is not built). Each row says who, which structure version,
// the annual CTC and from when. The file is previewed row by row; committing the same file creates ordinary salary revisions — the only path that writes a salary
// row — grouped by structure, CTC and date, each waiting for a different director exactly as a revision typed on the screen. The import itself writes no salary.

type Actor = { userId: string; ip?: string | null };
export const TEMPLATE_COLUMNS = ["Employee Number", "Structure", "Structure Version", "Annual CTC", "Effective From"] as const;
const MAX_ROWS = 500; // allow-number: rows in one file (a revision covers at most 1000 people)
const MONEY = /^\d+(\.\d{1,2})?$/;

export function templateCsv(): string {
  return `${TEMPLATE_COLUMNS.join(",")}\n`;
}

interface Planned { employeeId: string; structureKey: string; structureVersion: number; annualCtc: string; effectiveFrom: string }
export interface AssignmentPreview {
  fileName: string;
  fingerprint: string;
  valid: number;
  rows: Array<{ line: number; employeeCode: string; structure: string; version: string; annualCtc: string; effectiveFrom: string; problem: string | null }>;
  groups: Array<{ structureKey: string; structureVersion: number; annualCtc: string; effectiveFrom: string; people: number; blockers: string[] }>;
}

/** Groups of people who get the same structure version, CTC and date: one revision each. Pure; exported for the test. */
export function groupsOf(planned: readonly Planned[]): Array<Omit<Planned, "employeeId"> & { employeeIds: string[] }> {
  const m = new Map<string, Omit<Planned, "employeeId"> & { employeeIds: string[] }>();
  for (const p of planned) {
    const k = `${p.structureKey}|${p.structureVersion}|${p.annualCtc}|${p.effectiveFrom}`;
    const g = m.get(k) ?? { structureKey: p.structureKey, structureVersion: p.structureVersion, annualCtc: p.annualCtc, effectiveFrom: p.effectiveFrom, employeeIds: [] };
    g.employeeIds.push(p.employeeId);
    m.set(k, g);
  }
  return [...m.values()].map((g) => ({ ...g, employeeIds: [...g.employeeIds].sort() })).sort((a, b) => `${a.effectiveFrom}${a.structureKey}${a.annualCtc}`.localeCompare(`${b.effectiveFrom}${b.structureKey}${b.annualCtc}`));
}

const inputOf = (g: ReturnType<typeof groupsOf>[number], note: string) => ({ selection: { kind: "EMPLOYEES" as const, employeeIds: g.employeeIds }, change: { ctc: { mode: "SET" as const, annual: g.annualCtc }, structure: { key: g.structureKey, version: g.structureVersion } }, effectiveFrom: g.effectiveFrom, reason: "REVISION" as const, note });

async function analyse(file: { buffer: Buffer; originalname: string }, actor: Actor) {
  const table = await readTable(file.buffer, file.originalname);
  const cols = TEMPLATE_COLUMNS.map((name) => table.headers.findIndex((h) => normaliseHeader(h) === normaliseHeader(name)));
  const missing = TEMPLATE_COLUMNS.filter((_, i) => cols[i] === -1);
  if (missing.length) throw new HttpError(400, `The file has no column called ${missing.map((c) => `"${c}"`).join(", ")}. Download the template.`, "INVALID_FILE");
  if (table.rows.length === 0) throw new HttpError(400, "The file has no rows.", "INVALID_FILE");
  if (table.rows.length > MAX_ROWS) throw new HttpError(400, `At most ${MAX_ROWS} rows in one file.`, "INVALID_FILE");
  const cells = table.rows.map((r) => ({ line: r.line, v: cols.map((c) => (r.cells[c] ?? "").trim()) as [string, string, string, string, string] }));
  const emps = new Map((await prisma.employee.findMany({ where: { employeeCode: { in: [...new Set(cells.map((c) => c.v[0]))] } }, select: { id: true, employeeCode: true, status: true } })).map((e) => [e.employeeCode, e]));
  const structureOk = new Map<string, string | null>();
  const seen = new Set<string>();
  const planned: Planned[] = [];
  const rows: AssignmentPreview["rows"] = [];
  for (const { line, v } of cells) {
    const [code, structure, versionText, ctc, fromText] = v;
    const emp = emps.get(code);
    const version = /^\d{1,4}$/.test(versionText) ? Number(versionText) : NaN; // allow-number: a version number, not money
    const from = parseDateText(fromText);
    let problem: string | null = null;
    if (!emp) problem = `No employee with number "${code}".`;
    else if (emp.status !== "ACTIVE") problem = "This person is not active.";
    else if (!ITEM_CODE_PATTERN.test(structure)) problem = `"${structure}" is not a structure key.`;
    else if (!Number.isInteger(version) || version < 1) problem = `"${versionText}" is not a structure version.`;
    else if (!MONEY.test(ctc) || dec(ctc).isZero()) problem = `"${ctc}" is not an annual CTC (rupees, up to two decimals, no commas).`;
    else if (!from) problem = `"${fromText}" is not a date.`;
    else if (seen.has(emp.id)) problem = "The same person appears twice in this file.";
    if (!problem) {
      const key = `${structure}|${version}`;
      if (!structureOk.has(key)) structureOk.set(key, await loadStructureVersion(structure, version).then(() => null, (err: Error) => err.message));
      problem = structureOk.get(key) ?? null;
    }
    if (!problem && emp && from) {
      seen.add(emp.id);
      planned.push({ employeeId: emp.id, structureKey: structure, structureVersion: version, annualCtc: canonicalDecimal(dec(ctc)), effectiveFrom: from });
    }
    rows.push({ line, employeeCode: code, structure, version: versionText, annualCtc: ctc, effectiveFrom: fromText, problem });
  }
  const fingerprint = createHash("sha256").update(JSON.stringify({ planned, rows: rows.map((r) => [r.line, r.problem]), user: actor.userId })).digest("hex");
  return { fileName: file.originalname, fingerprint, valid: planned.length, rows, planned };
}

/** Every row with its problem; each group as the revision it would become, with what would stop it. */
export async function previewAssignments(file: { buffer: Buffer; originalname: string }, actor: Actor): Promise<AssignmentPreview> {
  await requireDirector(actor.userId, "import salary assignments");
  const a = await analyse(file, actor);
  const groups = [];
  for (const g of groupsOf(a.planned)) {
    const p = await previewRevision(inputOf(g, "Imported"), actor.userId);
    groups.push({ structureKey: g.structureKey, structureVersion: g.structureVersion, annualCtc: g.annualCtc, effectiveFrom: g.effectiveFrom, people: g.employeeIds.length, blockers: p.blockers });
  }
  return { fileName: a.fileName, fingerprint: a.fingerprint, valid: a.valid, rows: a.rows, groups };
}

export const commitSchema = z.object({ fingerprint: z.string().length(64), note: z.string().trim().min(3, "Say what the file is").max(300) }).strict();

/** The same file again with the preview's fingerprint: every row clean and every group submittable, or nothing is created. */
export async function commitAssignments(raw: unknown, file: { buffer: Buffer; originalname: string }, actor: Actor) {
  await requireDirector(actor.userId, "import salary assignments");
  const parsed = commitSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const a = await analyse(file, actor);
  if (a.fingerprint !== parsed.data.fingerprint) throw new HttpError(409, "The file is not the one you previewed. Preview it again.", "PREVIEW_STALE");
  const bad = a.rows.filter((r) => r.problem);
  if (bad.length) throw new HttpError(409, `${bad.length} row(s) have a problem; fix the file and preview it again.`, "ROWS_WITH_PROBLEMS");
  const note = `Imported from ${a.fileName.slice(0, 80)}: ${parsed.data.note}`;
  const previews = [];
  for (const g of groupsOf(a.planned)) {
    const p = await previewRevision(inputOf(g, note), actor.userId);
    if (p.blockers.length) throw new HttpError(409, `A group cannot be submitted: ${p.blockers[0]}`, "REVISION_BLOCKED", { blockers: p.blockers });
    previews.push({ g, fingerprint: p.fingerprint });
  }
  const ids: string[] = [];
  for (const { g, fingerprint } of previews) ids.push((await createRevision(inputOf(g, note), fingerprint, actor)).id);
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.salary.assignments_imported", entityType: "PayrollSalaryRevision", entityId: ids[0] ?? "none", after: { rows: a.valid, revisions: ids.length } }); // never a figure
  return { revisions: ids, people: a.valid };
}
