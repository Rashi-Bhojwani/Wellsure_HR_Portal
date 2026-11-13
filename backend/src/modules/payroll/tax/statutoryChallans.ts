import { z } from "zod";
import { parseFinancialYearLabel } from "@shared/utils/financialYear";
import { writeAuditLog } from "../../../lib/audit";
import { businessToday } from "../../../lib/businessDate";
import { requireDirector } from "../../../lib/directorAuthority";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { canonicalDecimal, dec, fixed, ZERO, type Money } from "../money";
import { keyedHash, seal } from "../sealed";
import { monthsOf, type Actor } from "./form16";

// ST-03 / ST-06 (docs/plans/A_PARITY_ROWS.md): PF and ESI challan records, kept like the TDS challans. One director enters a deposit (the reference sealed, shown by
// its last four), a different director confirms it by typing the amount and the reference again. Beside each month: what finalised runs worked out on the statute's
// own lines (employee and employer) against the confirmed deposits — shown, never computed here. No official file format; nothing talks to the PF or ESI portals.

export const STATUTORY_CHALLAN_KINDS = ["PF", "ESI"] as const;
type Kind = (typeof STATUTORY_CHALLAN_KINDS)[number];
const MONEY = /^\d+(\.\d{1,2})?$/;
const REFERENCE = /^[A-Za-z0-9]{4,30}$/;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const hashOf = (kind: Kind, reference: string) => keyedHash(`statutory-challan-${kind}`, reference.toUpperCase());

function fyOf(raw: string) {
  try {
    return parseFinancialYearLabel(raw);
  } catch (err) {
    throw new HttpError(400, (err as Error).message, "VALIDATION_ERROR");
  }
}

export const entrySchema = z
  .object({
    kind: z.enum(STATUTORY_CHALLAN_KINDS),
    month: z.string().regex(/^\d{4}-\d{2}$/, "A month, YYYY-MM"),
    depositedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date, YYYY-MM-DD"),
    amount: z.string().regex(MONEY, "Digits with up to two decimals"),
    reference: z.string().trim().regex(REFERENCE, "The challan reference: 4 to 30 letters and digits"),
  })
  .strict();
export const confirmSchema = z.object({ amount: z.string().regex(MONEY), reference: z.string().trim().regex(REFERENCE) }).strict();
export const registerQuery = z.object({ fy: z.string().length(7), kind: z.enum(STATUTORY_CHALLAN_KINDS) }).strict();

export async function enter(raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "enter a PF or ESI challan");
  const parsed = entrySchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const v = parsed.data;
  if (dec(v.amount).lte(ZERO)) throw new HttpError(400, "The amount must be more than zero.", "VALIDATION_ERROR");
  if (v.depositedOn > iso(businessToday())) throw new HttpError(400, "A deposit cannot be in the future.", "VALIDATION_ERROR");
  const referenceHash = hashOf(v.kind, v.reference);
  if (await prisma.statutoryChallan.findUnique({ where: { kind_referenceHash: { kind: v.kind, referenceHash } } })) throw new HttpError(409, "A challan with that reference is already recorded.", "DUPLICATE_REFERENCE");
  const row = await prisma.statutoryChallan.create({ data: { kind: v.kind, month: v.month, depositedOn: day(v.depositedOn), amount: v.amount, reference: seal(v.reference.toUpperCase()) as unknown as object, referenceHash, referenceLast: v.reference.slice(-4).toUpperCase(), enteredByUserId: actor.userId } });
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.statutory_challan.entered", entityType: "StatutoryChallan", entityId: row.id, after: { kind: v.kind, month: v.month } }); // never the figure or the reference
  return { id: row.id };
}

