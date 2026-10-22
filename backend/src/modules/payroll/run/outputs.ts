import { createHash } from "node:crypto";
import type { PayrollOutputKind, PayrollRun } from "@prisma/client";
import { writeAuditLog, writeAuditLogs } from "../../../lib/audit";
import { namesOn } from "../../../lib/effectiveDating";
import { decryptField } from "../../../lib/encryption";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { storageService } from "../../../integrations/storage";
import { recordEvent } from "../events";
import { canonicalDecimal, dec, ZERO } from "../money";
import { buildRunWorkbook } from "./export";
import { renderLayout, type LayoutKind, type LayoutRow } from "./layout";
import { currentLayout, layoutReady } from "./layouts";

// The statutory files and the register, made from a FINAL run (docs/plans/PHASE_6.md §10, §14H). The four statutory files (PF, ESI, PT, LWF) come from a layout that has
// been confirmed against what the portal or the state accepts; none exists until you give it, and nothing here guesses one. The register is our own report and needs none.
// Identifiers a file needs (a UAN) are read from the encrypted store only while the file is written, one audit row for each. A person who is in a file but lacks the
// identifier it needs stops the file, named, rather than being written with a blank.

const SIGNED_SECONDS = 300;
type Actor = { userId: string; ip?: string | null };

export const OUTPUT_KINDS: readonly PayrollOutputKind[] = ["PF_ECR", "ESI", "PT", "LWF", "SALARY_REGISTER"];
const LAYOUT_OF: Record<Exclude<PayrollOutputKind, "SALARY_REGISTER">, LayoutKind> = { PF_ECR: "PF_ECR", ESI: "ESI", PT: "PT", LWF: "LWF" };

type Item = Awaited<ReturnType<typeof loadItems>>[number];
async function loadItems(runId: string) {
  return prisma.payrollRunItem.findMany({ where: { runId, status: { in: ["PAYABLE", "HELD"] } }, include: { lines: true, employee: { select: { employeeCode: true, statutory: { select: { uanEncrypted: true, esiNumber: true } } } } }, orderBy: { employee: { employeeCode: "asc" } } });
}

const amountOf = (item: Item, code: string): string => canonicalDecimal(item.lines.filter((l) => l.code === code).reduce((a, l) => a.plus(dec(l.amount.toString())), ZERO));
const has = (item: Item, code: string): boolean => item.lines.some((l) => l.code === code);
const basisOf = (item: Item, code: string, key: string): string => {
  const line = item.lines.find((l) => l.code === code);
  const v = line ? (line.basis as Record<string, unknown>)[key] : undefined;
  return typeof v === "string" ? v : "0";
};

interface Built {
  rows: LayoutRow[];
  /** Whose identifier was read from the encrypted store, for the audit. */
  revealed: string[];
}

