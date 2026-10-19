import { Prisma, type AdjustmentDirection } from "@prisma/client";
import { z } from "zod";
import { ARREARS_CODE } from "@shared/constants/payrollSalary";
import { businessToday } from "../../../lib/businessDate";
import { namesOn, notifyPayrollInputsChanged } from "../../../lib/effectiveDating";
import { writeAuditLog } from "../../../lib/audit";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { recordEvent } from "../events";
import { payrollHash } from "../hash";
import { currentVersions } from "../items";
import { canonicalDecimal, dec } from "../money";
import { assertNotOwnPay } from "./guards";
import type { ComponentValue } from "./schemas";

// One-off earnings and deductions HR adds before a run (a bonus, a recovery) (docs/plans/PHASE_6.md §5.4). Adding one is previewed and then confirmed against
// a fingerprint of exactly what was previewed. They are part of the run's hash, so a run approved before one was added is voided. Amounts never change after
// creation: cancel and add another. Arrears from a back-dated revision are created by the revision (salary/revisions.ts), never here.

export const adjustmentInputSchema = z
  .object({
    employeeId: z.string().min(1),
    componentCode: z.string().min(1).max(40),
    direction: z.enum(["EARNING", "DEDUCTION"]),
    amount: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "An amount in rupees, up to two decimal places"),
    reason: z.string().trim().min(3, "Say why").max(300),
  })
  .strict();
export type AdjustmentInput = z.infer<typeof adjustmentInputSchema>;

export interface AdjustmentPreview {
  employeeId: string;
  employeeName: string;
  componentCode: string;
  componentName: string;
  direction: AdjustmentDirection;
  amount: string;
  reason: string;
  /** Pending adjustments this person already has, so a duplicate is visible before it is added. */
  alreadyPending: Array<{ componentCode: string; direction: AdjustmentDirection; amount: string; reason: string }>;
  effect: string;
  fingerprint: string;
}

async function validate(input: AdjustmentInput, actorUserId: string) {
  if (input.componentCode === ARREARS_CODE) throw new HttpError(400, "Arrears are created by a salary revision, not added by hand.", "VALIDATION_ERROR");
  if (dec(input.amount).isZero()) throw new HttpError(400, "An adjustment cannot be zero.", "VALIDATION_ERROR");
  await assertNotOwnPay(actorUserId, [input.employeeId], "This adjustment");
  const employee = await prisma.employee.findUnique({ where: { id: input.employeeId }, select: { id: true, dateOfJoining: true, lastWorkingDate: true } });
  if (!employee) throw new HttpError(404, "That employee was not found.", "NOT_FOUND");
  const component = (await currentVersions("COMPONENT", [input.componentCode])).get(input.componentCode);
  if (!component) throw new HttpError(400, `There is no salary component ${input.componentCode}. Add it under Salary components first.`, "VALIDATION_ERROR");
  const value = component.value as ComponentValue;
  if (value.type === "EMPLOYER_CONTRIBUTION") throw new HttpError(400, "An employer contribution is not paid to the person, so it cannot be an adjustment.", "VALIDATION_ERROR");
  if (value.type !== input.direction) throw new HttpError(400, `${value.name} is a ${value.type.toLowerCase()}, so it can only be added as one.`, "VALIDATION_ERROR");
  return { employee, value };
}

const fingerprintOf = (input: AdjustmentInput) => payrollHash({ t: "ADJUSTMENT_ADD", e: input.employeeId, c: input.componentCode, d: input.direction, a: canonicalDecimal(dec(input.amount)), r: input.reason });

export async function previewAdjustment(rawInput: unknown, actorUserId: string): Promise<AdjustmentPreview> {
  const input = adjustmentInputSchema.parse(rawInput);
  const { value } = await validate(input, actorUserId);
  const pending = await prisma.payrollAdjustment.findMany({ where: { employeeId: input.employeeId, status: "PENDING" }, orderBy: { createdAt: "asc" } });
  const name = (await namesOn([input.employeeId], businessToday())).get(input.employeeId) ?? input.employeeId;
  return {
    employeeId: input.employeeId,
    employeeName: name,
    componentCode: input.componentCode,
    componentName: value.name,
    direction: input.direction,
    amount: canonicalDecimal(dec(input.amount)),
    reason: input.reason,
    alreadyPending: pending.map((p) => ({ componentCode: p.componentCode, direction: p.direction, amount: canonicalDecimal(dec(p.amount.toString())), reason: p.reason })),
    effect: `It is added to ${name}'s next payroll run as ${input.direction === "EARNING" ? "an earning" : "a deduction"}. It can be cancelled until a run uses it.`,
    fingerprint: fingerprintOf(input),
  };
}

