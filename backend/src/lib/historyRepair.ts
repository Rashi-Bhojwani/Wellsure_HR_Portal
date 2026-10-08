import { createHash } from "node:crypto";
import { writeAuditLog } from "./audit";
import { businessToday } from "./businessDate";
import { prisma } from "./prisma";

// History repair (EF1, docs/plans/EFFECTIVE_DATES.md). Finds history rows
// that don't fit the one effective-dating model and — ONLY after a person
// has seen the exact list and approved it — fixes the ones that have a
// single correct answer (user, 2026-10-03: "tell me exactly what it changed
// before it changes it … let me approve, then apply").
//
//   preview  → every row it would fix, with the current value, the new
//              value and why, plus a fingerprint of that exact list. Also
//              every row it WON'T touch because a person has to decide.
//   apply    → refuses unless the fingerprint matches the plan computed
//              right now (so nothing changed between preview and approval),
//              then applies it in one transaction with one audit-log entry
//              per row naming who approved it.
//
// Raw SQL on purpose: it must work on a database before and after the
// effective-dating migration.

export type RepairTable = "employee_job_history" | "employee_name_history" | "employee_bank_accounts" | "device_user_mappings";

export interface RepairFix {
  table: RepairTable;
  rowId: string;
  employeeCode: string;
  column: "effective_to" | "valid_to" | "effective_from";
  rowFrom: string; // the row's start date, for the reader
  current: string | null; // the column's current value (null = still open)
  proposed: string;
  reason: string;
}

export interface RepairManual {
  table: "employee_job_history" | "employee_name_history" | "employee_bank_accounts" | "device_user_mappings";
  rowIds: string[];
  employeeCode: string;
  reason: string;
}

export interface RepairPlan {
  fixes: RepairFix[];
  manual: RepairManual[];
  fingerprint: string;
}

const d = (v: Date | null) => (v ? v.toISOString().slice(0, 10) : null);

interface LatestRow {
  id: string;
  employee_code: string;
  device_user_id?: string;
  last_working_date: Date;
  row_from: Date;
  row_to: Date | null;
}