function build(kind: Exclude<PayrollOutputKind, "SALARY_REGISTER">, items: Item[], names: Map<string, string>): Built {
  const rows: LayoutRow[] = [];
  const revealed: string[] = [];
  const missing: string[] = [];
  const nameOf = (i: Item) => names.get(i.employeeId) ?? i.employee.employeeCode;
  for (const i of items) {
    if (kind === "PF_ECR") {
      if (!has(i, "PF_EMPLOYEE") && !has(i, "PF_EPS") && !has(i, "PF_EPF_ER")) continue;
      const enc = i.employee.statutory?.uanEncrypted;
      if (!enc) {
        missing.push(`${nameOf(i)} (${i.employee.employeeCode}): no UAN`);
        continue;
      }
      revealed.push(i.employeeId);
      const base = has(i, "PF_EMPLOYEE") ? "PF_EMPLOYEE" : has(i, "PF_EPS") ? "PF_EPS" : "PF_EPF_ER";
      rows.push({ UAN: decryptField(enc), NAME: nameOf(i), EMPLOYEE_CODE: i.employee.employeeCode, GROSS_WAGES: canonicalDecimal(dec(i.gross.toString())), EPF_WAGES: basisOf(i, base, "wages"), EPS_WAGES: basisOf(i, base, "cappedWages"), EDLI_WAGES: basisOf(i, base, "cappedWages"), EPF_CONTRIBUTION: amountOf(i, "PF_EMPLOYEE"), EPS_CONTRIBUTION: amountOf(i, "PF_EPS"), EPF_EPS_DIFF: amountOf(i, "PF_EPF_ER"), NCP_DAYS: canonicalDecimal(dec(i.lopDays.toString())), REFUND: "0" });
    } else if (kind === "ESI") {
      if (!has(i, "ESI_EMPLOYEE") && !has(i, "ESI_EMPLOYER")) continue;
      const esi = i.employee.statutory?.esiNumber;
      if (!esi) {
        missing.push(`${nameOf(i)} (${i.employee.employeeCode}): no ESI number`);
        continue;
      }
      rows.push({ ESI_NUMBER: esi, NAME: nameOf(i), EMPLOYEE_CODE: i.employee.employeeCode, DAYS_PAID: canonicalDecimal(dec(i.paidDays.toString()).toDecimalPlaces(2)), ESI_WAGES: basisOf(i, has(i, "ESI_EMPLOYEE") ? "ESI_EMPLOYEE" : "ESI_EMPLOYER", "wages"), EMPLOYEE_CONTRIBUTION: amountOf(i, "ESI_EMPLOYEE"), EMPLOYER_CONTRIBUTION: amountOf(i, "ESI_EMPLOYER") });
    } else if (kind === "PT") {
      if (!has(i, "PT")) continue;
      rows.push({ EMPLOYEE_CODE: i.employee.employeeCode, NAME: nameOf(i), STATE: basisOf(i, "PT", "state"), PT_AMOUNT: amountOf(i, "PT") });
    } else {
      if (!has(i, "LWF_EMPLOYEE") && !has(i, "LWF_EMPLOYER")) continue;
      rows.push({ EMPLOYEE_CODE: i.employee.employeeCode, NAME: nameOf(i), STATE: basisOf(i, has(i, "LWF_EMPLOYEE") ? "LWF_EMPLOYEE" : "LWF_EMPLOYER", "state"), LWF_EMPLOYEE: amountOf(i, "LWF_EMPLOYEE"), LWF_EMPLOYER: amountOf(i, "LWF_EMPLOYER") });
    }
  }
  if (missing.length > 0) throw new HttpError(409, `${missing.length} ${missing.length === 1 ? "person is" : "people are"} in this file but ${missing.length === 1 ? "lacks" : "lack"} what it needs, so it was not made: ${missing.slice(0, 8).join("; ")}${missing.length > 8 ? "; and more" : ""}. Put that right (Employee profile) and generate it again.`, "MISSING_IDENTIFIERS", { people: missing });
  return { rows, revealed };
}

