import { readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "../../../lib/prisma";
import { buildPayslips } from "../run/payslip";
import type { Closing } from "./closeTestHelpers";

// Golden regression helpers (docs/plans/A_PART3.md): the snapshot of a finalised run that fixtures/golden-run.json holds, written once before part 3.
export const GOLDEN_FIXTURE = path.join(__dirname, "fixtures", "golden-run.json");
export const goldenFixture = () => JSON.parse(readFileSync(GOLDEN_FIXTURE, "utf8")) as GoldenSnapshot;

export interface GoldenSnapshot {
  items: Record<string, { status: string; gross: string; deductions: string; employerContributions: string; netBeforeRounding: string; roundingAdjustment: string; netPay: string; lines: string[] }>;
  payslips: Record<string, { totals: unknown; days: unknown; earnings: string[]; deductions: string[]; employer: string[] }>;
}

/** The run's figures and payslip contents in a form that does not depend on random ids, codes or names. */
export async function goldenSnapshot(world: Closing, runId: string): Promise<GoldenSnapshot> {
  const strip = (code: string) => code.replace(`${world.prefix}_`, "P_");
  const letterOf = new Map(Object.entries(world.named).map(([k, v]) => [v.employeeId, k]));
  const items = await prisma.payrollRunItem.findMany({ where: { runId }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
  const out: GoldenSnapshot = { items: {}, payslips: {} };
  for (const i of items) {
    const k = letterOf.get(i.employeeId);
    if (!k) continue;
    out.items[k] = {
      status: i.status,
      gross: i.gross.toString(),
      deductions: i.deductions.toString(),
      employerContributions: i.employerContributions.toString(),
      netBeforeRounding: i.netBeforeRounding.toString(),
      roundingAdjustment: i.roundingAdjustment.toString(),
      netPay: i.netPay.toString(),
      lines: i.lines.map((l) => `${l.sortOrder}|${strip(l.code)}|${l.kind}|${l.source}|${l.amount.toString()}`),
    };
  }
  const run = await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } });
  for (const [employeeId, slip] of await buildPayslips(run)) {
    const k = letterOf.get(employeeId);
    if (!k) continue;
    const c = slip.content as unknown as { totals: unknown; days: unknown; earnings: Array<{ code: string; amount: string }>; deductions: Array<{ code: string; amount: string }>; employer?: Array<{ code: string; amount: string }> };
    const fmt = (xs: Array<{ code: string; amount: string }> | undefined) => (xs ?? []).map((l) => `${strip(l.code)}|${l.amount}`);
    out.payslips[k] = { totals: c.totals, days: c.days, earnings: fmt(c.earnings), deductions: fmt(c.deductions), employer: fmt(c.employer) };
  }
  return out;
}