export async function addAdjustment(rawInput: unknown, fingerprint: string, actor: { userId: string; ip?: string | null }): Promise<{ id: string }> {
  const input = adjustmentInputSchema.parse(rawInput);
  await validate(input, actor.userId);
  if (fingerprint !== fingerprintOf(input)) throw new HttpError(409, "What you are adding is different from what you previewed. Preview it again.", "PREVIEW_STALE");
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.payrollAdjustment.create({
      data: { employeeId: input.employeeId, componentCode: input.componentCode, direction: input.direction, amount: canonicalDecimal(dec(input.amount)), reason: input.reason, source: "MANUAL", createdByUserId: actor.userId },
    });
    await recordEvent({ subjectType: "ADJUSTMENT", subjectId: created.id, type: "ADDED", actorUserId: actor.userId, payload: { employeeId: input.employeeId, componentCode: input.componentCode, direction: input.direction, amount: canonicalDecimal(dec(input.amount)) } }, tx);
    return created;
  });
  await writeAuditLog({ actorUserId: actor.userId, action: "payroll.adjustment.added", entityType: "PayrollAdjustment", entityId: row.id, after: { employeeId: input.employeeId, componentCode: input.componentCode, direction: input.direction, source: "MANUAL" }, ipAddress: actor.ip ?? null });
  await notifyPayrollInputsChanged("an adjustment was added", actor.userId);
  return { id: row.id };
}

export async function cancelAdjustment(id: string, reason: string, actor: { userId: string; ip?: string | null }): Promise<void> {
  const why = reason.trim();
  if (why.length < 3) throw new HttpError(400, "Say why you are cancelling it.", "VALIDATION_ERROR");
  const adj = await prisma.payrollAdjustment.findUnique({ where: { id } });
  if (!adj) throw new HttpError(404, "That adjustment was not found.", "NOT_FOUND");
  await assertNotOwnPay(actor.userId, [adj.employeeId], "Cancelling this adjustment");
  if (adj.status !== "PENDING") throw new HttpError(409, `This adjustment is already ${adj.status.toLowerCase()}.`, "CONFLICT");
  try {
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.payrollAdjustment.updateMany({ where: { id, status: "PENDING" }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledByUserId: actor.userId, cancelReason: why } }); // allow-clock: an instant, not a business date
      if (count !== 1) throw new HttpError(409, "A run just used this adjustment, so it cannot be cancelled.", "CONFLICT");
      await recordEvent({ subjectType: "ADJUSTMENT", subjectId: id, type: "CANCELLED", actorUserId: actor.userId, payload: { reason: why } }, tx);
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) throw new HttpError(409, "This adjustment cannot be cancelled.", "CONFLICT");
    throw err;
  }
  await writeAuditLog({ actorUserId: actor.userId, action: "payroll.adjustment.cancelled", entityType: "PayrollAdjustment", entityId: id, before: { status: "PENDING" }, after: { status: "CANCELLED", reason: why }, ipAddress: actor.ip ?? null });
  await notifyPayrollInputsChanged("an adjustment was cancelled", actor.userId);
}

export async function listAdjustments(filter: { employeeId?: string; status?: "PENDING" | "CONSUMED" | "CANCELLED"; page: number; pageSize: number }) {
  const where = { ...(filter.employeeId ? { employeeId: filter.employeeId } : {}), ...(filter.status ? { status: filter.status } : {}) };
  const [rows, total] = await Promise.all([
    prisma.payrollAdjustment.findMany({ where, orderBy: { createdAt: "desc" }, skip: (filter.page - 1) * filter.pageSize, take: filter.pageSize, include: { employee: { select: { employeeCode: true } } } }),
    prisma.payrollAdjustment.count({ where }),
  ]);
  const names = await namesOn(rows.map((r) => r.employeeId), businessToday());
  return {
    total,
    items: rows.map((r) => ({
      id: r.id,
      employeeId: r.employeeId,
      employeeCode: r.employee.employeeCode,
      employeeName: names.get(r.employeeId) ?? r.employee.employeeCode,
      componentCode: r.componentCode,
      direction: r.direction,
      amount: canonicalDecimal(dec(r.amount.toString())),
      reason: r.reason,
      source: r.source,
      periodStart: r.periodStart?.toISOString().slice(0, 10) ?? null,
      periodEnd: r.periodEnd?.toISOString().slice(0, 10) ?? null,
      breakdown: r.breakdown,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      cancelReason: r.cancelReason,
    })),
  };
}