export async function generateOutput(runId: string, kind: PayrollOutputKind, actor: Actor) {
  const run: PayrollRun | null = await prisma.payrollRun.findUnique({ where: { id: runId } });
  if (!run) throw new HttpError(404, "No such payroll run.", "NOT_FOUND");
  if (run.status !== "FINALISED") throw new HttpError(409, "Statutory files and the register come only from a final run.", "RUN_STATE");
  let bytes: Buffer;
  let contentType: string;
  let fileName: string;
  let rowCount: number;
  let template: { version: number; valueHash: string } | null = null;
  let revealed: string[] = [];
  const cycle = run.cycleLabel.replace(/[^A-Za-z0-9]+/g, "-");
  if (kind === "SALARY_REGISTER") {
    const wb = await buildRunWorkbook(runId);
    bytes = wb.buffer;
    contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    fileName = `salary-register-${cycle}.xlsx`;
    rowCount = run.payableCount + run.heldCount;
  } else {
    const ready = await layoutReady(kind);
    if (!ready.ready) throw new HttpError(409, ready.status === "NOT_SET" ? "The layout for this file has not been entered yet. It comes from the layout the portal or your state currently accepts; once entered, a second person must confirm it." : "The layout for this file has been entered but not confirmed by a second person yet, so the file cannot be made.", "LAYOUT_NOT_CONFIRMED");
    const stored = await currentLayout(kind);
    const items = await loadItems(runId);
    const names = await namesOn(items.map((i) => i.employeeId), run.cycleEnd);
    const built = build(kind, items, names);
    if (built.rows.length === 0) throw new HttpError(409, "Nobody in this run belongs in this file, so there is nothing to write.", "NOTHING_TO_WRITE");
    const total = canonicalDecimal(built.rows.reduce((a, r) => a.plus(dec(r.EPF_CONTRIBUTION ?? r.EMPLOYEE_CONTRIBUTION ?? r.PT_AMOUNT ?? r.LWF_EMPLOYEE ?? "0")), ZERO));
    const file = await renderLayout(LAYOUT_OF[kind], stored!.value, built.rows, { count: built.rows.length, total, period: run.cycleLabel });
    bytes = file.bytes;
    contentType = file.contentType;
    fileName = `${kind.toLowerCase()}-${cycle}.${file.extension}`;
    rowCount = built.rows.length;
    template = { version: stored!.version, valueHash: stored!.valueHash };
    revealed = built.revealed;
  }
  const sha = createHash("sha256").update(bytes).digest("hex");
  const fileKey = `payroll/outputs/${runId}/${kind.toLowerCase()}-${sha.slice(0, 16)}-${fileName}`;
  await storageService.putObject(fileKey, bytes, contentType);
  const out = await prisma.$transaction(async (tx) => {
    const created = await tx.payrollOutput.create({ data: { runId, kind, runHash: run.runHash ?? "", templateVersion: template?.version ?? null, templateHash: template?.valueHash ?? null, rowCount, fileKey, fileName, fileSha256: sha, generatedByUserId: actor.userId } });
    await writeAuditLogs(revealed.map((employeeId) => ({ actorUserId: actor.userId, action: "payroll.output.identifier_read", entityType: "Employee", entityId: employeeId, after: { runId, outputId: created.id, kind }, ipAddress: actor.ip ?? null })), tx);
    await recordEvent({ subjectType: "PAYROLL_RUN", subjectId: runId, type: "OUTPUT_GENERATED", actorUserId: actor.userId, payload: { kind, outputId: created.id, sha256: sha, rows: rowCount } }, tx);
    return created;
  });
  await writeAuditLog({ actorUserId: actor.userId, action: "payroll.output.generated", entityType: "PayrollRun", entityId: runId, after: { cycle: run.cycleLabel, kind, outputId: out.id, rows: rowCount, sha256: sha }, ipAddress: actor.ip ?? null });
  return outputView(out);
}

const outputView = (o: { id: string; kind: PayrollOutputKind; rowCount: number; fileName: string; fileSha256: string; generatedAt: Date; templateVersion: number | null }) => ({ id: o.id, kind: o.kind, rows: o.rowCount, fileName: o.fileName, sha256: o.fileSha256, generatedAt: o.generatedAt.toISOString(), templateVersion: o.templateVersion });

export async function listOutputs(runId: string) {
  const rows = await prisma.payrollOutput.findMany({ where: { runId }, orderBy: { generatedAt: "desc" } });
  const readiness = await Promise.all((["PF_ECR", "ESI", "PT", "LWF"] as const).map(async (k) => ({ kind: k, ...(await layoutReady(k)) })));
  return { outputs: rows.map(outputView), layouts: readiness.map((r) => ({ kind: r.kind, ready: r.ready, status: r.status })) };
}

export async function downloadOutput(id: string, actor: Actor) {
  const o = await prisma.payrollOutput.findUnique({ where: { id } });
  if (!o) throw new HttpError(404, "There is no such file.", "NOT_FOUND");
  const url = await storageService.getObjectSignedUrl(o.fileKey, SIGNED_SECONDS, { downloadFileName: o.fileName });
  await writeAuditLog({ actorUserId: actor.userId, action: "payroll.output.downloaded", entityType: "PayrollOutput", entityId: id, after: { kind: o.kind, sha256: o.fileSha256 }, ipAddress: actor.ip ?? null });
  return { url, expiresInSeconds: SIGNED_SECONDS, fileName: o.fileName, sha256: o.fileSha256 };
}
