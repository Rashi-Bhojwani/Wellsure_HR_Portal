import { writeAuditLog } from "../../../lib/audit";
import { prisma } from "../../../lib/prisma";
import { permissionRoom, getSocketServer } from "../../../realtime/emit";
import { HttpError } from "../../../middleware/errorHandler";
import { consume, voidLive } from "../approvals";
import { recordEvent } from "../events";
import { assertRunIsReal } from "../rules/context";
import { reverifyRun, requireHolds } from "./closing";
import { computeRun } from "./engine";

// The two acts that change what is final, and the only code allowed to (docs/plans/PHASE_6.md §14F; payrollGuards.test.ts keeps it to this file).
//
//   finaliseRun   an approved run, with its period approved by a second person, becomes final. In ONE transaction: both approvals are used up, the adjustments the run
//                 paid are marked paid by it, the run becomes FINALISED and the period is locked. The database refuses the status change unless this transaction says
//                 (`payroll.finalising`) and both approvals are used.
//   unlockRun     a final run is set aside, the period is unlocked and what the run paid is owed again. The database refuses it unless this transaction says
//                 (`payroll.unlocking`), and refuses it outright once payslips were published or a bank file generated.
//
// Neither is done by the person who approved it: the checker decides, somebody else carries it out.

type Actor = { userId: string; ip?: string | null };

function emit(event: string, payload: Record<string, unknown>): void {
  getSocketServer()?.to(["payroll.run", "payroll.approve"].map(permissionRoom)).emit(event, payload);
}

