import { Prisma } from "@prisma/client";
import { z } from "zod";
import { HOLD_RELEASE_CODE } from "@shared/constants/payrollSalary";
import { businessToday } from "../../../lib/businessDate";
import { writeAuditLog } from "../../../lib/audit";
import { loadCycleRules, cycleForRules } from "../../../lib/attendanceCycle";
import { namesOn, notifyPayrollInputsChanged } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { recordEvent } from "../events";
import { canonicalDecimal, dec } from "../money";
import { assertNotOwnPay } from "./guards";

// Hold salary and release it (Stage 3.3c, docs/plans/PAYROLL_MODEL_PLAN.md). A director holds one person's salary for one month, with a reason. The run still
// calculates them, but marks them HELD ("Salary held by a director") so they are not in the bank file and get no payslip. A release is also a director's act:
//   - before the held month's run is final, it simply lifts the hold (the next calculation pays them as usual);
//   - after it is final, it creates ONE pending adjustment (source HOLD_RELEASE) for the held net pay, paid in the next run as a line of its own.
// The final run is never changed. Both records are append-only and only a Super Admin can write them (a database trigger holds that too).

export const holdInputSchema = z
  .object({
    employeeId: z.string().min(1),
    /** First day of the payroll period (attendance cycle) the hold is for. */
    cycleStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: z.string().trim().min(3, "Say why").max(200),
  })
  .strict();
export const releaseInputSchema = z.object({ note: z.string().trim().min(3, "Say why it is released").max(200) }).strict();

const parse = <T>(schema: z.ZodType<T>, raw: unknown): T => {
  const r = schema.safeParse(raw);
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  return r.data;
};

export async function addHold(raw: unknown, actor: { userId: string; ip?: string | null }): Promise<{ id: string }> {
  const input = parse(holdInputSchema, raw);
  await assertNotOwnPay(actor.userId, [input.employeeId], "This hold");
  const employee = await prisma.employee.findUnique({ where: { id: input.employeeId }, select: { id: true } });
  if (!employee) throw new HttpError(404, "That employee was not found.", "NOT_FOUND");
  const start = new Date(`${input.cycleStart}T00:00:00Z`);
  const cycle = cycleForRules(await loadCycleRules(), start);
  if (cycle.start.getTime() !== start.getTime()) throw new HttpError(400, `${input.cycleStart} is not the first day of a payroll period. The period that contains it starts on ${cycle.start.toISOString().slice(0, 10)}.`, "VALIDATION_ERROR");
  if (await prisma.payrollRun.findFirst({ where: { cycleStart: start, status: "FINALISED" }, select: { id: true } })) {
    throw new HttpError(409, `The run for ${cycle.label} is already final, so its pay cannot be held now. A final run is never changed.`, "RUN_FINAL");
  }
  try {
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.payrollSalaryHold.create({ data: { employeeId: input.employeeId, cycleStart: start, reason: input.reason, heldByUserId: actor.userId } });
      await recordEvent({ subjectType: "SALARY_HOLD", subjectId: created.id, type: "HELD", actorUserId: actor.userId, payload: { employeeId: input.employeeId, cycleStart: input.cycleStart } }, tx);
      return created;
    });
    await writeAuditLog({ actorUserId: actor.userId, action: "payroll.salary_hold.added", entityType: "PayrollSalaryHold", entityId: row.id, after: { employeeId: input.employeeId, cycleStart: input.cycleStart }, ipAddress: actor.ip ?? null });
    await notifyPayrollInputsChanged("a salary was held", actor.userId);
    return { id: row.id };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new HttpError(409, "That person's salary for that month is already held (or was, and has been released). A month is held once.", "HOLD_EXISTS");
    throw err;
  }
}

