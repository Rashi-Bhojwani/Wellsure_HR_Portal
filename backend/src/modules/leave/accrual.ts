import type { LeaveLedger, LeavePolicy } from "@prisma/client";
import { requireLeaveTypeFor } from "./leaveTypeRoles";
import { prisma } from "../../lib/prisma";
import { addCalendarDays, addCalendarMonths, startOfMonthUTC } from "../../lib/businessDate";
import { withEmployeeLeaveLock } from "./concurrency";
import { writeLedgerEntry } from "./ledger";
import { HttpError } from "../../middleware/errorHandler";

// HR's confirmed PL rule (docs/PROJECT_SPEC.md §5.2, confirmed 2026-09-28):
// waiting period 90 days from DOJ, no pro-rating, always a full 1.0 day
// once eligible. eligibilityMode/eligibilityValue are configurable on
// leave_policies (DAYS default 90, or CALENDAR_MONTHS) — this function
// never hardcodes 90, it reads the policy.
/**
 * Audit fix 2026-11-18 (audit §3: a blank "days per month" credited 1.0, a blank eligibility period meant "eligible from joining"): an accruing leave type
 * needs both entered; a blank one is refused, naming it, and nothing is credited. 0 is a valid entry (eligible from joining).
 */
export function accrualPolicyMissing(name: string, policy: Pick<LeavePolicy, "eligibilityMode" | "eligibilityValue" | "accrualDaysPerMonth"> | null): string[] {
  return [
    ...(policy?.accrualDaysPerMonth === null || policy?.accrualDaysPerMonth === undefined ? [`${name}: days earned per month is not set`] : []),
    ...(!policy?.eligibilityMode || policy.eligibilityValue === null || policy.eligibilityValue === undefined ? [`${name}: the eligibility period is not set (enter 0 for eligible from joining)`] : []),
  ];
}
export function assertAccrualPolicy(name: string, policy: Pick<LeavePolicy, "eligibilityMode" | "eligibilityValue" | "accrualDaysPerMonth"> | null): void {
  const missing = accrualPolicyMissing(name, policy);
  if (missing.length) throw new HttpError(409, `${missing.join(". ")}. Set ${missing.length === 1 ? "it" : "them"} in Admin Tools, Leave Types and Policies. Nothing is credited until then.`, "SETTING_NOT_SET", { settings: missing });
}

export function computeEligibilityDate(dateOfJoining: Date, policy: Pick<LeavePolicy, "eligibilityMode" | "eligibilityValue">): Date {
  if (!policy.eligibilityMode || policy.eligibilityValue === null || policy.eligibilityValue === undefined) throw new HttpError(409, "The eligibility period is not set for this leave type (enter 0 for eligible from joining). Set it in Admin Tools, Leave Types and Policies.", "SETTING_NOT_SET");
  const value = policy.eligibilityValue;
  if (policy.eligibilityMode === "CALENDAR_MONTHS") {
    return addCalendarMonths(dateOfJoining, value);
  }
  return addCalendarDays(dateOfJoining, value); // DAYS mode
}

// The smallest first-of-month M such that `date <= M` — round a date UP
// to the next month's 1st, except a date that's already exactly a
// month's 1st stays as itself. This exact inclusive-boundary rule is what
// HR's third worked example pins down: joined 3 Oct -> eligible 1 Jan ->
// first credit 1 Jan, *not* 1 Feb. (The other two examples — 1 Jul -> 29
// Sep -> 1 Oct, and 6 Jul -> 4 Oct -> 1 Nov — don't land exactly on a
// month boundary, so they don't by themselves distinguish an inclusive
// rule from a strict one; the third example does, and this is built to
// match it.)
function firstOfMonthOnOrAfter(date: Date): Date {
  const thisMonthStart = startOfMonthUTC(date);
  if (date.getUTCDate() === 1) return thisMonthStart;
  return addCalendarMonths(thisMonthStart, 1);
}