export async function planHistoryRepair(): Promise<RepairPlan> {
  const fixes: RepairFix[] = [];
  const manual: RepairManual[] = [];

  // 1. Leavers. History must end the day after the last working day. Rows
  //    still open, or ending on the last day itself (the old convention),
  //    have one correct answer; anything else needs a person.
  const jobs = await prisma.$queryRaw<LatestRow[]>`
    SELECT DISTINCT ON (j.employee_id) j.id, e.employee_code, e.last_working_date, j.effective_from AS row_from, j.effective_to AS row_to
    FROM employee_job_history j JOIN employees e ON e.id = j.employee_id
    WHERE e.status = 'SEPARATED' AND e.last_working_date IS NOT NULL
    ORDER BY j.employee_id, j.effective_from DESC`;
  for (const r of jobs) leaverRow("employee_job_history", "effective_to", r, fixes, manual);

  const maps = await prisma.$queryRaw<LatestRow[]>`
    SELECT DISTINCT ON (m.employee_id) m.id, e.employee_code, m.device_user_id, e.last_working_date, m.valid_from AS row_from, m.valid_to AS row_to
    FROM device_user_mappings m JOIN employees e ON e.id = m.employee_id
    WHERE e.status = 'SEPARATED' AND e.last_working_date IS NOT NULL
    ORDER BY m.employee_id, m.valid_from DESC`;
  for (const r of maps) {
    const before = fixes.length;
    leaverRow("device_user_mappings", "valid_to", r, fixes, manual);
    const fix = fixes.length > before ? fixes.at(-1)! : null;
    if (!fix) continue;
    // Extending to the day after could collide with the device ID's next
    // holder — then a person decides.
    const clash = await prisma.$queryRaw<{ employee_code: string }[]>`
      SELECT e.employee_code FROM device_user_mappings m JOIN employees e ON e.id = m.employee_id
      WHERE m.device_user_id = ${r.device_user_id} AND m.id <> ${r.id} AND m.valid_from < ${fix.proposed}::date
        AND (m.valid_to IS NULL OR m.valid_to > ${r.row_from})`;
    if (clash.length) {
      fixes.pop();
      manual.push({ table: "device_user_mappings", rowIds: [r.id], employeeCode: r.employee_code, reason: `Device ID ${r.device_user_id} is already mapped to ${clash.map((c) => c.employee_code).join(", ")} from before ${fix.proposed}; extending this leaver's mapping to their last working day would overlap.` });
    }
  }

  // 2. Pre-joiners added before EF2: their first name/placement/bank row
  //    starts on a future date of joining, so nothing is in force today
  //    (unnamed, in no team). New pre-joiners start on the day they're added
  //    (firstHistoryDay) — move the first row's start to that day.
  for (const t of ["employee_name_history", "employee_job_history", "employee_bank_accounts"] as const) {
    const firsts = await prisma.$queryRawUnsafe<{ id: string; employee_code: string; f: Date; added: Date }[]>(
      `SELECT DISTINCT ON (h.employee_id) h.id, e.employee_code, h.effective_from AS f, (e.created_at AT TIME ZONE 'Asia/Kolkata')::date AS added
         FROM ${t} h JOIN employees e ON e.id = h.employee_id
        ORDER BY h.employee_id, h.effective_from ASC`,
    );
    const today = businessToday();
    for (const r of firsts) {
      if (r.f <= today || r.added >= r.f) continue;
      const what = t === "employee_name_history" ? "name" : t === "employee_job_history" ? "job placement" : "bank account";
      fixes.push({ table: t, rowId: r.id, employeeCode: r.employee_code, column: "effective_from", rowFrom: d(r.f)!, current: d(r.f), proposed: d(r.added)!, reason: `A pre-joiner: their first ${what} starts on their joining date (${d(r.f)}), so they have none today — start it on the day they were added (${d(r.added)}).` });
    }
  }

  // 3. Inverted or empty rows, and overlapping rows, in every history table.
  for (const t of ["employee_job_history", "employee_name_history", "employee_bank_accounts"] as const) {
    const inverted = await prisma.$queryRawUnsafe<{ id: string; employee_code: string; f: Date; t: Date }[]>(
      `SELECT h.id, e.employee_code, h.effective_from AS f, h.effective_to AS t FROM ${t} h JOIN employees e ON e.id = h.employee_id WHERE h.effective_to IS NOT NULL AND h.effective_to <= h.effective_from`,
    );
    for (const r of inverted) manual.push({ table: t, rowIds: [r.id], employeeCode: r.employee_code, reason: `Ends (${d(r.t)}) on or before it starts (${d(r.f)}).` });
    const overlaps = await prisma.$queryRawUnsafe<{ a: string; b: string; employee_code: string }[]>(
      `SELECT a.id AS a, b.id AS b, e.employee_code FROM ${t} a JOIN ${t} b ON a.employee_id = b.employee_id AND a.id < b.id
         JOIN employees e ON e.id = a.employee_id
       WHERE a.effective_from < COALESCE(b.effective_to, 'infinity'::date) AND b.effective_from < COALESCE(a.effective_to, 'infinity'::date)
         AND (a.effective_to IS NULL OR a.effective_to > a.effective_from) AND (b.effective_to IS NULL OR b.effective_to > b.effective_from)`,
    );
    for (const r of overlaps) manual.push({ table: t, rowIds: [r.a, r.b], employeeCode: r.employee_code, reason: "Two rows cover the same days." });
  }
  const mapInverted = await prisma.$queryRaw<{ id: string; employee_code: string }[]>`
    SELECT m.id, e.employee_code FROM device_user_mappings m JOIN employees e ON e.id = m.employee_id WHERE m.valid_to IS NOT NULL AND m.valid_to <= m.valid_from`;
  for (const r of mapInverted) manual.push({ table: "device_user_mappings", rowIds: [r.id], employeeCode: r.employee_code, reason: "Mapping ends on or before it starts." });
  const mapOverlaps = await prisma.$queryRaw<{ a: string; b: string; employee_code: string; device_user_id: string }[]>`
    SELECT a.id AS a, b.id AS b, e.employee_code, a.device_user_id FROM device_user_mappings a
      JOIN device_user_mappings b ON a.id < b.id AND (a.device_user_id = b.device_user_id OR a.employee_id = b.employee_id)
      JOIN employees e ON e.id = a.employee_id
    WHERE a.valid_from < COALESCE(b.valid_to, 'infinity'::date) AND b.valid_from < COALESCE(a.valid_to, 'infinity'::date)
      AND (a.valid_to IS NULL OR a.valid_to > a.valid_from) AND (b.valid_to IS NULL OR b.valid_to > b.valid_from)`;
  for (const r of mapOverlaps) manual.push({ table: "device_user_mappings", rowIds: [r.a, r.b], employeeCode: r.employee_code, reason: `Two device mappings overlap (device ID ${r.device_user_id}).` });

  fixes.sort((a, b) => (a.table + a.rowId).localeCompare(b.table + b.rowId));
  return { fixes, manual, fingerprint: fingerprintOf(fixes) };
}

