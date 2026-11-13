import { z } from "zod";
import { ITEM_CODE_PATTERN } from "@shared/constants/payrollSalary";
import { writeAuditLog } from "../../../lib/audit";
import { requireDirector } from "../../../lib/directorAuthority";
import { namesOn, payrollPlacementsOn } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { dec, fixed, sum, type Money } from "../money";

// ST-29 (docs/plans/A_PARITY_ROWS.md part 2): the minimum wages check. Directors enter every value — each rate (state as written on the branches, category, monthly
// amount, from, source), each person's category, and which pay heads are compared — none is preset. A run's check lists each payable person whose compared amount is
// below the minimum in force for their branch's state and their category on the run's last day. It never changes pay; until a value exists it says what is Not set.

type Actor = { userId: string; ip?: string | null };
const MONEY = /^\d+(\.\d{1,2})?$/;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export const rateSchema = z.object({ state: z.string().trim().min(1).max(60), category: z.string().trim().min(1).max(60), monthlyAmount: z.string().regex(MONEY, "Rupees, up to two decimals"), effectiveFrom: z.iso.date(), source: z.string().trim().min(3).max(300) }).strict();
export const categorySchema = z.object({ employeeId: z.string().min(1).max(64), category: z.string().trim().min(1).max(60) }).strict();
export const basisSchema = z.object({ headCodes: z.array(z.string().regex(ITEM_CODE_PATTERN)).min(1).max(40), source: z.string().trim().min(3).max(300) }).strict();
const bad = (e: z.ZodError) => new HttpError(400, e.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");

/** The rate in force on a day for each state and category: the latest effective-from on or before it (the newest entry wins a tie). Pure; exported for the test. */
export function ratesInForce(rows: ReadonlyArray<{ state: string; category: string; monthlyAmount: string; effectiveFrom: string; createdAt: string }>, day: string): Map<string, string> {
  const best = new Map<string, { from: string; at: string; amount: string }>();
  for (const r of rows) {
    if (r.effectiveFrom > day) continue;
    const k = `${r.state}|${r.category}`;
    const cur = best.get(k);
    if (!cur || r.effectiveFrom > cur.from || (r.effectiveFrom === cur.from && r.createdAt > cur.at)) best.set(k, { from: r.effectiveFrom, at: r.createdAt, amount: r.monthlyAmount });
  }
  return new Map([...best].map(([k, v]) => [k, v.amount]));
}

export async function setup(actor: Actor) {
  await requireDirector(actor.userId, "see minimum wages");
  const [rates, basis, states] = await Promise.all([
    prisma.minimumWageRate.findMany({ orderBy: [{ state: "asc" }, { category: "asc" }, { effectiveFrom: "desc" }] }),
    prisma.minimumWageBasis.findFirst({ orderBy: { createdAt: "desc" } }),
    prisma.location.findMany({ distinct: ["state"], select: { state: true }, orderBy: { state: "asc" } }),
  ]);
  return {
    rates: rates.map((r) => ({ id: r.id, state: r.state, category: r.category, monthlyAmount: fixed(dec(r.monthlyAmount.toString()), 2), effectiveFrom: iso(r.effectiveFrom), source: r.source })),
    basis: basis ? { headCodes: basis.headCodes, source: basis.source, setAt: basis.createdAt.toISOString() } : null,
    branchStates: states.map((s) => s.state).filter(Boolean),
    note: "No rate, category or compared heads are preset: each is entered by a director with its source.",
  };
}

export async function addRate(raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "enter a minimum wage");
  const p = rateSchema.safeParse(raw);
  if (!p.success) throw bad(p.error);
  const row = await prisma.minimumWageRate.create({ data: { ...p.data, effectiveFrom: new Date(`${p.data.effectiveFrom}T00:00:00Z`), createdByUserId: actor.userId } });
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.minimum_wage.rate_added", entityType: "MinimumWageRate", entityId: row.id, after: { state: p.data.state, category: p.data.category, effectiveFrom: p.data.effectiveFrom } }); // the amount is a public rate, but the audit stays figure-free like the rest
  return { id: row.id };
}

export async function setCategory(raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "set a minimum wage category");
  const p = categorySchema.safeParse(raw);
  if (!p.success) throw bad(p.error);
  if (!(await prisma.employee.findUnique({ where: { id: p.data.employeeId }, select: { id: true } }))) throw new HttpError(404, "Employee not found.", "NOT_FOUND");
  const row = await prisma.minimumWageCategory.create({ data: { ...p.data, setByUserId: actor.userId } });
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.minimum_wage.category_set", entityType: "Employee", entityId: p.data.employeeId, after: { category: p.data.category } });
  return { id: row.id };
}