export async function finaliseRun(runId: string, actor: Actor) {
  await requireHolds(actor.userId, "payroll.run");
  const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
  if (!run) throw new HttpError(404, "No such payroll run.", "NOT_FOUND");
  if (run.status !== "APPROVED") throw new HttpError(409, `This run is ${run.status === "FINALISED" ? "already final" : "not approved yet"}, so it cannot be finalised now.`, "RUN_STATE");
  const approvals = await prisma.payrollApproval.findMany({ where: { subjectId: runId, subject: { in: ["RUN_APPROVAL", "PERIOD_FINALISE"] }, status: "APPROVED" } });
  if (approvals.length !== 2) throw new HttpError(409, "The period has not been approved for closing yet.", "APPROVAL_REQUIRED");
  // On director authority the director who decided is the one who carries it out: that is the point. Otherwise the person who decides is never the person who does.
  if (approvals.some((a) => a.authority !== "DIRECTOR_AUTHORITY" && a.checkerUserId === actor.userId)) throw new HttpError(403, "You approved this, so somebody else carries out the finalising. The person who decides is never the person who does.", "CHECKER_IS_EXECUTOR");

  const computed = await computeRun({ start: run.cycleStart, end: run.cycleEnd, label: run.cycleLabel });
  if (computed.runHash !== run.runHash) {
    await reverifyRun(runId, "the figures no longer match what was approved", null);
    throw new HttpError(409, "The figures changed after they were approved, so the approval is void. They need to be submitted and approved again.", "APPROVAL_VOIDED");
  }
  await assertRunIsReal(computed.pins, "finalised");
  const left = computed.items.filter((i) => i.status === "EXCLUDED");
  if (left.length > 0) throw new HttpError(409, `${left.length} ${left.length === 1 ? "person is" : "people are"} left out of this run, so it cannot be finalised.`, "PEOPLE_LEFT_OUT");

  // The adjustments this run paid: every adjustment behind a line of a person who is in it. One without a row yet (an encashment committed since) is a change.
  const statusOf = new Map(computed.items.map((i) => [i.employeeId, i.status]));
  const paid = computed.inputs.people.filter((p) => statusOf.get(p.employeeId) !== "EXCLUDED").flatMap((p) => p.adjustments);
  const ids = paid.flatMap((a) => (a.id ? [a.id] : []));
  if (ids.length !== paid.length) throw new HttpError(409, "An adjustment was added since this run was calculated. Reopen it and calculate it again.", "RUN_STALE");

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('payroll.finalising', 'yes', true)`;
    await consume("PERIOD_FINALISE", runId, actor.userId, actor.ip ?? null, tx);
    await consume("RUN_APPROVAL", runId, actor.userId, actor.ip ?? null, tx);
    if (ids.length > 0) {
      const { count } = await tx.payrollAdjustment.updateMany({ where: { id: { in: ids }, status: "PENDING" }, data: { status: "CONSUMED", consumedByRunId: runId } });
      if (count !== ids.length) throw new HttpError(409, "An adjustment this run paid was cancelled or already paid by something else. Reopen the run and calculate it again.", "RUN_STALE");
    }
    const { count } = await tx.payrollRun.updateMany({ where: { id: runId, status: "APPROVED" }, data: { status: "FINALISED", finalisedAt: new Date(), finalisedByUserId: actor.userId } }); // allow-clock: an instant
    if (count !== 1) throw new HttpError(409, "This run was just changed by somebody else.", "CONFLICT");
    await tx.payrollPeriodLock.create({ data: { cycleStart: run.cycleStart, cycleEnd: run.cycleEnd, cycleLabel: run.cycleLabel, action: "FINALISE", runId, runHash: run.runHash!, actorUserId: actor.userId } });
    await recordEvent({ subjectType: "PAYROLL_RUN", subjectId: runId, type: "FINALISED", actorUserId: actor.userId, payload: { hash: run.runHash, adjustmentsPaid: ids.length } }, tx);
  });
  await writeAuditLog({ actorUserId: actor.userId, action: "payroll.run.finalised", entityType: "PayrollRun", entityId: runId, after: { cycle: run.cycleLabel, hash: run.runHash, adjustmentsPaid: ids.length }, ipAddress: actor.ip ?? null });
  emit("payroll.run.finalised", { runId, cycle: run.cycleLabel });
  return { id: runId, status: "FINALISED" as const, lockedFrom: run.cycleStart.toISOString().slice(0, 10), lockedTo: run.cycleEnd.toISOString().slice(0, 10), adjustmentsPaid: ids.length };
}

export async function unlockRun(runId: string, actor: Actor) {
  await requireHolds(actor.userId, "payroll.unlock");
  const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
  if (!run) throw new HttpError(404, "No such payroll run.", "NOT_FOUND");
  if (run.status !== "FINALISED") throw new HttpError(409, "This period is not final, so there is nothing to unlock.", "RUN_STATE");
  const approval = await prisma.payrollApproval.findFirst({ where: { subject: "PERIOD_UNLOCK", subjectId: runId, status: "APPROVED" } });
  if (!approval) throw new HttpError(409, "Unlocking has not been approved yet.", "APPROVAL_REQUIRED");
  if (approval.authority !== "DIRECTOR_AUTHORITY" && approval.checkerUserId === actor.userId) throw new HttpError(403, "You approved this, so somebody else carries out the unlocking. The person who decides is never the person who does.", "CHECKER_IS_EXECUTOR");
  const reason = approval.submitNote;

  const released = await prisma.payrollRunRelease.findMany({ where: { runId } });
  if (released.length > 0) {
    throw new HttpError(409, "Payslips have been published or a bank file generated for this period, so it cannot be unlocked. Put corrections through an adjustment in the next run.", "RUN_RELEASED");
  }

  const returned = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('payroll.unlocking', 'yes', true)`;
    await consume("PERIOD_UNLOCK", runId, actor.userId, actor.ip ?? null, tx);
    const { count } = await tx.payrollRun.updateMany({ where: { id: runId, status: "FINALISED" }, data: { status: "VOID", voidedAt: new Date(), voidedByUserId: actor.userId, voidReason: `Unlocked: ${reason}` } }); // allow-clock: an instant
    if (count !== 1) throw new HttpError(409, "This run was just changed by somebody else.", "CONFLICT");
    await tx.payrollPeriodLock.create({ data: { cycleStart: run.cycleStart, cycleEnd: run.cycleEnd, cycleLabel: run.cycleLabel, action: "UNLOCK", runId, runHash: run.runHash, reason, actorUserId: actor.userId } });
    const back = await tx.payrollAdjustment.updateMany({ where: { consumedByRunId: runId, status: "CONSUMED" }, data: { status: "PENDING", consumedByRunId: null } });
    for (const subject of ["PAYSLIP_PUBLISH", "BANK_FILE"] as const) await voidLive(subject, runId, "The period was unlocked.", actor.userId, tx);
    await recordEvent({ subjectType: "PAYROLL_RUN", subjectId: runId, type: "UNLOCKED", actorUserId: actor.userId, payload: { reason, adjustmentsReturned: back.count } }, tx);
    return back.count;
  });
  await writeAuditLog({ actorUserId: actor.userId, action: "payroll.run.unlocked", entityType: "PayrollRun", entityId: runId, after: { cycle: run.cycleLabel, reason, adjustmentsReturned: returned }, ipAddress: actor.ip ?? null });
  emit("payroll.run.unlocked", { runId, cycle: run.cycleLabel });
  return { id: runId, status: "VOID" as const, adjustmentsReturned: returned };
}
