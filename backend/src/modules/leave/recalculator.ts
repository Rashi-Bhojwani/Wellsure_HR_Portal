import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { writeAuditLog } from "../../lib/audit";
import { startOfMonthUTC, addCalendarMonths, businessToday } from "../../lib/businessDate";
import { HttpError } from "../../middleware/errorHandler";
import { isEligibleForAccrualMonth } from "./accrual";
import { withEmployeeLeaveLock } from "./concurrency";
import { writeLedgerEntry } from "./ledger";
import type { ActorMeta } from "./types";
import { inForceOn } from "../../lib/effectiveDating";

// Leave Recalculator (spec §5.4) — replays PL-style accrual after a
// policy change, a corrected DOJ, or a backdated approval that shifted
// eligibility. Diffs what SHOULD be in the ledger (recomputed fresh from
// each employee's *current* dateOfJoining and the *current* policy)
// against what's actually there, month by month, from `fromDate` through
// the current month, for every accrual-enabled leave type (PL today,
// but not hardcoded — a future accrual-enabled type gets this for free).
//
// Unlike Year End Process, commit does not need a "balances drifted since
// preview, reject" check: recalculation is idempotent in its own right —
// re-diffing at commit time against whatever the ledger looks like *then*
// always produces the currently-correct action, never a wrong one, so
// commit simply re-runs the same diff preview did rather than trusting a
// stale snapshot.

interface RecalcAction {
  type: "CREDIT" | "REVERSE";
  accrualMonth: string; // YYYY-MM-01
  leaveTypeId: string;
  leaveTypeCode: string;
  days: number;
  existingLedgerId?: string; // set for REVERSE — the ACCRUAL row being reversed
}

interface RecalcEmployeeResult {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  actions: RecalcAction[];
}

async function accrualEnabledTypes() {
  return prisma.leaveType.findMany({ where: { isActive: true, policy: { accrualEnabled: true } }, include: { policy: true } });
}

async function diffForEmployee(
  employee: { id: string; dateOfJoining: Date },
  types: Awaited<ReturnType<typeof accrualEnabledTypes>>,
  fromMonth: Date,
  throughMonth: Date,
): Promise<RecalcAction[]> {
  const actions: RecalcAction[] = [];
  for (const type of types) {
    if (!type.policy) continue;
    const existingRows = await prisma.leaveLedger.findMany({
      where: { employeeId: employee.id, leaveTypeId: type.id, entryType: "ACCRUAL", accrualMonth: { gte: fromMonth, lte: throughMonth } },
      select: { id: true, accrualMonth: true, days: true },
    });
    const existingByMonth = new Map(existingRows.map((r) => [r.accrualMonth!.toISOString().slice(0, 10), r]));

    // ACCRUAL rows a prior recalculation already reversed — REVERSAL is a
    // different entryType than ACCRUAL, so existingByMonth alone can't
    // tell "still wrongly credited" from "already fixed". Without this,
    // a re-run would find the original (never-deleted) ACCRUAL row again
    // and propose REVERSE a second time, double-reversing the balance.
    const alreadyReversedIds = new Set(
      (
        await prisma.leaveLedger.findMany({
          where: { employeeId: employee.id, leaveTypeId: type.id, entryType: "REVERSAL", referenceType: "RECALCULATION", referenceId: { in: existingRows.map((r) => r.id) } },
          select: { referenceId: true },
        })
      ).map((r) => r.referenceId),
    );

    for (let month = fromMonth; month.getTime() <= throughMonth.getTime(); month = addCalendarMonths(month, 1)) {
      const monthKey = month.toISOString().slice(0, 10);
      const shouldBeCredited = isEligibleForAccrualMonth(employee.dateOfJoining, type.policy, month);
      const existing = existingByMonth.get(monthKey);

      if (shouldBeCredited && !existing) {
        actions.push({ type: "CREDIT", accrualMonth: monthKey, leaveTypeId: type.id, leaveTypeCode: type.code, days: (type.policy.accrualDaysPerMonth ?? new Prisma.Decimal(1)).toNumber() });
      } else if (!shouldBeCredited && existing && !alreadyReversedIds.has(existing.id)) {
        actions.push({ type: "REVERSE", accrualMonth: monthKey, leaveTypeId: type.id, leaveTypeCode: type.code, days: existing.days.toNumber(), existingLedgerId: existing.id });
      }
    }
  }
  return actions;
}

