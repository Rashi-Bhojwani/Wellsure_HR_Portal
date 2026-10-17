import { Prisma } from "@prisma/client";
import { PAYROLL_CALCULATE_QUEUE, payrollCalculateQueue } from "../../../jobs/payrollQueues";
import { logger } from "../../../lib/logger";
import { prisma } from "../../../lib/prisma";
import { permissionRoom, getSocketServer } from "../../../realtime/emit";
import { HttpError } from "../../../middleware/errorHandler";
import { recordEvent } from "../events";
import { payrollHash } from "../hash";
import { canonicalDecimal, sum, type Money } from "../money";
import { RuleContext, pinStatuses, type RulePin } from "../rules/context";
import { committedEncashments } from "../../leave/payrollReader";
import { gatherRunInputs, inputsFingerprint, type RunInputs } from "./gather";
import { calculatePerson } from "./person";
import { loadRunRules, type RunRules } from "./rules";
import type { CalcContext, ItemOut } from "./types";

// Running a calculation (docs/plans/PHASE_6.md §14D): a lease on the run so two calculations cannot overlap, the whole run worked out in memory from what the
// readers returned, and then written in chunks of people, each chunk in one transaction and stamped with the run's calculation version. A worker killed half
// way leaves some people stamped; the next one starts from the same inputs, sees the stamps, and writes only the rest. If the rules or the inputs have moved
// in the meantime the stamps are worthless and the version is bumped, so one run never holds two rule sets.

const CHUNK = 50;
const LEASE_MS = 120_000;

type Enqueuer = (runId: string) => Promise<void>;
let enqueuer: Enqueuer = async (runId) => {
  await payrollCalculateQueue().add("calculate", { runId }, { jobId: `${PAYROLL_CALCULATE_QUEUE}:${runId}:${Date.now()}`, attempts: 1, removeOnComplete: true, removeOnFail: 1000 }); // allow-clock: a job id, not a business date
};
/** Tests replace the queue so a calculation can be run directly, or watched without running. */
export function setCalculationEnqueuer(fn: Enqueuer | null): void {
  enqueuer = fn ?? (async (runId) => void (await payrollCalculateQueue().add("calculate", { runId }, { attempts: 1, removeOnComplete: true, removeOnFail: 1000 })));
}
export const enqueueCalculation = (runId: string) => enqueuer(runId);

export interface Computed {
  inputs: RunInputs;
  rules: RunRules;
  items: ItemOut[];
  pins: RulePin[];
  rulesFingerprint: string;
  inputsFingerprint: string;
  runHash: string;
  totals: RunTotals;
}

export interface RunTotals {
  gross: Money;
  deductions: Money;
  net: Money;
  employerCost: Money;
  people: number;
  payable: number;
  held: number;
  excluded: number;
  exceptions: number;
}

export function totalsOf(items: readonly ItemOut[]): RunTotals {
  const calculated = items.filter((i) => i.status !== "EXCLUDED");
  return {
    gross: sum(calculated.map((i) => i.gross)),
    deductions: sum(calculated.map((i) => i.deductions)),
    net: sum(calculated.map((i) => i.netPay)),
    employerCost: sum(calculated.map((i) => i.employerContributions)),
    people: items.length,
    payable: items.filter((i) => i.status === "PAYABLE").length,
    held: items.filter((i) => i.status === "HELD").length,
    excluded: items.filter((i) => i.status === "EXCLUDED").length,
    exceptions: items.filter((i) => i.exceptions.some((x) => x.severity === "BLOCKING")).length,
  };
}

