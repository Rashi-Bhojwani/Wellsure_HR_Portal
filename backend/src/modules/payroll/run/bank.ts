import type { PayrollRun } from "@prisma/client";
import { bankAccountsOn, namesOn } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { canonicalDecimal, dec, sum, ZERO } from "../money";
import type { RulePin } from "../rules/context";
import { paymentDateFor } from "./gather";
import { iso } from "./days";
import { layoutReady } from "./layouts";

// What would go into a bank file, worked out without ever holding an account number: only each account's blind-index hash, its last four digits and its IFSC. The same
// plan is the preview, the thing the approval's hash covers, and the list generation writes from, so the three can never disagree (docs/plans/PHASE_6.md §14H).

export const BANK_EXCLUDED_REASONS = { NO_ACCOUNT: "No bank account in force on the payment date" } as const;

export interface BankRowPlan {
  employeeId: string;
  employeeCode: string;
  name: string;
  bankAccountId: string;
  accountHash: string;
  accountLast4: string;
  ifsc: string;
  bankName: string;
  /** Canonical decimal string. */
  amount: string;
  serial: number;
}

export interface BankExcluded {
  employeeId: string;
  employeeCode: string;
  name: string;
  reason: string;
  detail: string;
}

export interface BankPlan {
  paymentDate: string | null;
  rows: BankRowPlan[];
  /** People payable in the run but not in the file, each with the reason. Never silent. */
  excluded: BankExcluded[];
  /** Held people (not payable at all in this run), listed for completeness with the run's own reason. */
  held: Array<{ employeeId: string; employeeCode: string; name: string; reason: string; detail: string | null }>;
  total: string;
  template: { ready: boolean; version: number | null; valueHash: string | null; status: string };
}

/** The payment date the run was worked out under: the rule version the run pinned, never whatever the rule says today. Null if the run read no payment-date rule. */
export async function paymentDateOf(run: Pick<PayrollRun, "pins" | "cycleEnd">): Promise<Date | null> {
  const pin = ((run.pins as unknown as RulePin[]) ?? []).find((p) => p.key === "PAYMENT_DATE_RULE" && (p.kind ?? "RULE") === "RULE" && !p.unset);
  if (!pin) return null;
  const row = await prisma.payrollItemVersion.findFirst({ where: { kind: "RULE", key: "PAYMENT_DATE_RULE", version: pin.version }, select: { value: true } });
  if (!row) return null;
  return paymentDateFor(run.cycleEnd, row.value as { monthOffset: 0 | 1; day: number | "LAST" });
}

export async function planBank(run: PayrollRun): Promise<BankPlan> {
  const paymentDate = await paymentDateOf(run);
  const items = await prisma.payrollRunItem.findMany({ where: { runId: run.id, status: { in: ["PAYABLE", "HELD"] } }, include: { employee: { select: { employeeCode: true } } }, orderBy: { employee: { employeeCode: "asc" } } });
  const names = await namesOn(items.map((i) => i.employeeId), run.cycleEnd);
  const nameOf = (i: (typeof items)[number]) => names.get(i.employeeId) ?? i.employee.employeeCode;
  const payable = items.filter((i) => i.status === "PAYABLE");
  const accounts = paymentDate ? await bankAccountsOn(payable.map((i) => i.employeeId), paymentDate) : new Map();
  const rows: BankRowPlan[] = [];
  const excluded: BankExcluded[] = [];
  for (const i of payable) {
    const account = accounts.get(i.employeeId);
    if (!account) {
      excluded.push({ employeeId: i.employeeId, employeeCode: i.employee.employeeCode, name: nameOf(i), reason: "NO_ACCOUNT", detail: paymentDate ? `${BANK_EXCLUDED_REASONS.NO_ACCOUNT} (${iso(paymentDate)})` : "The payment date is not set" });
      continue;
    }
    rows.push({ employeeId: i.employeeId, employeeCode: i.employee.employeeCode, name: nameOf(i), bankAccountId: account.id, accountHash: account.accountNumberHash, accountLast4: account.accountNumberLast4, ifsc: account.ifsc, bankName: account.bankName, amount: canonicalDecimal(dec(i.netPay.toString())), serial: rows.length + 1 });
  }
  const held = items.filter((i) => i.status === "HELD").map((i) => ({ employeeId: i.employeeId, employeeCode: i.employee.employeeCode, name: nameOf(i), reason: i.holdReason ?? "HELD", detail: i.holdDetail }));
  return { paymentDate: paymentDate ? iso(paymentDate) : null, rows, excluded, held, total: canonicalDecimal(sum(rows.map((r) => dec(r.amount))).plus(ZERO)), template: await layoutReady("BANK_TEMPLATE") };
}

/** What the approval's hash covers: the rows (who, which account, how much), the excluded, the date and the exact layout. */
export function bankHashParts(runHash: string | null, plan: BankPlan): unknown {
  return {
    runHash,
    paymentDate: plan.paymentDate,
    template: [plan.template.version, plan.template.valueHash],
    rows: plan.rows.map((r) => [r.employeeId, r.accountHash, r.ifsc, r.amount]),
    excluded: plan.excluded.map((e) => [e.employeeId, e.reason]),
  };
}
