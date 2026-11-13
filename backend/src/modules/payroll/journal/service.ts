import { z } from "zod";
import { writeAuditLog } from "../../../lib/audit";
import { requireDirector } from "../../../lib/directorAuthority";
import { prisma } from "../../../lib/prisma";
import { buildXlsx } from "../../../lib/xlsx";
import { HttpError } from "../../../middleware/errorHandler";
import { canonicalDecimal, dec, sum, ZERO, type Money } from "../money";
import { csvOf } from "../reports/service";

// PY-41 (docs/plans/A_PARITY_ROWS.md part 2): the accounting journal of a finalised run. A director maps each journal key to a ledger account name (none preset). Keys:
//   EARNING:<head>                 debit  (the expense)
//   DEDUCTION:<head>               credit (owed to whoever the deduction is for)
//   ROUNDING:<head>                debit when positive, credit when negative
//   EMPLOYER:<head>:EXPENSE        debit, and EMPLOYER:<head>:LIABILITY credit (the employer's contribution)
//   NET_PAY                        credit (net pay owed to the people; a debit if negative)
// People paid and people held both count. Amounts are exact; the journal balances exactly or it is not given. No accounting package's format is built.

type Actor = { userId: string; ip?: string | null };
type Line = { code: string; kind: string; amount: Money };
export interface JournalEntry { key: string; debit: Money; credit: Money }

/** The journal entries of a run's lines and net pay, before any mapping: one entry per key, debit and credit exact. Pure; exported for the test. */
export function journalOf(lines: readonly Line[], netPay: Money): JournalEntry[] {
  const m = new Map<string, JournalEntry>();
  const add = (key: string, debit: Money, credit: Money) => {
    const e = m.get(key) ?? { key, debit: ZERO, credit: ZERO };
    e.debit = e.debit.plus(debit);
    e.credit = e.credit.plus(credit);
    m.set(key, e);
  };
  for (const l of lines) {
    if (l.kind === "EARNING") add(`EARNING:${l.code}`, l.amount, ZERO);
    else if (l.kind === "DEDUCTION") add(`DEDUCTION:${l.code}`, ZERO, l.amount);
    else if (l.kind === "ROUNDING") add(`ROUNDING:${l.code}`, l.amount.gt(ZERO) ? l.amount : ZERO, l.amount.lt(ZERO) ? l.amount.negated() : ZERO);
    else if (l.kind === "EMPLOYER_CONTRIBUTION") {
      add(`EMPLOYER:${l.code}:EXPENSE`, l.amount, ZERO);
      add(`EMPLOYER:${l.code}:LIABILITY`, ZERO, l.amount);
    }
  }
  add("NET_PAY", netPay.lt(ZERO) ? netPay.negated() : ZERO, netPay.gt(ZERO) ? netPay : ZERO); // a negative net (deductions above earnings) is owed by the people: a debit
  return [...m.values()].sort((a, b) => a.key.localeCompare(b.key));
}

async function runLines(runId: string) {
  const run = await prisma.payrollRun.findUnique({ where: { id: runId }, select: { id: true, status: true, cycleLabel: true } });
  if (!run) throw new HttpError(404, "No such payroll run.", "NOT_FOUND");
  if (run.status !== "FINALISED") throw new HttpError(409, "A journal is made from a finalised run only.", "RUN_NOT_FINALISED");
  const items = await prisma.payrollRunItem.findMany({ where: { runId, status: { in: ["PAYABLE", "HELD"] } }, select: { netPay: true, lines: { select: { code: true, kind: true, amount: true } } } });
  const lines = items.flatMap((i) => i.lines.map((l) => ({ code: l.code, kind: l.kind as string, amount: dec(l.amount.toString()) })));
  return { run, entries: journalOf(lines, sum(items.map((i) => dec(i.netPay.toString())))) };
}

async function mappings(): Promise<Map<string, string>> {
  const rows = await prisma.ledgerAccountMapping.findMany({ orderBy: { createdAt: "asc" } });
  return new Map(rows.map((r) => [r.key, r.account])); // ascending: the newest per key wins
}