export async function releaseHold(holdId: string, raw: unknown, actor: { userId: string; ip?: string | null }): Promise<{ id: string; adjustmentId: string | null }> {
  const { note } = parse(releaseInputSchema, raw);
  const hold = await prisma.payrollSalaryHold.findUnique({ where: { id: holdId }, include: { release: true } });
  if (!hold) throw new HttpError(404, "That hold was not found.", "NOT_FOUND");
  await assertNotOwnPay(actor.userId, [hold.employeeId], "This release");
  if (hold.release) throw new HttpError(409, "That hold has already been released.", "ALREADY_RELEASED");
  const run = await prisma.payrollRun.findFirst({ where: { cycleStart: hold.cycleStart, status: "FINALISED" }, select: { id: true, cycleStart: true, cycleEnd: true, cycleLabel: true } });
  let amount = null as ReturnType<typeof dec> | null;
  if (run) {
    const item = await prisma.payrollRunItem.findFirst({ where: { runId: run.id, employeeId: hold.employeeId }, select: { status: true, holdReason: true, netPay: true } });
    if (!item || item.status !== "HELD" || item.holdReason !== "DIRECTOR_HOLD") {
      throw new HttpError(409, `The final run for ${run.cycleLabel} did not hold this person's pay for this reason (it was ${item ? "paid or held for another reason" : "not calculated for them"}), so there is nothing to release.`, "NOTHING_TO_RELEASE");
    }
    amount = dec(item.netPay.toString());
    if (!amount.greaterThan(dec("0"))) throw new HttpError(409, `The held net pay for ${run.cycleLabel} is nil, so there is nothing to pay on release.`, "NOTHING_TO_RELEASE");
  }
  const result = await prisma.$transaction(async (tx) => {
    let adjustmentId: string | null = null;
    if (run && amount) {
      const adj = await tx.payrollAdjustment.create({
        data: {
          employeeId: hold.employeeId,
          componentCode: HOLD_RELEASE_CODE,
          direction: "EARNING",
          amount: canonicalDecimal(amount),
          reason: `Held salary released: ${note}`,
          source: "HOLD_RELEASE",
          sourceRef: hold.id,
          periodStart: run.cycleStart,
          periodEnd: run.cycleEnd,
          createdByUserId: actor.userId,
        },
      });
      adjustmentId = adj.id;
    }
    const rel = await tx.payrollSalaryRelease.create({ data: { holdId: hold.id, note, releasedByUserId: actor.userId, adjustmentId } });
    await recordEvent({ subjectType: "SALARY_HOLD", subjectId: hold.id, type: "RELEASED", actorUserId: actor.userId, payload: { employeeId: hold.employeeId, adjustmentId } }, tx);
    return { id: rel.id, adjustmentId };
  });
  await writeAuditLog({ actorUserId: actor.userId, action: "payroll.salary_hold.released", entityType: "PayrollSalaryHold", entityId: hold.id, after: { employeeId: hold.employeeId, paidLater: result.adjustmentId !== null, amounts: "redacted" }, ipAddress: actor.ip ?? null });
  await notifyPayrollInputsChanged("a held salary was released", actor.userId);
  return result;
}

export interface HoldRow {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  cycleStart: string;
  reason: string;
  heldAt: string;
  status: "HELD" | "RELEASED";
  releasedAt: string | null;
  releaseNote: string | null;
  /** True when the held month's run is final and the release pays it in a later run (or will, if it is still held). */
  runFinal: boolean;
}

export async function listHolds(filter: { status?: "HELD" | "RELEASED" }): Promise<HoldRow[]> {
  const rows = await prisma.payrollSalaryHold.findMany({
    where: filter.status === "HELD" ? { release: null } : filter.status === "RELEASED" ? { release: { isNot: null } } : {},
    include: { release: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const employees = await prisma.employee.findMany({ where: { id: { in: rows.map((r) => r.employeeId) } }, select: { id: true, employeeCode: true } });
  const code = new Map(employees.map((e) => [e.id, e.employeeCode]));
  const names = await namesOn(rows.map((r) => r.employeeId), businessToday());
  const finalRuns = new Set((await prisma.payrollRun.findMany({ where: { status: "FINALISED", cycleStart: { in: rows.map((r) => r.cycleStart) } }, select: { cycleStart: true } })).map((r) => r.cycleStart.toISOString().slice(0, 10)));
  return rows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    employeeCode: code.get(r.employeeId) ?? r.employeeId,
    employeeName: names.get(r.employeeId) ?? code.get(r.employeeId) ?? r.employeeId,
    cycleStart: r.cycleStart.toISOString().slice(0, 10),
    reason: r.reason,
    heldAt: r.createdAt.toISOString(),
    status: r.release ? "RELEASED" : "HELD",
    releasedAt: r.release?.createdAt.toISOString() ?? null,
    releaseNote: r.release?.note ?? null,
    runFinal: finalRuns.has(r.cycleStart.toISOString().slice(0, 10)),
  }));
}

/**
 * What is held and not yet released for a person, month by month, with the net pay each month's final run held. This is what full-and-final settlement will read
 * (there is no settlement module yet, so nothing calls it today). A month whose run is not final yet has no amount: it is not worked out until the run is final.
 */
export async function outstandingHeldPay(employeeId: string): Promise<Array<{ holdId: string; cycleStart: string; netPay: string | null }>> {
  const holds = await prisma.payrollSalaryHold.findMany({ where: { employeeId, release: null }, orderBy: { cycleStart: "asc" } });
  const out: Array<{ holdId: string; cycleStart: string; netPay: string | null }> = [];
  for (const h of holds) {
    const item = await prisma.payrollRunItem.findFirst({ where: { employeeId, status: "HELD", holdReason: "DIRECTOR_HOLD", run: { status: "FINALISED", cycleStart: h.cycleStart } }, select: { netPay: true } });
    out.push({ holdId: h.id, cycleStart: h.cycleStart.toISOString().slice(0, 10), netPay: item ? canonicalDecimal(dec(item.netPay.toString())) : null });
  }
  return out;
}