async function resolveEmployees(employeeIds: string[]) {
  const employees = await prisma.employee.findMany({
    where: { id: { in: employeeIds } },
    select: { id: true, employeeCode: true, dateOfJoining: true, nameHistory: { where: inForceOn(), select: { fullName: true } } },
  });
  if (employees.length !== employeeIds.length) {
    throw new HttpError(404, "One or more employees were not found.", "NOT_FOUND");
  }
  return employees;
}

export async function previewRecalculation(employeeIds: string[], fromDate: string, _meta: ActorMeta): Promise<RecalcEmployeeResult[]> {
  const employees = await resolveEmployees(employeeIds);
  const types = await accrualEnabledTypes();
  const fromMonth = startOfMonthUTC(new Date(fromDate));
  const throughMonth = startOfMonthUTC(businessToday());

  const results: RecalcEmployeeResult[] = [];
  for (const employee of employees) {
    const actions = await diffForEmployee(employee, types, fromMonth, throughMonth);
    results.push({ employeeId: employee.id, employeeCode: employee.employeeCode, employeeName: employee.nameHistory[0]?.fullName ?? employee.employeeCode, actions });
  }
  return results;
}

export async function commitRecalculation(employeeIds: string[], fromDate: string, meta: ActorMeta, options: { confirmText?: string }): Promise<RecalcEmployeeResult[]> {
  if (options.confirmText !== "APPLY RECALCULATION") {
    throw new HttpError(400, 'Type "APPLY RECALCULATION" to confirm — this writes ledger corrections for every selected employee.', "CONFIRMATION_REQUIRED");
  }
  const employees = await resolveEmployees(employeeIds);
  const types = await accrualEnabledTypes();
  const fromMonth = startOfMonthUTC(new Date(fromDate));
  const throughMonth = startOfMonthUTC(businessToday());

  const results: RecalcEmployeeResult[] = [];
  for (const employee of employees) {
    const actions = await withEmployeeLeaveLock(employee.id, async (tx) => {
      // Re-diffed inside the lock, against current ledger state — see the
      // module comment on why this replaces a "did preview go stale?" check.
      const fresh = await diffForEmployee(employee, types, fromMonth, throughMonth);
      for (const action of fresh) {
        const accrualMonth = new Date(`${action.accrualMonth}T00:00:00.000Z`);
        if (action.type === "CREDIT") {
          await writeLedgerEntry(tx, {
            employeeId: employee.id,
            leaveTypeId: action.leaveTypeId,
            leaveYear: accrualMonth.getUTCFullYear(),
            entryDate: accrualMonth,
            accrualMonth,
            entryType: "ACCRUAL",
            days: action.days,
            referenceType: "RECALCULATION",
            createdByUserId: meta.actorUserId,
            remarks: `Recalculator: backfilled ${action.leaveTypeCode} accrual for ${action.accrualMonth.slice(0, 7)}`,
          });
        } else {
          await writeLedgerEntry(tx, {
            employeeId: employee.id,
            leaveTypeId: action.leaveTypeId,
            leaveYear: accrualMonth.getUTCFullYear(),
            entryDate: businessToday(),
            entryType: "REVERSAL",
            days: -action.days,
            referenceType: "RECALCULATION",
            referenceId: action.existingLedgerId,
            createdByUserId: meta.actorUserId,
            remarks: `Recalculator: reversed ${action.leaveTypeCode} accrual for ${action.accrualMonth.slice(0, 7)} (no longer eligible)`,
          });
        }
      }
      return fresh;
    });

    if (actions.length > 0) {
      await writeAuditLog({ ...meta, action: "leave.recalculate.apply", entityType: "Employee", entityId: employee.id, after: { fromDate, actions } });
    }
    results.push({ employeeId: employee.id, employeeCode: employee.employeeCode, employeeName: employee.nameHistory[0]?.fullName ?? employee.employeeCode, actions });
  }
  return results;
}