// The first calendar month (1st, UTC midnight) an employee is credited —
// see firstOfMonthOnOrAfter's comment for the exact-boundary rule.
export function firstAccrualMonth(dateOfJoining: Date, policy: Pick<LeavePolicy, "eligibilityMode" | "eligibilityValue">): Date {
  return firstOfMonthOnOrAfter(computeEligibilityDate(dateOfJoining, policy));
}

// Whether an employee has crossed the eligibility boundary as of a given
// accrual run's month (the 1st the monthly job is crediting for) —
// inclusive: an eligibility date landing exactly on accrualMonth counts
// as already passed for that same month's credit (see
// firstOfMonthOnOrAfter above).
export function isEligibleForAccrualMonth(dateOfJoining: Date, policy: Pick<LeavePolicy, "eligibilityMode" | "eligibilityValue">, accrualMonth: Date): boolean {
  return computeEligibilityDate(dateOfJoining, policy).getTime() <= accrualMonth.getTime();
}

// Credits one employee's PL accrual for one month, idempotently. Proactive
// existence check first (avoids using a thrown constraint violation as
// normal control flow); the migration's partial unique index
// (employee_id, leave_type_id, accrual_month) WHERE entry_type='ACCRUAL'
// is the last-line-of-defense backstop against a race this check alone
// wouldn't catch (e.g. a manual re-trigger racing the scheduled run).
// Returns null when not eligible yet or already credited for this month
// — both are legitimate no-ops, not errors.
export async function creditMonthlyAccrualForEmployee(
  employeeId: string,
  dateOfJoining: Date,
  leaveTypeId: string,
  policy: Pick<LeavePolicy, "eligibilityMode" | "eligibilityValue" | "accrualDaysPerMonth">,
  accrualMonth: Date,
): Promise<LeaveLedger | null> {
  assertAccrualPolicy("This leave type", policy);
  if (!isEligibleForAccrualMonth(dateOfJoining, policy, accrualMonth)) return null;

  return withEmployeeLeaveLock(employeeId, async (tx) => {
    const existing = await tx.leaveLedger.findFirst({
      where: { employeeId, leaveTypeId, accrualMonth, entryType: "ACCRUAL" },
      select: { id: true },
    });
    if (existing) return null; // already credited this month — idempotent no-op

    return writeLedgerEntry(tx, {
      employeeId,
      leaveTypeId,
      leaveYear: accrualMonth.getUTCFullYear(),
      entryDate: accrualMonth,
      accrualMonth,
      entryType: "ACCRUAL",
      days: policy.accrualDaysPerMonth!, // checked by assertAccrualPolicy / isEligibleForAccrualMonth's caller: never a made-up 1.0
      referenceType: "ACCRUAL_JOB",
      remarks: `Monthly PL accrual for ${accrualMonth.toISOString().slice(0, 7)}`,
    });
  });
}

// The bulk driver the scheduled job (jobs/worker.ts) calls on the 1st of
// every month (spec §5.5). Iterates every ACTIVE employee, crediting PL
// per creditMonthlyAccrualForEmployee above — idempotent per employee-
// month, safe to re-run (a retry after a partial failure just no-ops on
// whoever was already credited).
export async function runMonthlyPlAccrual(accrualMonth: Date): Promise<{ credited: number; skipped: number }> {
  // Audit fix 2026-11-18: the earned leave type is a director setting; Not set refuses naming it (never a silent skip).
  const plType = await requireLeaveTypeFor("EARNED");
  if (plType.policy?.accrualEnabled) assertAccrualPolicy(plType.name, plType.policy);
  if (!plType.policy?.accrualEnabled) {
    return { credited: 0, skipped: 0 };
  }
  const policy = plType.policy;

  const employees = await prisma.employee.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, dateOfJoining: true },
  });

  let credited = 0;
  let skipped = 0;
  for (const employee of employees) {
    const result = await creditMonthlyAccrualForEmployee(employee.id, employee.dateOfJoining, plType.id, policy, accrualMonth);
    if (result) credited += 1;
    else skipped += 1;
  }
  return { credited, skipped };
}