export async function journal(runId: string, actor: Actor) {
  await requireDirector(actor.userId, "see a payroll journal");
  const { run, entries } = await runLines(runId);
  const map = await mappings();
  const notSet = entries.filter((e) => !map.has(e.key)).map((e) => e.key);
  const totalDebit = sum(entries.map((e) => e.debit));
  const totalCredit = sum(entries.map((e) => e.credit));
  if (!totalDebit.equals(totalCredit)) throw new HttpError(409, "The run's lines do not balance against its net pay; the journal is not given.", "JOURNAL_UNBALANCED");
  const byAccount = new Map<string, { debit: Money; credit: Money; keys: string[] }>();
  for (const e of entries) {
    const account = map.get(e.key);
    if (!account) continue;
    const a = byAccount.get(account) ?? { debit: ZERO, credit: ZERO, keys: [] };
    a.debit = a.debit.plus(e.debit);
    a.credit = a.credit.plus(e.credit);
    a.keys.push(e.key);
    byAccount.set(account, a);
  }
  return {
    run: run.cycleLabel,
    keys: entries.map((e) => ({ key: e.key, debit: canonicalDecimal(e.debit), credit: canonicalDecimal(e.credit), account: map.get(e.key) ?? null })),
    notSet,
    accounts: notSet.length ? [] : [...byAccount].sort((a, b) => a[0].localeCompare(b[0])).map(([account, a]) => ({ account, debit: canonicalDecimal(a.debit), credit: canonicalDecimal(a.credit), keys: a.keys })),
    totalDebit: canonicalDecimal(totalDebit),
    totalCredit: canonicalDecimal(totalCredit),
    note: "Exact amounts. Paid and held people both count. Every key is mapped by a director; none is preset.",
  };
}

export const mappingSchema = z.object({ mappings: z.array(z.object({ key: z.string().trim().min(3).max(80).regex(/^(EARNING|DEDUCTION|ROUNDING):[A-Z0-9_]+$|^EMPLOYER:[A-Z0-9_]+:(EXPENSE|LIABILITY)$|^NET_PAY$/, "Not a journal key"), account: z.string().trim().min(1).max(120) }).strict()).min(1).max(200), reason: z.string().trim().min(3).max(300) }).strict();

export async function setMappings(raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "map ledger accounts");
  const p = mappingSchema.safeParse(raw);
  if (!p.success) throw new HttpError(400, p.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  await prisma.ledgerAccountMapping.createMany({ data: p.data.mappings.map((m) => ({ key: m.key, account: m.account, reason: p.data.reason, setByUserId: actor.userId })) });
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.journal.mappings_set", entityType: "LedgerAccountMapping", entityId: p.data.mappings[0]!.key, after: { keys: p.data.mappings.map((m) => m.key), reason: p.data.reason } });
  return { saved: p.data.mappings.length };
}

export const exportQuery = z.object({ format: z.enum(["xlsx", "csv"]) }).strict();

export async function exportJournal(runId: string, raw: unknown, actor: Actor): Promise<{ buffer: Buffer; fileName: string; contentType: string }> {
  const q = exportQuery.safeParse(raw);
  if (!q.success) throw new HttpError(400, q.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const j = await journal(runId, actor);
  if (j.notSet.length) throw new HttpError(409, `Map every journal key first; Not set: ${j.notSet.slice(0, 5).join(", ")}${j.notSet.length > 5 ? "…" : ""}`, "MAPPING_NOT_SET");
  const columns = [{ key: "account", header: "Account", type: "text" as const }, { key: "debit", header: "Debit", type: "money" as const }, { key: "credit", header: "Credit", type: "money" as const }];
  const rows = j.accounts.map((a) => ({ account: a.account, debit: a.debit, credit: a.credit }));
  const preamble = [`Payroll journal, ${j.run}`, j.note];
  const fileName = `payroll-journal-${j.run.replace(/[^A-Za-z0-9]+/g, "-")}.${q.data.format}`;
  const buffer = q.data.format === "csv" ? Buffer.from(csvOf(columns, [...rows, { account: "Total", debit: j.totalDebit, credit: j.totalCredit }], preamble), "utf8") : await buildXlsx([{ name: "Journal", columns, rows, totals: { account: "Total", debit: j.totalDebit, credit: j.totalCredit }, footer: preamble }]);
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.journal.exported", entityType: "PayrollRun", entityId: runId, after: { format: q.data.format, accounts: rows.length } });
  return { buffer, fileName, contentType: q.data.format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
}
