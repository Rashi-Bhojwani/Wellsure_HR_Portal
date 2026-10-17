import type { XlsxSheet } from "../../../lib/xlsx";
import { namesOn } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { buildPayrollXlsx } from "../exports";
import { dec } from "../money";
import { pinStatuses, watermarkFromStatuses, type RulePin } from "../rules/context";
import { iso } from "./days";
import { computeVariance } from "./variance";

// The run as a workbook (docs/plans/PHASE_6.md §10, the register part): what HR reads before submitting. A run that used any Placeholder carries the TEST banner on every
// sheet, in the red tab and in the sheet names, so a forwarded attachment cannot lose it. A cell here is a rendering of an exact figure that stays in the database.

// allow-number: a workbook cell has to be a number to sum in Excel; the exact decimal stays in the database and in every hash.
const cellNumber = (v: { toString(): string }): number => dec(v.toString()).toNumber(); // allow-number

export async function buildRunWorkbook(runId: string): Promise<{ buffer: Buffer; fileName: string }> {
  const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
  if (!run) throw new HttpError(404, "No such payroll run.", "NOT_FOUND");
  if (run.runHash === null) throw new HttpError(409, "This run has not been calculated yet.", "CONFLICT");
  const statuses = await pinStatuses((run.pins as unknown as RulePin[]) ?? []);
  const watermark = watermarkFromStatuses(statuses);
  const items = await prisma.payrollRunItem.findMany({ where: { runId }, include: { employee: { select: { employeeCode: true } }, lines: { orderBy: { sortOrder: "asc" } } }, orderBy: { employee: { employeeCode: "asc" } } });
  const names = await namesOn(items.map((i) => i.employeeId), run.cycleEnd);
  const nameOf = (i: (typeof items)[number]) => names.get(i.employeeId) ?? i.employee.employeeCode;

  // One column per distinct line, earnings first, then deductions, then employer contributions, in the order they first appear.
  const columns = new Map<string, { label: string; kind: string }>();
  for (const kind of ["EARNING", "DEDUCTION", "EMPLOYER_CONTRIBUTION", "ROUNDING"]) {
    for (const i of items) for (const l of i.lines) if (l.kind === kind && !columns.has(l.code)) columns.set(l.code, { label: kind === "EMPLOYER_CONTRIBUTION" ? `${l.label} (employer)` : l.label, kind });
  }
  const register: XlsxSheet = {
    name: "Register",
    columns: [
      { key: "code", header: "Employee code" },
      { key: "name", header: "Name", width: 28 },
      { key: "status", header: "Status" },
      { key: "paid", header: "Paid days", type: "number" },
      { key: "lop", header: "LOP days", type: "number" },
      ...[...columns].map(([code, c]) => ({ key: `l_${code}`, header: c.label, type: "money" as const, width: 16 })),
      { key: "gross", header: "Gross", type: "money" },
      { key: "deductions", header: "Deductions", type: "money" },
      { key: "net", header: "Net pay", type: "money" },
    ],
    rows: items
      .filter((i) => i.status !== "EXCLUDED")
      .map((i) => ({
        code: i.employee.employeeCode,
        name: nameOf(i),
        status: i.status === "HELD" ? `Held: ${i.holdDetail ?? ""}` : "Payable",
        paid: cellNumber(i.paidDays),
        lop: cellNumber(i.lopDays),
        ...Object.fromEntries([...columns.keys()].map((code) => [`l_${code}`, cellNumber(i.lines.filter((l) => l.code === code).reduce((a, l) => a.plus(dec(l.amount.toString())), dec("0")))])),
        gross: cellNumber(i.gross),
        deductions: cellNumber(i.deductions),
        net: cellNumber(i.netPay),
      })),
    totals: { name: "Total", gross: cellNumber(run.totalGross), deductions: cellNumber(run.totalDeductions), net: cellNumber(run.totalNet) },
    footer: [`Payroll cycle ${run.cycleLabel}. Employer contributions are shown for information and are not part of net pay.`],
  };
  const left: XlsxSheet = {
    name: "Not paid",
    columns: [
      { key: "code", header: "Employee code" },
      { key: "name", header: "Name", width: 28 },
      { key: "status", header: "Status" },
      { key: "reason", header: "Why", width: 80 },
      { key: "net", header: "Net if released", type: "money" },
    ],
    rows: items.filter((i) => i.status !== "PAYABLE").map((i) => ({ code: i.employee.employeeCode, name: nameOf(i), status: i.status === "HELD" ? "Held" : "Not calculated", reason: i.holdDetail ?? "", net: cellNumber(i.netPay) })),
  };
  const v = await computeVariance(runId);
  const variance: XlsxSheet = {
    name: "Difference from last month",
    columns: [
      { key: "code", header: "Employee code" },
      { key: "name", header: "Name", width: 28 },
      { key: "previous", header: "Net last month", type: "money" },
      { key: "current", header: "Net this month", type: "money" },
      { key: "change", header: "Change", type: "money" },
      { key: "percent", header: "Change %" },
      { key: "why", header: "Why", width: 50 },
      { key: "flag", header: "Flagged" },
    ],
    rows: v.rows.map((r) => ({ code: r.employeeCode, name: r.name, previous: r.previous ? cellNumber(r.previous.net) : "", current: r.current ? cellNumber(r.current.net) : "", change: r.change ? cellNumber(r.change.net) : "", percent: r.percent ?? "", why: r.tags.join(", "), flag: r.flagged ? "Yes" : "" })),
    footer: [v.baseline ? `Compared with ${v.baseline.cycleLabel}${v.baseline.final ? " (finalised)" : " (a draft, not a finalised month)"}.` : "There is no run for the previous cycle to compare with.", v.thresholds.set ? `Flagged: net moves by at least ${v.thresholds.percent}% and ${v.thresholds.minAmount} rupees.` : "The highlight thresholds are not set, so nothing is flagged."],
  };
  const rulesSheet: XlsxSheet = {
    name: "Rules used",
    columns: [
      { key: "rule", header: "Rule or item", width: 60 },
      { key: "version", header: "Version", type: "number" },
      { key: "status", header: "Status" },
    ],
    rows: statuses.map((s) => ({ rule: s.label, version: s.pin.version, status: s.status === "CONFIRMED" ? "Confirmed" : s.pin.unset ? "Not set" : "Placeholder" })),
  };
  const buffer = await buildPayrollXlsx([register, left, variance, rulesSheet], watermark);
  return { buffer, fileName: `payroll-register-${iso(run.cycleStart)}${watermark.test ? "-TEST" : ""}.xlsx` };
}