/** Works out the whole run in memory: gathers through the readers, reads the rules (pinning them), calculates each person. Writes nothing. */
export async function computeRun(cycle: { start: Date; end: Date; label: string }): Promise<Computed> {
  const ctx = await RuleContext.load();
  const inputs = await gatherRunInputs(cycle, ctx);
  const rules = loadRunRules(ctx, inputs.needs);
  if (rules.lineRounding.mode === "NONE") {
    throw new HttpError(409, 'The rule "Rounding of salary lines" is set to no rounding, so a pro-rated line cannot be worked out. Choose a rounding mode and a number of decimal places for it.', "ROUNDING_NONE");
  }
  const calc: CalcContext = { cycle, payrollMonth: inputs.payrollMonth, rules, components: inputs.components };
  const items = inputs.people.map((p) => calculatePerson(p, calc));
  const pins = ctx.pins();
  const fingerprintOfRules = payrollHash(ctx.versions());
  const runHash = payrollHash({ cycle: [cycle.start, cycle.end], pins, items: items.map((i) => [i.employeeId, i.itemHash]), adjustments: inputs.people.flatMap((p) => p.adjustments.map((a) => [a.id, a.sourceRef, canonicalDecimal(a.amount)])) });
  return { inputs, rules, items, pins, rulesFingerprint: fingerprintOfRules, inputsFingerprint: inputsFingerprint(inputs), runHash, totals: totalsOf(items) };
}

const toJson = (v: unknown) => v as Prisma.InputJsonValue;
const m = (v: Money) => canonicalDecimal(v);

function itemData(runId: string, version: number, i: ItemOut) {
  return {
    runId,
    employeeId: i.employeeId,
    calcVersion: version,
    status: i.status,
    holdReason: i.holdReason,
    holdDetail: i.holdDetail,
    employedFrom: i.employedFrom,
    employedTo: i.employedTo,
    basisDays: m(i.basisDays),
    lopDivisorDays: m(i.lopDivisorDays),
    lopDays: m(i.lopDays),
    paidDays: i.paidDays.toDecimalPlaces(6).toFixed(),
    gross: m(i.gross),
    deductions: m(i.deductions),
    employerContributions: m(i.employerContributions),
    netBeforeRounding: m(i.netBeforeRounding),
    roundingAdjustment: m(i.roundingAdjustment),
    netPay: m(i.netPay),
    employmentType: i.employmentType,
    placement: toJson(i.placement),
    structureKey: i.structureKey,
    structureVersion: i.structureVersion,
    inputs: toJson(i.inputs),
    notices: toJson(i.notices),
    exceptions: toJson(i.exceptions),
    itemHash: i.itemHash,
  };
}

function emitProgress(runId: string, payload: Record<string, unknown>): void {
  getSocketServer()?.to(permissionRoom("payroll.run")).emit("payroll.run.progress", { runId, ...payload });
}

/** Makes sure every committed year-end item has its pending adjustment row (the unique source reference means it can exist only once). */
async function ensureEncashmentAdjustments(actorUserId: string): Promise<void> {
  const items = await committedEncashments();
  if (items.length === 0) return;
  await prisma.payrollAdjustment.createMany({
    data: items.map((item) => ({
      employeeId: item.employeeId,
      componentCode: "LEAVE_ENCASHMENT",
      direction: "EARNING" as const,
      amount: item.amount,
      reason: `Year-end ${item.leaveYear} leave encashment: ${item.days} day(s) at ${item.dailyRate} (${item.rateSource})`,
      source: "YEAR_END_ENCASHMENT" as const,
      sourceRef: item.itemId,
      createdByUserId: actorUserId,
    })),
    skipDuplicates: true,
  });
}

