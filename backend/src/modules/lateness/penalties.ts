import { createHash } from "node:crypto";
import { z } from "zod";
import { writeAuditLog } from "../../lib/audit";
import { requireDirector } from "../../lib/directorAuthority";
import { notifyPayrollInputsChanged } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { recordEvent } from "../payroll/events";
import { ZERO, canonicalDecimal, dec, max, roundTo, sum, type Money } from "../payroll/money";
import { reversalAmounts, type HeadForReversal } from "../payroll/salary/lopReversal";
import { employeeIdOfUser } from "../payroll/salary/guards";
import { monthEnd, monthOf } from "./service";

// Lateness penalties into the EXISTING deductions path (docs/plans/LATE_CHECKLIST.md §3): one PENDING payroll adjustment per penalised arrival (DEDUCTION, the
// directors' chosen deduction head), which the next run reads like any other deduction and prints as its own line. Directors only; never one's own pay.
//
// Higher-of with short hours: when the day also loses pay for short hours (or a missing punch), the penalty is compared with the rupee value of that loss of pay,
// worked out from the month's calculated run exactly as a loss-of-pay reversal values a day (prorated heads x days / the run's divisor). The line charged is
// max(0, penalty - that value): the day costs the higher of the two, never both added.

const day = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const REF = "late:";
export const postBody = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), fingerprint: z.string().min(16).max(128) }).strict();

/** The line to charge for a penalty when the day already lost `hoursValue` for short hours: never both added. */
export function penaltyToCharge(penalty: Money, hoursValue: Money): Money {
  return max(ZERO, penalty.minus(hoursValue));
}

export interface PenaltyRow {
  employeeId: string;
  employeeCode: string;
  name: string;
  date: string;
  time: string;
  bandLabel: string;
  penalty: string;
  hoursLop: string;
  hoursValue: string | null;
  charge: string | null;
  status: "TO_POST" | "POSTED" | "NOTHING_TO_CHARGE" | "NEEDS_CALCULATED_RUN" | "OWN_PAY" | "ALREADY_PAID";
  note: string;
  sourceRef: string | null;
}

/** The rupee value of `hours` days of loss of pay on `date`, from the calculated (not final) run whose cycle holds the date; null when there is none. */
async function hoursValueOn(employeeId: string, date: string, hours: Money): Promise<Money | null> {
  const run = await prisma.payrollRun.findFirst({ where: { status: { in: ["CALCULATED", "SUBMITTED", "APPROVED"] }, cycleStart: { lte: day(date) }, cycleEnd: { gte: day(date) } }, orderBy: { createdAt: "desc" }, select: { id: true } });
  if (!run) return null;
  const item = await prisma.payrollRunItem.findFirst({ where: { runId: run.id, employeeId, status: { not: "EXCLUDED" } }, select: { id: true, inputs: true } });
  const divisor = (item?.inputs as { days?: { lopDivisorDays?: string } } | undefined)?.days?.lopDivisorDays;
  if (!item || !divisor) return null;
  const lines = await prisma.payrollRunLine.findMany({ where: { runItemId: item.id, source: "COMPONENT", kind: "EARNING" }, select: { code: true, basis: true } });
  const heads: HeadForReversal[] = lines.map((l) => {
    const b = l.basis as { prorates?: boolean; parts?: Array<{ from: string; to: string; monthly: string }> };
    return { code: l.code, prorates: b.prorates === true, parts: b.parts ?? [] };
  });
  // A comparison, not a line: each head to the paisa, half up.
  const parts = reversalAmounts({ heads, days: [{ date, restored: canonicalDecimal(hours) }], divisor: dec(divisor), rounding: () => ({ mode: "HALF_UP", scale: 2 }) }); // allow-number: paise
  return sum(parts.map((p) => p.amount));
}

async function unpaidLeaveCodes(): Promise<Set<string>> {
  return new Set((await prisma.leaveType.findMany({ where: { isPaid: false }, select: { code: true } })).map((t) => t.code));
}