export async function setBasis(raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "choose the heads compared with the minimum wage");
  const p = basisSchema.safeParse(raw);
  if (!p.success) throw bad(p.error);
  const row = await prisma.minimumWageBasis.create({ data: { headCodes: [...new Set(p.data.headCodes)].sort(), source: p.data.source, setByUserId: actor.userId } });
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.minimum_wage.basis_set", entityType: "MinimumWageBasis", entityId: row.id, after: { headCodes: row.headCodes } });
  return { id: row.id };
}

export const checkQuery = z.object({ runId: z.string().min(1).max(64) }).strict();

/** The check for one calculated run: who is below the minimum, and what is Not set (no basis, people without a category, state and category without a rate). */
export async function check(raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "run the minimum wages check");
  const p = checkQuery.safeParse(raw);
  if (!p.success) throw bad(p.error);
  const run = await prisma.payrollRun.findUnique({ where: { id: p.data.runId }, select: { id: true, cycleLabel: true, cycleEnd: true, runHash: true } });
  if (!run) throw new HttpError(404, "No such payroll run.", "NOT_FOUND");
  if (!run.runHash) throw new HttpError(409, "This run has not been calculated yet.", "CONFLICT");
  const basis = await prisma.minimumWageBasis.findFirst({ orderBy: { createdAt: "desc" } });
  if (!basis) return { run: run.cycleLabel, notSet: ["The pay heads compared with the minimum wage are Not set."], below: [], checked: 0 };
  const items = await prisma.payrollRunItem.findMany({ where: { runId: run.id, status: { in: ["PAYABLE", "HELD"] } }, select: { employeeId: true, lines: { where: { kind: "EARNING", code: { in: basis.headCodes } }, select: { amount: true } } } });
  const ids = items.map((i) => i.employeeId);
  const end = iso(run.cycleEnd);
  const [placements, categories, rateRows, names, emps] = await Promise.all([
    payrollPlacementsOn(ids, run.cycleEnd),
    prisma.minimumWageCategory.findMany({ where: { employeeId: { in: ids } }, orderBy: { createdAt: "asc" } }),
    prisma.minimumWageRate.findMany(),
    namesOn(ids, run.cycleEnd),
    prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, employeeCode: true } }),
  ]);
  const categoryOf = new Map<string, string>();
  for (const c of categories) categoryOf.set(c.employeeId, c.category); // ascending: the newest wins
  const rates = ratesInForce(rateRows.map((r) => ({ state: r.state, category: r.category, monthlyAmount: r.monthlyAmount.toString(), effectiveFrom: iso(r.effectiveFrom), createdAt: r.createdAt.toISOString() })), end);
  const code = new Map(emps.map((e) => [e.id, e.employeeCode]));
  const noCategory: string[] = [];
  const noRate = new Set<string>();
  const below: Array<{ employeeCode: string; name: string; state: string; category: string; compared: string; minimum: string; shortfall: string }> = [];
  let checked = 0;
  for (const i of items) {
    const category = categoryOf.get(i.employeeId);
    const state = placements.get(i.employeeId)?.locationState ?? "";
    if (!category) { noCategory.push(code.get(i.employeeId) ?? i.employeeId); continue; }
    const min = rates.get(`${state}|${category}`);
    if (min === undefined) { noRate.add(`${state || "no state"} / ${category}`); continue; }
    checked += 1;
    const compared: Money = sum(i.lines.map((l) => dec(l.amount.toString())));
    if (compared.lt(dec(min))) below.push({ employeeCode: code.get(i.employeeId) ?? "", name: names.get(i.employeeId) ?? "", state, category, compared: fixed(compared, 2), minimum: fixed(dec(min), 2), shortfall: fixed(dec(min).minus(compared), 2) });
  }
  const notSet = [
    ...(noCategory.length ? [`${noCategory.length} ${noCategory.length === 1 ? "person has" : "people have"} no category: ${noCategory.slice(0, 20).join(", ")}${noCategory.length > 20 ? "…" : ""}`] : []),
    ...[...noRate].map((k) => `No rate in force for ${k}.`),
  ];
  return { run: run.cycleLabel, basis: basis.headCodes, notSet, below: below.sort((a, b) => a.employeeCode.localeCompare(b.employeeCode)), checked, note: "The check never changes pay." };
}