/** The calculation job. Safe to call twice at once (the lease) and to call again after a crash (the stamps). */
export async function executeCalculation(runId: string, owner = "direct"): Promise<void> {
  const leaseUntil = () => new Date(Date.now() + LEASE_MS); // allow-clock: a lease expiry instant, not a business date
  const now = () => new Date(); // allow-clock: an instant
  const took = await prisma.payrollRun.updateMany({
    where: { id: runId, status: "CALCULATING", OR: [{ leaseOwner: null }, { leaseOwner: owner }, { leaseExpiresAt: { lt: now() } }] },
    data: { leaseOwner: owner, leaseExpiresAt: leaseUntil() },
  });
  if (took.count !== 1) return; // somebody else is calculating it, or it is not waiting to be calculated

  try {
    const run = await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } });
    const cycle = { start: run.cycleStart, end: run.cycleEnd, label: run.cycleLabel };
    await ensureEncashmentAdjustments(run.calculatedByUserId ?? run.createdByUserId);
    const computed = await computeRun(cycle);

    // Resuming? Only if the rules and the inputs are exactly what the stamped people were calculated from.
    let version = run.calcVersion;
    const sameWorld = run.rulesFingerprint === computed.rulesFingerprint && run.inputsFingerprint === computed.inputsFingerprint;
    if (run.rulesFingerprint !== null && !sameWorld) version += 1;
    await prisma.payrollRun.update({ where: { id: runId }, data: { calcVersion: version, rulesFingerprint: computed.rulesFingerprint, inputsFingerprint: computed.inputsFingerprint, progressTotal: computed.items.length, progressDone: sameWorld ? run.progressDone : 0, leaseExpiresAt: leaseUntil() } });

    const stamped = sameWorld ? new Set((await prisma.payrollRunItem.findMany({ where: { runId, calcVersion: version }, select: { employeeId: true } })).map((r) => r.employeeId)) : new Set<string>();
    const todo = computed.items.filter((i) => !stamped.has(i.employeeId));
    let done = computed.items.length - todo.length;
    for (let at = 0; at < todo.length; at += CHUNK) {
      const chunk = todo.slice(at, at + CHUNK);
      await prisma.$transaction(async (tx) => {
        for (const i of chunk) {
          await tx.payrollRunLine.deleteMany({ where: { runId, employeeId: i.employeeId } });
          const row = await tx.payrollRunItem.upsert({ where: { runId_employeeId: { runId, employeeId: i.employeeId } }, create: itemData(runId, version, i), update: itemData(runId, version, i), select: { id: true } });
          if (i.lines.length) {
            await tx.payrollRunLine.createMany({
              data: i.lines.map((l, order) => ({ runId, runItemId: row.id, employeeId: i.employeeId, sortOrder: order, code: l.code, label: l.label, kind: l.kind, source: l.source, sourceRef: l.sourceRef, amount: m(l.amount), basis: toJson(l.basis) })),
            });
          }
        }
      });
      done += chunk.length;
      await prisma.payrollRun.update({ where: { id: runId }, data: { progressDone: done, leaseExpiresAt: leaseUntil() } });
      emitProgress(runId, { done, total: computed.items.length });
    }

    // People who are no longer in the run (they left before the cycle began, say) were not touched by this version: they go.
    await prisma.payrollRunItem.deleteMany({ where: { runId, calcVersion: { not: version } } });
    const t = computed.totals;
    await prisma.$transaction(async (tx) => {
      await tx.payrollRun.update({
        where: { id: runId },
        data: {
          status: "CALCULATED",
          pins: toJson(computed.pins),
          runHash: computed.runHash,
          totalGross: m(t.gross),
          totalDeductions: m(t.deductions),
          totalNet: m(t.net),
          totalEmployerCost: m(t.employerCost),
          peopleCount: t.people,
          payableCount: t.payable,
          heldCount: t.held,
          excludedCount: t.excluded,
          exceptionCount: t.exceptions,
          calculatedAt: now(),
          failureReason: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          progressDone: computed.items.length,
        },
      });
      await recordEvent({ subjectType: "PAYROLL_RUN", subjectId: runId, type: "CALCULATED", actorUserId: run.calculatedByUserId, payload: { hash: computed.runHash, people: t.people, version } }, tx);
    });
    emitProgress(runId, { done: computed.items.length, total: computed.items.length, status: "CALCULATED" });
  } catch (err) {
    const reason = err instanceof HttpError ? err.message : "The calculation stopped unexpectedly. Nothing was changed; try again, and tell whoever looks after the system if it keeps happening.";
    if (!(err instanceof HttpError)) logger.error({ err, runId }, "payroll calculation failed");
    await prisma.payrollRun.updateMany({ where: { id: runId, status: "CALCULATING" }, data: { status: "FAILED", failureReason: reason, leaseOwner: null, leaseExpiresAt: null } });
    await recordEvent({ subjectType: "PAYROLL_RUN", subjectId: runId, type: "CALCULATION_FAILED", actorUserId: null, payload: { reason } });
    emitProgress(runId, { status: "FAILED", reason });
  }
}

/** The status of every pin of a run, now: used by the run screens and the gates. */
export const pinStatusesOf = (pins: unknown) => pinStatuses((pins as RulePin[]) ?? []);

