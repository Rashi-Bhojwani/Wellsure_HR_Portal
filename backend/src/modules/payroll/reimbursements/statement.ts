import { z } from "zod";
import { requireDirector } from "../../../lib/directorAuthority";
import { businessToday } from "../../../lib/businessDate";
import { namesOn } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { dec, fixed, sum } from "../money";

// PY-24 (docs/plans/A_PARITY_ROWS.md): the reimbursement statement per run. For each finalised run, the claims it paid (the reimbursement adjustments it consumed):
// claim type, date spent, amount paid. The person sees their own; directors see everyone's for a month. Off-cycle runs that paid a claim are listed the same way.

const iso = (d: Date) => d.toISOString().slice(0, 10);
type Adj = { id: string; employeeId: string; sourceRef: string | null; amount: { toString(): string }; consumedByRun: { id: string; cycleLabel: string; cycleStart: Date; status: string } | null };

async function linesOf(adjs: Adj[]) {
  const claims = await prisma.reimbursementClaim.findMany({ where: { id: { in: adjs.map((a) => a.sourceRef!).filter(Boolean) } }, select: { id: true, typeKey: true, spentOn: true } });
  const byId = new Map(claims.map((c) => [c.id, c]));
  return adjs.map((a) => ({ adj: a, claim: byId.get(a.sourceRef ?? "") }));
}

function group(rows: Awaited<ReturnType<typeof linesOf>>, names?: Map<string, string>, codes?: Map<string, string>) {
  const runs = new Map<string, { runId: string; cycle: string; start: string; lines: Array<Record<string, string>> }>();
  for (const { adj, claim } of rows) {
    const run = adj.consumedByRun!;
    const g = runs.get(run.id) ?? { runId: run.id, cycle: run.cycleLabel, start: iso(run.cycleStart), lines: [] };
    g.lines.push({ ...(names ? { employeeCode: codes?.get(adj.employeeId) ?? "", name: names.get(adj.employeeId) ?? "" } : {}), claimId: claim?.id ?? "", type: claim?.typeKey ?? "", spentOn: claim ? iso(claim.spentOn) : "", amount: fixed(dec(adj.amount.toString()), 2) });
    runs.set(run.id, g);
  }
  return [...runs.values()].sort((a, b) => b.start.localeCompare(a.start)).map((g) => ({ ...g, total: fixed(sum(g.lines.map((l) => dec(l.amount!))), 2) }));
}

const paidWhere = { source: "REIMBURSEMENT" as const, status: "CONSUMED" as const, consumedByRun: { status: "FINALISED" as const } };
const select = { id: true, employeeId: true, sourceRef: true, amount: true, consumedByRun: { select: { id: true, cycleLabel: true, cycleStart: true, status: true } } };

/** The person's own statement: every finalised run that paid them a claim. */
export async function myStatement(employeeId: string) {
  const adjs = await prisma.payrollAdjustment.findMany({ where: { ...paidWhere, employeeId }, select });
  return { runs: group(await linesOf(adjs)) };
}

export const statementQuery = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/, "A month, YYYY-MM") }).strict();

/** Directors: everyone's claims paid by the month's finalised run. */
export async function monthStatement(raw: unknown, actor: { userId: string }) {
  await requireDirector(actor.userId, "see the reimbursement statement");
  const parsed = statementQuery.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const start = new Date(`${parsed.data.month}-01T00:00:00Z`);
  const adjs = await prisma.payrollAdjustment.findMany({ where: { ...paidWhere, consumedByRun: { status: "FINALISED", cycleStart: start } }, select });
  const ids = [...new Set(adjs.map((a) => a.employeeId))];
  const [names, emps] = await Promise.all([namesOn(ids, businessToday()), prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, employeeCode: true } })]);
  return { month: parsed.data.month, runs: group(await linesOf(adjs), names, new Map(emps.map((e) => [e.id, e.employeeCode]))) };
}