export async function penaltyPlan(actorUserId: string, month: string) {
  await requireDirector(actorUserId, "see lateness penalties");
  const own = await employeeIdOfUser(actorUserId);
  const everyone = await prisma.dailyAttendance.findMany({ where: { date: { gte: day(`${month}-01`), lte: day(monthEnd(month)) }, firstIn: { not: null } }, distinct: ["employeeId"], select: { employeeId: true } });
  const ids = everyone.map((e) => e.employeeId);
  const { rule, people } = await monthOf(ids, month, { amountsFor: new Set(ids) });
  const existing = await prisma.payrollAdjustment.findMany({ where: { source: "MANUAL", sourceRef: { startsWith: REF }, employeeId: { in: ids.length ? ids : ["-"] } }, select: { id: true, employeeId: true, sourceRef: true, status: true, amount: true } });
  const inMonth = existing.filter((x) => x.sourceRef!.split(":")[2]?.startsWith(month));
  const unpaid = await unpaidLeaveCodes();
  const rows: PenaltyRow[] = [];
  if (rule?.penaltyHead) {
    const dayRows = await prisma.dailyAttendance.findMany({ where: { employeeId: { in: ids }, date: { gte: day(`${month}-01`), lte: day(monthEnd(month)) } }, select: { employeeId: true, date: true, lopDays: true, firstHalfStatus: true, secondHalfStatus: true, isLocked: true } });
    for (const p of people) {
      for (const a of p.arrivals) {
        if (a.consequence.kind !== "PENALTY") continue;
        const d = dayRows.find((r) => r.employeeId === p.employeeId && iso(r.date) === a.date)!;
        const leaveLop = (unpaid.has(d.firstHalfStatus ?? "") ? 0.5 : 0) + (unpaid.has(d.secondHalfStatus ?? "") ? 0.5 : 0);
        const hours = max(ZERO, dec(d.lopDays.toString()).minus(dec(String(leaveLop)))); // allow-number: half days
        const penalty = dec(a.consequence.amount);
        const base = { employeeId: p.employeeId, employeeCode: p.employeeCode, name: p.name, date: a.date, time: a.time, bandLabel: a.bandLabel, penalty: canonicalDecimal(penalty), hoursLop: canonicalDecimal(hours) };
        const paid = inMonth.find((x) => x.employeeId === p.employeeId && x.sourceRef!.split(":")[2] === a.date && x.status === "CONSUMED");
        if (paid) {
          rows.push({ ...base, hoursValue: null, charge: canonicalDecimal(dec(paid.amount.toString())), status: "ALREADY_PAID", note: "Paid in a final run; a change now goes through the correction path.", sourceRef: paid.sourceRef });
          continue;
        }
        if (p.employeeId === own) {
          rows.push({ ...base, hoursValue: null, charge: null, status: "OWN_PAY", note: "Your own pay: the other director posts this.", sourceRef: null });
          continue;
        }
        let value: Money = ZERO;
        if (hours.greaterThan(ZERO)) {
          const v = await hoursValueOn(p.employeeId, a.date, hours);
          if (v === null) {
            rows.push({ ...base, hoursValue: null, charge: null, status: "NEEDS_CALCULATED_RUN", note: "The day also loses pay for short hours. Calculate the month's run first, so that loss can be valued (the higher of the two applies).", sourceRef: null });
            continue;
          }
          value = v;
        }
        const charge = roundTo(penaltyToCharge(penalty, value), 2, "HALF_UP"); // allow-number: paise
        if (charge.isZero()) {
          rows.push({ ...base, hoursValue: canonicalDecimal(value), charge: "0", status: "NOTHING_TO_CHARGE", note: "The day's loss of pay for short hours is worth at least the penalty, so only that applies.", sourceRef: null });
          continue;
        }
        const ref = `${REF}${p.employeeId}:${a.date}:${canonicalDecimal(charge)}`;
        const posted = inMonth.find((x) => x.sourceRef === ref && x.status === "PENDING");
        rows.push({ ...base, hoursValue: canonicalDecimal(value), charge: canonicalDecimal(charge), status: posted ? "POSTED" : "TO_POST", note: value.greaterThan(ZERO) ? `₹${canonicalDecimal(penalty)} less ₹${canonicalDecimal(value)} already lost that day for short hours: the higher applies.` : "", sourceRef: ref });
      }
    }
  }
  // Pending lines from an earlier posting that the plan no longer has (a waiver, a corrected day, a changed setting) are cancelled when posting.
  const wanted = new Set(rows.filter((r) => r.status === "TO_POST" || r.status === "POSTED").map((r) => r.sourceRef));
  const toCancel = inMonth.filter((x) => x.status === "PENDING" && !wanted.has(x.sourceRef)).map((x) => ({ id: x.id, sourceRef: x.sourceRef!, employeeId: x.employeeId }));
  const fingerprint = createHash("sha256").update(JSON.stringify({ month, rows: rows.map((r) => [r.employeeId, r.date, r.status, r.charge]), toCancel: toCancel.map((c) => c.id) })).digest("hex");
  return { month, active: rule !== null, penaltyHead: rule?.penaltyHead ?? null, rows, toCancel, fingerprint, blocked: rows.some((r) => r.status === "NEEDS_CALCULATED_RUN") };
}

export async function postPenalties(actor: { userId: string; ip?: string | null }, input: z.infer<typeof postBody>) {
  const plan = await penaltyPlan(actor.userId, input.month);
  if (plan.fingerprint !== input.fingerprint) throw new HttpError(409, "The penalties changed since you looked. Look again.", "PREVIEW_STALE");
  if (plan.blocked) throw new HttpError(409, "Some penalties fall on days that also lose pay for short hours. Calculate the month's run first.", "NEEDS_CALCULATED_RUN");
  const toPost = plan.rows.filter((r) => r.status === "TO_POST");
  await prisma.$transaction(async (tx) => {
    for (const c of plan.toCancel) {
      const { count } = await tx.payrollAdjustment.updateMany({ where: { id: c.id, status: "PENDING" }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledByUserId: actor.userId, cancelReason: "Lateness penalty no longer due (waived, corrected or the rule changed)" } }); // allow-clock: an instant
      if (count === 1) await recordEvent({ subjectType: "ADJUSTMENT", subjectId: c.id, type: "CANCELLED", actorUserId: actor.userId, payload: { reason: "lateness penalty no longer due" } }, tx);
    }
    for (const r of toPost) {
      const created = await tx.payrollAdjustment.create({
        data: { employeeId: r.employeeId, componentCode: plan.penaltyHead!, direction: "DEDUCTION", amount: r.charge!, reason: `Lateness penalty: arrived ${r.time} on ${r.date} (${r.bandLabel})`, source: "MANUAL", sourceRef: r.sourceRef, createdByUserId: actor.userId },
      });
      await recordEvent({ subjectType: "ADJUSTMENT", subjectId: created.id, type: "ADDED", actorUserId: actor.userId, payload: { employeeId: r.employeeId, componentCode: plan.penaltyHead, direction: "DEDUCTION", amount: r.charge, origin: "LATENESS" } }, tx);
    }
  });
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "attendance.lateness.penalties.posted", entityType: "LatenessMonth", entityId: input.month, after: { posted: toPost.length, cancelled: plan.toCancel.length } });
  if (toPost.length || plan.toCancel.length) await notifyPayrollInputsChanged("lateness penalties were posted", actor.userId);
  return { posted: toPost.length, cancelled: plan.toCancel.length };
}