/** A different director confirms by typing the amount and the reference again; a mismatch is refused. */
export async function confirm(id: string, raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "confirm a PF or ESI challan");
  const parsed = confirmSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const c = await prisma.statutoryChallan.findUnique({ where: { id }, include: { confirmation: true } });
  if (!c) throw new HttpError(404, "Challan not found.", "NOT_FOUND");
  if (c.confirmation) throw new HttpError(409, "Already confirmed.", "ALREADY_CONFIRMED");
  if (c.enteredByUserId === actor.userId) throw new HttpError(403, "You entered this challan, so a different director confirms it.", "CHECKER_IS_MAKER");
  if (!dec(parsed.data.amount).equals(dec(c.amount.toString())) || hashOf(c.kind as Kind, parsed.data.reference) !== c.referenceHash) throw new HttpError(409, "What you typed does not match what was entered. Check the challan and try again.", "RETYPE_MISMATCH");
  await prisma.statutoryChallanConfirmation.create({ data: { challanId: id, confirmedByUserId: actor.userId } });
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.statutory_challan.confirmed", entityType: "StatutoryChallan", entityId: id, after: { kind: c.kind, month: c.month } });
  return { id, confirmed: true };
}

/** What finalised runs worked out on the statute's own lines in each month (employee deductions and employer contributions), exact. */
export async function workedOutByMonth(kind: Kind, months: readonly string[]): Promise<Map<string, { employee: Money; employer: Money }>> {
  const first = day(`${months[0]}-01`);
  const lastMonth = months[months.length - 1]!;
  const end = new Date(Date.UTC(Number(lastMonth.slice(0, 4)), Number(lastMonth.slice(5, 7)), 0)); // allow-number: the last month's last day
  const lines = await prisma.payrollRunLine.findMany({ where: { source: kind, runItem: { status: { in: ["PAYABLE", "HELD"] } }, run: { status: "FINALISED", cycleEnd: { gte: first, lte: end } } }, select: { kind: true, amount: true, run: { select: { cycleEnd: true } } } });
  const out = new Map<string, { employee: Money; employer: Money }>();
  for (const l of lines) {
    const m = iso(l.run.cycleEnd).slice(0, 7);
    const cur = out.get(m) ?? { employee: ZERO, employer: ZERO };
    if (l.kind === "EMPLOYER_CONTRIBUTION") cur.employer = cur.employer.plus(dec(l.amount.toString()));
    else if (l.kind === "DEDUCTION") cur.employee = cur.employee.plus(dec(l.amount.toString()));
    out.set(m, cur);
  }
  return out;
}

export async function register(raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "see the PF and ESI challans");
  const parsed = registerQuery.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const fy = fyOf(parsed.data.fy);
  const kind = parsed.data.kind;
  const months = monthsOf(fy.label);
  const [challans, worked] = await Promise.all([prisma.statutoryChallan.findMany({ where: { kind, month: { in: months } }, include: { confirmation: true }, orderBy: [{ month: "asc" }, { createdAt: "asc" }] }), workedOutByMonth(kind, months)]);
  const deposited = new Map<string, Money>();
  for (const c of challans) if (c.confirmation) deposited.set(c.month, (deposited.get(c.month) ?? ZERO).plus(dec(c.amount.toString())));
  return {
    year: fy.label,
    kind,
    challans: challans.map((c) => ({ id: c.id, month: c.month, depositedOn: iso(c.depositedOn), amount: canonicalDecimal(dec(c.amount.toString())), reference: `…${c.referenceLast}`, confirmed: !!c.confirmation, enteredByMe: c.enteredByUserId === actor.userId })),
    months: months.map((m) => {
      const w = worked.get(m) ?? { employee: ZERO, employer: ZERO };
      const total = w.employee.plus(w.employer);
      const p = deposited.get(m) ?? ZERO;
      return { month: m, employee: fixed(w.employee, 2), employer: fixed(w.employer, 2), workedOut: fixed(total, 2), deposited: fixed(p, 2), difference: fixed(total.minus(p), 2) };
    }),
    note: "Worked out = the statute's own lines in finalised runs (employee and employer). Deposited = confirmed challans only. Administration charges and any other dues are not added here.",
  };
}
