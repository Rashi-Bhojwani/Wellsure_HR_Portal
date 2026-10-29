import type { PayrollRun } from "@prisma/client";
import { rupeesInWords } from "@shared/utils/inWords";
import { bankAccountsOn, namesOn, placementsOn } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { getLetterhead } from "../../letters/service";
import { payrollHash } from "../hash";
import { canonicalDecimal, dec, fixed, sum, ZERO } from "../money";
import { paymentDateOf } from "./bank";

// What a payslip says (docs/plans/PHASE_6.md §9 and §14H). The content is built once, from a FINAL run's stored items and lines, at the moment payslips are published,
// and stored whole: after that nothing about a payslip is looked up again, so it can never differ from what was approved. Every amount is a fixed two-place string; no
// figure is a JavaScript number. Nothing here is a secret: the bank account and the statutory numbers are only their last four digits.

export interface PayslipLine {
  code: string;
  label: string;
  amount: string;
}

export interface PayslipContent {
  version: 1;
  company: { legalName: string; address: string };
  period: { label: string; start: string; end: string };
  employee: { code: string; name: string; dateOfJoining: string; department: string; designation: string; location: string };
  days: { paid: string; lop: string; basis: string };
  earnings: PayslipLine[];
  deductions: PayslipLine[];
  employerContributions: PayslipLine[];
  /** Signed: the rounding that took the net to its final figure. Null when there was none. */
  rounding: string | null;
  totals: { gross: string; deductions: string; net: string; employerContributions: string };
  netInWords: string;
  bank: { bankName: string; accountLast4: string } | null;
  statutory: { panLast4: string | null; uanLast4: string | null; esiLast4: string | null };
  runHash: string;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const money = (v: { toString(): string }) => fixed(dec(v.toString()), 2);

export const payslipHash = (content: PayslipContent) => payrollHash(content);

/** Builds the content of every PAYABLE person's payslip for a run, keyed by employee id. */
export async function buildPayslips(run: PayrollRun): Promise<Map<string, { runItemId: string; content: PayslipContent; contentHash: string }>> {
  const items = await prisma.payrollRunItem.findMany({ where: { runId: run.id, status: "PAYABLE" }, include: { lines: { orderBy: { sortOrder: "asc" } }, employee: { select: { employeeCode: true, dateOfJoining: true } } } });
  const ids = items.map((i) => i.employeeId);
  const names = await namesOn(ids, run.cycleEnd);
  const letterhead = await getLetterhead();
  const placements = await placementsOn(ids, run.cycleEnd); // where each person was at the end of the period (the nearest placement for someone who left earlier)
  const statutory = new Map((await prisma.employeeStatutory.findMany({ where: { employeeId: { in: ids } }, select: { employeeId: true, panLast4: true, uanLast4: true, esiLast4: true } })).map((s) => [s.employeeId, s]));
  // The account the salary goes to: the one in force on the payment date (the cycle end if the run read no payment date), the same account the bank file uses.
  const paidOn = (await paymentDateOf(run)) ?? run.cycleEnd;
  const banks = await bankAccountsOn(ids, paidOn);

  const out = new Map<string, { runItemId: string; content: PayslipContent; contentHash: string }>();
  for (const item of items) {
    const line = (kind: string) => item.lines.filter((l) => l.kind === kind).map((l) => ({ code: l.code, label: l.label, amount: money(l.amount) }));
    const rounding = item.lines.filter((l) => l.kind === "ROUNDING");
    const roundingTotal = sum(rounding.map((l) => dec(l.amount.toString())));
    const job = placements.get(item.employeeId);
    const stat = statutory.get(item.employeeId);
    const bank = banks.get(item.employeeId);
    const net = money(item.netPay);
    const content: PayslipContent = {
      version: 1,
      company: { legalName: letterhead.legalName, address: letterhead.registeredAddress },
      period: { label: run.cycleLabel, start: iso(run.cycleStart), end: iso(run.cycleEnd) },
      employee: {
        code: item.employee.employeeCode,
        name: names.get(item.employeeId) ?? item.employee.employeeCode,
        dateOfJoining: iso(item.employee.dateOfJoining),
        department: job?.department ?? "",
        designation: job?.designation ?? "",
        location: job?.location ?? "",
      },
      days: { paid: canonicalDecimal(dec(item.paidDays.toString()).toDecimalPlaces(2)), lop: canonicalDecimal(dec(item.lopDays.toString())), basis: canonicalDecimal(dec(item.basisDays.toString())) },
      earnings: line("EARNING"),
      deductions: line("DEDUCTION"),
      employerContributions: line("EMPLOYER_CONTRIBUTION"),
      rounding: roundingTotal.equals(ZERO) ? null : fixed(roundingTotal, 2),
      totals: { gross: money(item.gross), deductions: money(item.deductions), net, employerContributions: money(item.employerContributions) },
      netInWords: rupeesInWords(net),
      bank: bank ? { bankName: bank.bankName, accountLast4: bank.accountNumberLast4 } : null,
      statutory: { panLast4: stat?.panLast4 ?? null, uanLast4: stat?.uanLast4 ?? null, esiLast4: stat?.esiLast4 ?? null },
      runHash: run.runHash ?? "",
    };
    out.set(item.employeeId, { runItemId: item.id, content, contentHash: payslipHash(content) });
  }
  return out;
}
