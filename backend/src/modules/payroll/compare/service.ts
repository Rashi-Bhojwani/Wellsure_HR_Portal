import { randomUUID } from "node:crypto";
import { writeAuditLog } from "../../../lib/audit";
import { buildPayrollXlsx } from "../exports";
import { compareRegisters, parseOptions } from "./diff";
import { parseRegister } from "./parse";
import type { CompareResult, RegisterSource } from "./types";

export interface CompareInput {
  a: { buffer: Buffer; label: string; source: RegisterSource; fileName: string };
  b: { buffer: Buffer; label: string; source: RegisterSource; fileName: string };
  toleranceAmount?: string;
  tolerancePercent?: string;
  aliases?: Record<string, string>;
}

/**
 * Compares two registers. Both files are read in memory and dropped; the result is returned and not kept. The audit row says who compared which sources and how many people differed,
 * never a figure or a name.
 */
export async function compare(input: CompareInput, actor: { userId: string; ip?: string | null; userAgent?: string | null }): Promise<CompareResult> {
  const options = parseOptions({ toleranceAmount: input.toleranceAmount, tolerancePercent: input.tolerancePercent, aliases: input.aliases });
  const [ra, rb] = [await parseRegister(input.a.source, input.a.buffer, input.a.label), await parseRegister(input.b.source, input.b.buffer, input.b.label)];
  const result = compareRegisters(ra, rb, options);
  await writeAuditLog({
    actorUserId: actor.userId,
    action: "payroll.registers.compared",
    entityType: "PayrollCompare",
    entityId: randomUUID(),
    after: { sources: [input.a.source, input.b.source], people: [result.a.people, result.b.people], ...result.summary, toleranceAmount: options.toleranceAmount, tolerancePercent: options.tolerancePercent },
    ipAddress: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
  });
  return result;
}

/** The result as a workbook to keep: summary, the differences one line per person and component, who is in only one register, and the columns that could not be lined up. */
export async function resultWorkbook(r: CompareResult): Promise<Buffer> {
  const money = (v: string | null) => (v === null ? "" : Number(v)); // allow-number: a workbook cell has to be a number to sum in Excel
  return buildPayrollXlsx(
    [
      {
        name: "Summary",
        columns: [{ key: "what", header: "What", width: 46 }, { key: "n", header: "Count", type: "number" }],
        rows: [
          { what: `People in ${r.a.label}`, n: r.a.people },
          { what: `People in ${r.b.label}`, n: r.b.people },
          { what: "In both", n: r.summary.matchedPeople },
          { what: "In both, figures identical", n: r.summary.identical },
          { what: "In both, figures differ", n: r.summary.differing },
          { what: "Differences beyond the tolerance (people)", n: r.summary.flagged },
          { what: `Only in ${r.a.label}`, n: r.summary.onlyInA },
          { what: `Only in ${r.b.label}`, n: r.summary.onlyInB },
        ],
        footer: [`Tolerance: ₹${r.options.toleranceAmount} or ${r.options.tolerancePercent}% of ${r.a.label}'s figure; a difference within either is not flagged.`],
      },
      {
        name: "Differences",
        columns: [
          { key: "code", header: "Employee code" },
          { key: "name", header: "Name", width: 28 },
          { key: "label", header: "Component", width: 28 },
          { key: "a", header: r.a.label, type: "money" },
          { key: "b", header: r.b.label, type: "money" },
          { key: "difference", header: "Difference", type: "money" },
          { key: "percent", header: "Difference %" },
          { key: "flagged", header: "Beyond tolerance" },
        ],
        rows: r.people.flatMap((p) => p.differences.map((d) => ({ code: p.code, name: p.name ?? "", label: d.label, a: money(d.a), b: money(d.b), difference: money(d.difference), percent: d.percent === null ? "" : `${d.percent}%`, flagged: d.flagged ? "Yes" : "No" }))),
      },
      {
        name: "Only in one",
        columns: [{ key: "code", header: "Employee code" }, { key: "name", header: "Name", width: 28 }, { key: "where", header: "Found only in", width: 28 }],
        rows: [...r.onlyInA.map((p) => ({ code: p.code, name: p.name ?? "", where: r.a.label })), ...r.onlyInB.map((p) => ({ code: p.code, name: p.name ?? "", where: r.b.label }))],
      },
      {
        name: "Columns",
        columns: [{ key: "label", header: "Column", width: 36 }, { key: "status", header: "Status", width: 50 }],
        rows: [...r.columns.matched.map((label) => ({ label, status: "In both" })), ...r.columns.onlyInA.map((label) => ({ label, status: `Only in ${r.a.label}` })), ...r.columns.onlyInB.map((label) => ({ label, status: `Only in ${r.b.label}` })), ...r.a.ignoredColumns.map((label) => ({ label, status: `Not an amount, left out of ${r.a.label}` })), ...r.b.ignoredColumns.map((label) => ({ label, status: `Not an amount, left out of ${r.b.label}` }))],
      },
    ],
    { test: false, text: "", rules: [] },
  );
}