function leaverRow(table: RepairTable, column: RepairFix["column"], r: LatestRow, fixes: RepairFix[], manual: RepairManual[]) {
  const lwd = r.last_working_date;
  const end = new Date(Date.UTC(lwd.getUTCFullYear(), lwd.getUTCMonth(), lwd.getUTCDate() + 1));
  const what = table === "employee_job_history" ? "job placement" : `device mapping (ID ${r.device_user_id})`;
  if (r.row_to && r.row_to.getTime() === end.getTime()) return; // already right
  if (r.row_from > lwd) {
    manual.push({ table, rowIds: [r.id], employeeCode: r.employee_code, reason: `Their latest ${what} starts ${d(r.row_from)}, after their last working day (${d(lwd)}).` });
    return;
  }
  if (r.row_to === null) {
    fixes.push({ table, rowId: r.id, employeeCode: r.employee_code, column, rowFrom: d(r.row_from)!, current: null, proposed: d(end)!, reason: `Left on ${d(lwd)} but their ${what} is still open — close it after their last working day.` });
    return;
  }
  if (r.row_to.getTime() === lwd.getTime()) {
    fixes.push({ table, rowId: r.id, employeeCode: r.employee_code, column, rowFrom: d(r.row_from)!, current: d(r.row_to), proposed: d(end)!, reason: `Their ${what} ends ON their last working day (${d(lwd)}), so they have none that day — end it the day after.` });
    return;
  }
  manual.push({ table, rowIds: [r.id], employeeCode: r.employee_code, reason: `Their ${what} ends ${d(r.row_to)}, which doesn't match their last working day (${d(lwd)}).` });
}

function fingerprintOf(fixes: RepairFix[]): string {
  const canonical = fixes.map((f) => [f.table, f.rowId, f.column, f.current ?? "open", f.proposed].join("|")).join("\n");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

export class RepairRefused extends Error {}

export async function applyHistoryRepair(input: { fingerprint: string; approvedBy: string; operator: string }): Promise<{ applied: number }> {
  if (input.approvedBy.trim().length < 2) throw new RepairRefused("--approved-by is required: who looked at the preview and approved it.");
  if (input.operator.trim().length < 2) throw new RepairRefused("--operator is required: who is running this.");
  const plan = await planHistoryRepair();
  if (plan.fixes.length === 0) return { applied: 0 };
  if (plan.fingerprint !== input.fingerprint) {
    throw new RepairRefused(`The rows to fix have changed since that preview (approved ${input.fingerprint}, now ${plan.fingerprint}). Run the preview again and get it re-approved.`);
  }
  await prisma.$transaction(async (tx) => {
    for (const f of plan.fixes) {
      // Guarded on the previewed value: if the row moved underneath us, abort the lot.
      // Table and column come from the fixed unions above, never from input.
      const n = await tx.$executeRawUnsafe(
        `UPDATE ${f.table} SET ${f.column} = $1::date WHERE id = $2 AND ${f.column} IS NOT DISTINCT FROM $3::date`,
        f.proposed,
        f.rowId,
        f.current,
      );
      if (n !== 1) throw new RepairRefused(`Row ${f.table}/${f.rowId} changed while repairing — nothing was applied. Run the preview again.`);
    }
  });
  for (const f of plan.fixes) {
    await writeAuditLog({
      actorUserId: null,
      action: "history.repaired",
      entityType: f.table,
      entityId: f.rowId,
      before: { [f.column]: f.current },
      after: { [f.column]: f.proposed, reason: f.reason, employeeCode: f.employeeCode, approvedBy: input.approvedBy, operator: input.operator, fingerprint: plan.fingerprint },
    });
  }
  return { applied: plan.fixes.length };
}
