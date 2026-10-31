import { Prisma } from "@prisma/client";
import { RUN_STATUS_LABEL } from "@shared/constants/payrollRun";
import { z } from "zod";
import { cycleForRules, loadCycleRules } from "../../../lib/attendanceCycle";
import { writeAuditLog } from "../../../lib/audit";
import { businessToday } from "../../../lib/businessDate";
import { namesOn } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { recordEvent } from "../events";
import { canonicalDecimal, dec } from "../money";
import { namesOfUsers } from "../names";
import { RuleContext, pinStatuses, watermarkFromStatuses, type RulePin, type Watermark } from "../rules/context";
import { employeeIdOfUser } from "../salary/guards";
import { reverifyRun } from "./closing";
import { computeRun, enqueueCalculation } from "./engine";
import { gatherRunInputs } from "./gather";
import { RulesMissingError, loadRunRules, type MissingRule } from "./rules";
import { iso } from "./days";
import { checkForRun } from "../inputs/service";
import { skippedForCycle } from "../exclusions/service";

// Payroll runs, the part that is not arithmetic (docs/plans/PHASE_6.md §14D): readiness, making a run, previewing and requesting a calculation, discarding a
// draft, reading a run. A run is made by the maker (payroll.run) and seen by anyone who can see salary (payroll.salary.view). Nothing here can make a run real.

const day = (s: string) => new Date(`${s}T00:00:00Z`);
export const cycleStartSchema = z.object({ cycleStart: z.iso.date() });

async function cycleOf(cycleStart: string) {
  const rules = await loadCycleRules();
  const cycle = cycleForRules(rules, day(cycleStart));
  if (iso(cycle.start) !== cycleStart) throw new HttpError(400, `${cycleStart} is not the first day of a payroll cycle. The cycle containing it starts on ${iso(cycle.start)}.`, "VALIDATION_ERROR");
  return cycle;
}

const m = (v: Prisma.Decimal | string) => canonicalDecimal(dec(v.toString()));

// ── Readiness ──

export async function readiness(cycleStart: string) {
  const cycle = await cycleOf(cycleStart);
  const today = businessToday();
  const ctx = await RuleContext.load();
  const inputs = await gatherRunInputs(cycle, ctx);
  let missing: MissingRule[] = [];
  try {
    loadRunRules(ctx, inputs.needs);
  } catch (err) {
    if (!(err instanceof RulesMissingError)) throw err;
    missing = err.missing;
  }
  const statuses = await pinStatuses(ctx.pins());
  const live = await prisma.payrollRun.findFirst({ where: { cycleStart: cycle.start, cycleEnd: cycle.end, status: { not: "VOID" } }, select: { id: true, status: true } });
  const names = await namesOn(inputs.people.map((p) => p.employeeId), cycle.end);
  const nameOf = (id: string) => names.get(id) ?? id;
  const LIMIT = 50;

  const unfinalised = inputs.people.filter((p) => p.missingDays.length > 0);
  const gaps = inputs.people.filter((p) => p.missingDays.length === 0 && p.salaryGapDays.length > 0);
  const noBank = inputs.people.filter((p) => !p.hasBankAccount);
  const adjustments = inputs.people.flatMap((p) => p.adjustments);
  const monthly = await checkForRun(iso(cycle.start), inputs.people.map((p) => p.employeeId));
  const cycleOver = cycle.end < today;
  return {
    cycle: { start: iso(cycle.start), end: iso(cycle.end), label: cycle.label },
    cycleOver,
    paymentDate: inputs.paymentDate ? iso(inputs.paymentDate) : null,
    people: inputs.people.length,
    attendance: { unfinalisedCount: unfinalised.length, unfinalised: unfinalised.slice(0, LIMIT).map((p) => ({ employeeId: p.employeeId, name: nameOf(p.employeeId), days: p.missingDays.length, firstDays: p.missingDays.slice(0, 5) })) },
    salary: { gapCount: gaps.length, gaps: gaps.slice(0, LIMIT).map((p) => ({ employeeId: p.employeeId, name: nameOf(p.employeeId), days: p.salaryGapDays.length, firstDays: p.salaryGapDays.slice(0, 5) })) },
    bank: { missingCount: noBank.length, missing: noBank.slice(0, LIMIT).map((p) => ({ employeeId: p.employeeId, name: nameOf(p.employeeId) })) },
    skipped: await skippedForCycle(cycle.start, cycle.end),
    monthlyInputs: {
      heads: monthly.heads.length,
      missingCount: monthly.missing.length,
      missing: monthly.missing.slice(0, LIMIT).map((x) => ({ employeeId: x.employeeId, name: x.name, employeeCode: x.employeeCode, head: x.headName })),
      notConfirmed: monthly.notConfirmed,
    },
    rules: {
      missing,
      placeholders: statuses.filter((s) => s.status === "PLACEHOLDER").map((s) => ({ key: s.pin.key, kind: s.pin.kind ?? "RULE", label: s.label, notSet: s.pin.unset === true })),
    },
    adjustments: {
      pending: adjustments.filter((a) => a.source === "MANUAL" || a.source === "IMPORT").length,
      arrears: adjustments.filter((a) => a.source === "SALARY_ARREARS").length,
      encashments: adjustments.filter((a) => a.source === "YEAR_END_ENCASHMENT").length,
      encashmentsPaidLater: inputs.encashmentsNotThisCycle.length,
    },
    existingRun: live ? { id: live.id, status: live.status } : null,
    canCreate: cycleOver && !live,
  };
}

// ── Making and discarding ──

export async function createRun(cycleStart: string, actor: { userId: string; ip?: string | null }) {
  const cycle = await cycleOf(cycleStart);
  if (cycle.end >= businessToday()) throw new HttpError(409, `The cycle ${cycle.label} runs to ${iso(cycle.end)}. Payroll is run after the cycle has ended and its attendance is finalised.`, "CYCLE_NOT_OVER");
  try {
    const run = await prisma.payrollRun.create({ data: { cycleStart: cycle.start, cycleEnd: cycle.end, cycleLabel: cycle.label, createdByUserId: actor.userId } });
    await recordEvent({ subjectType: "PAYROLL_RUN", subjectId: run.id, type: "CREATED", actorUserId: actor.userId, payload: { cycle: cycle.label } });
    await writeAuditLog({ actorUserId: actor.userId, action: "payroll.run.created", entityType: "PayrollRun", entityId: run.id, after: { cycle: cycle.label }, ipAddress: actor.ip ?? null });
    return { id: run.id };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new HttpError(409, `There is already a payroll run for ${cycle.label}. Open it, or discard it first.`, "RUN_EXISTS");
    throw err;
  }
}

export async function voidRun(runId: string, reason: string, actor: { userId: string; ip?: string | null }) {
  const why = reason.trim();
  if (why.length < 3) throw new HttpError(400, "Say why you are discarding it.", "VALIDATION_ERROR");
  const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
  if (!run) throw new HttpError(404, "No such payroll run.", "NOT_FOUND");
  const { count } = await prisma.payrollRun.updateMany({ where: { id: runId, status: { in: ["NEW", "CALCULATED", "FAILED"] } }, data: { status: "VOID", voidedAt: new Date(), voidedByUserId: actor.userId, voidReason: why } }); // allow-clock: an instant
  if (count !== 1) {
    throw new HttpError(
      409,
      run.status === "CALCULATING"
        ? "It is being calculated. Wait for that to finish, then discard it."
        : run.status === "SUBMITTED" || run.status === "APPROVED"
          ? "It has been sent for approval. Withdraw it from approval first, then it can be discarded."
          : run.status === "FINALISED"
            ? "A final run is never discarded. Unlock the period if it has to be corrected."
            : `A run that is ${RUN_STATUS_LABEL[run.status].toLowerCase()} cannot be discarded.`,
      "CONFLICT",
    );
  }
  await recordEvent({ subjectType: "PAYROLL_RUN", subjectId: runId, type: "VOIDED", actorUserId: actor.userId, payload: { reason: why } });
  await writeAuditLog({ actorUserId: actor.userId, action: "payroll.run.voided", entityType: "PayrollRun", entityId: runId, after: { reason: why, cycle: run.cycleLabel }, ipAddress: actor.ip ?? null });
}

// ── Calculating ──

async function loadRun(runId: string) {
  const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
  if (!run) throw new HttpError(404, "No such payroll run.", "NOT_FOUND");
  return run;
}

function refuseIfNotCalculable(status: string): void {
  if (status === "VOID" || status === "FINALISED") throw new HttpError(409, `A run that is ${RUN_STATUS_LABEL[status as keyof typeof RUN_STATUS_LABEL].toLowerCase()} is not calculated again.`, "CONFLICT");
  if (status === "SUBMITTED" || status === "APPROVED") throw new HttpError(409, "This run has been sent for approval, so it is not calculated again. Withdraw it from approval first (which voids the approval), then calculate.", "RUN_LOCKED_FOR_APPROVAL");
}

export async function previewCalculation(runId: string) {
  const run = await loadRun(runId);
  refuseIfNotCalculable(run.status);
  const computed = await computeRun({ start: run.cycleStart, end: run.cycleEnd, label: run.cycleLabel });
  const before = new Map((await prisma.payrollRunItem.findMany({ where: { runId } })).map((i) => [i.employeeId, i]));
  const names = await namesOn(computed.items.map((i) => i.employeeId), run.cycleEnd);
  const changes: Array<{ employeeId: string; name: string; change: "NEW" | "CHANGED"; netBefore: string | null; netAfter: string; netChange: string | null }> = [];
  let unchanged = 0;
  for (const i of computed.items) {
    const old = before.get(i.employeeId);
    if (old && old.itemHash === i.itemHash) unchanged += 1;
    else changes.push({ employeeId: i.employeeId, name: names.get(i.employeeId) ?? i.employeeId, change: old ? "CHANGED" : "NEW", netBefore: old ? m(old.netPay) : null, netAfter: canonicalDecimal(i.netPay), netChange: old ? canonicalDecimal(i.netPay.minus(dec(old.netPay.toString()))) : null });
  }
  const now = new Set(computed.items.map((i) => i.employeeId));
  const removed = [...before.keys()].filter((id) => !now.has(id));
  const watermark: Watermark = watermarkFromStatuses(await pinStatuses(computed.pins));
  const t = computed.totals;
  return {
    fingerprint: computed.runHash,
    first: run.runHash === null,
    status: run.status,
    cycle: run.cycleLabel,
    people: t.people,
    unchanged,
    changedCount: changes.length,
    removedCount: removed.length,
    changes: changes.slice(0, 100),
    totals: { gross: canonicalDecimal(t.gross), deductions: canonicalDecimal(t.deductions), net: canonicalDecimal(t.net), payable: t.payable, held: t.held, excluded: t.excluded, exceptions: t.exceptions },
    before: run.runHash ? { gross: m(run.totalGross), deductions: m(run.totalDeductions), net: m(run.totalNet) } : null,
    watermark,
    runNotices: runNotices(computed.rules.ptSlabs === null, computed.rules.lwfTable === null),
    willVoidApproval: false,
  };
}

export function runNotices(ptNotSet: boolean, lwfNotSet: boolean): string[] {
  const out = ["Income tax (TDS), loan recoveries and reimbursements are not calculated until Phase 7. Their lines are absent, not zero."];
  if (ptNotSet) out.push("Professional tax tables are not set up, so none is charged. Until they are set and confirmed this run is a test.");
  if (lwfNotSet) out.push("Labour welfare fund tables are not set up, so none is charged. Until they are set and confirmed this run is a test.");
  return out;
}

export async function requestCalculation(runId: string, fingerprint: string, actor: { userId: string; ip?: string | null }) {
  const run = await loadRun(runId);
  refuseIfNotCalculable(run.status);
  // Taken over after a crash: still marked as calculating, but the worker holding it has gone (its lease ran out).
  if (run.status === "CALCULATING") {
    if (run.leaseExpiresAt && run.leaseExpiresAt > new Date()) throw new HttpError(409, "It is being calculated right now.", "CONFLICT"); // allow-clock: an instant
    await enqueueCalculation(runId);
    return { id: runId, resumed: true };
  }
  const computed = await computeRun({ start: run.cycleStart, end: run.cycleEnd, label: run.cycleLabel });
  if (computed.runHash !== fingerprint) throw new HttpError(409, "Something changed since you looked (an attendance day, a salary, an adjustment or a rule). Look at the preview again.", "PREVIEW_STALE");
  const { count } = await prisma.payrollRun.updateMany({
    where: { id: runId, status: { in: ["NEW", "CALCULATED", "FAILED"] } },
    data: { status: "CALCULATING", calcVersion: { increment: 1 }, progressDone: 0, progressTotal: 0, leaseOwner: null, leaseExpiresAt: null, calculatedByUserId: actor.userId, failureReason: null },
  });
  if (count !== 1) throw new HttpError(409, "It is being calculated right now.", "CONFLICT");
  await recordEvent({ subjectType: "PAYROLL_RUN", subjectId: runId, type: "CALCULATION_REQUESTED", actorUserId: actor.userId, payload: { hash: computed.runHash } });
  await writeAuditLog({ actorUserId: actor.userId, action: "payroll.run.calculation_requested", entityType: "PayrollRun", entityId: runId, after: { cycle: run.cycleLabel, people: computed.totals.people }, ipAddress: actor.ip ?? null });
  await enqueueCalculation(runId);
  return { id: runId, resumed: false };
}

// ── Reading ──

const runRow = (r: Awaited<ReturnType<typeof loadRun>>) => ({
  id: r.id,
  cycle: { start: iso(r.cycleStart), end: iso(r.cycleEnd), label: r.cycleLabel },
  status: r.status,
  statusLabel: RUN_STATUS_LABEL[r.status],
  calcVersion: r.calcVersion,
  progress: { done: r.progressDone, total: r.progressTotal },
  totals: { gross: m(r.totalGross), deductions: m(r.totalDeductions), net: m(r.totalNet), employerCost: m(r.totalEmployerCost) },
  counts: { people: r.peopleCount, payable: r.payableCount, held: r.heldCount, excluded: r.excludedCount, exceptions: r.exceptionCount },
  runHash: r.runHash,
  calculatedAt: r.calculatedAt?.toISOString() ?? null,
  failureReason: r.failureReason,
  createdAt: r.createdAt.toISOString(),
  voidReason: r.voidReason,
  finalisedAt: r.finalisedAt?.toISOString() ?? null,
});

export async function listRuns(page: number, pageSize: number) {
  const [rows, total] = await Promise.all([prisma.payrollRun.findMany({ orderBy: [{ cycleStart: "desc" }, { createdAt: "desc" }], skip: (page - 1) * pageSize, take: pageSize }), prisma.payrollRun.count()]);
  const watermarks = await Promise.all(rows.map(async (r) => watermarkFromStatuses(await pinStatuses((r.pins as unknown as RulePin[]) ?? []))));
  return { total, items: rows.map((r, i) => ({ ...runRow(r), test: r.runHash !== null && watermarks[i]!.test })) };
}

export async function getRun(runId: string) {
  // A run waiting for a decision is only that while its figures are the ones it was submitted with: looking at it checks.
  await reverifyRun(runId, "the figures changed", null);
  const run = await loadRun(runId);
  const statuses = await pinStatuses((run.pins as unknown as RulePin[]) ?? []);
  const watermark = run.runHash === null ? { test: false, text: "", rules: [] } : watermarkFromStatuses(statuses);
  const [makers, events] = await Promise.all([namesOfUsers([run.createdByUserId, ...(run.calculatedByUserId ? [run.calculatedByUserId] : [])]), prisma.payrollEvent.findMany({ where: { subjectType: "PAYROLL_RUN", subjectId: runId }, orderBy: { createdAt: "desc" }, take: 20 })]);
  return {
    ...runRow(run),
    createdBy: makers.get(run.createdByUserId) ?? "Someone",
    calculatedBy: run.calculatedByUserId ? (makers.get(run.calculatedByUserId) ?? "Someone") : null,
    watermark,
    rules: statuses.map((s) => ({ key: s.pin.key, kind: s.pin.kind ?? "RULE", version: s.pin.version, label: s.label, status: s.status, stale: s.stale, notSet: s.pin.unset === true, frozen: s.pin.live === false })),
    stale: statuses.some((s) => s.stale),
    notices: runNotices(statuses.some((s) => s.pin.key === "PT_SLABS" && s.pin.unset), statuses.some((s) => s.pin.key === "LWF_TABLE" && s.pin.unset)),
    skipped: await skippedForCycle(run.cycleStart, run.cycleEnd),
    events: events.map((e) => ({ type: e.type, at: e.createdAt.toISOString() })),
  };
}

export const itemListSchema = z.object({
  status: z.enum(["PAYABLE", "HELD", "EXCLUDED"]).optional(),
  exceptionsOnly: z.enum(["true", "false"]).optional(),
  search: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export async function listItems(runId: string, q: z.infer<typeof itemListSchema>, viewerUserId: string) {
  const run = await loadRun(runId);
  const rows = await prisma.payrollRunItem.findMany({ where: { runId, ...(q.status ? { status: q.status } : {}) }, include: { employee: { select: { employeeCode: true } } }, orderBy: { employee: { employeeCode: "asc" } } });
  const names = await namesOn(rows.map((r) => r.employeeId), run.cycleEnd);
  const own = await employeeIdOfUser(viewerUserId);
  const needle = q.search?.toLowerCase();
  const filtered = rows.filter((r) => {
    if (q.exceptionsOnly === "true" && !(r.exceptions as unknown[]).length) return false;
    if (!needle) return true;
    return r.employee.employeeCode.toLowerCase().includes(needle) || (names.get(r.employeeId) ?? "").toLowerCase().includes(needle);
  });
  const page = filtered.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
  return {
    total: filtered.length,
    items: page.map((r) => ({
      employeeId: r.employeeId,
      employeeCode: r.employee.employeeCode,
      name: names.get(r.employeeId) ?? r.employee.employeeCode,
      isYou: own === r.employeeId,
      status: r.status,
      holdReason: r.holdReason,
      holdDetail: r.holdDetail,
      paidDays: m(r.paidDays),
      lopDays: m(r.lopDays),
      gross: m(r.gross),
      deductions: m(r.deductions),
      net: m(r.netPay),
      exceptions: (r.exceptions as Array<{ code: string; severity: string; message: string }>).length,
      blocking: (r.exceptions as Array<{ severity: string }>).some((x) => x.severity === "BLOCKING"),
    })),
  };
}

export async function getItem(runId: string, employeeId: string, viewerUserId: string) {
  const run = await loadRun(runId);
  const item = await prisma.payrollRunItem.findUnique({ where: { runId_employeeId: { runId, employeeId } }, include: { employee: { select: { employeeCode: true } }, lines: { orderBy: { sortOrder: "asc" } } } });
  if (!item) throw new HttpError(404, "That person is not in this run.", "NOT_FOUND");
  const names = await namesOn([employeeId], run.cycleEnd);
  const own = await employeeIdOfUser(viewerUserId);
  return {
    employeeId,
    employeeCode: item.employee.employeeCode,
    name: names.get(employeeId) ?? item.employee.employeeCode,
    isYou: own === employeeId,
    status: item.status,
    holdReason: item.holdReason,
    holdDetail: item.holdDetail,
    employedFrom: item.employedFrom ? iso(item.employedFrom) : null,
    employedTo: item.employedTo ? iso(item.employedTo) : null,
    days: { basis: m(item.basisDays), lopDivisor: m(item.lopDivisorDays), lop: m(item.lopDays), paid: m(item.paidDays) },
    totals: { gross: m(item.gross), deductions: m(item.deductions), employerContributions: m(item.employerContributions), netBeforeRounding: m(item.netBeforeRounding), roundingAdjustment: m(item.roundingAdjustment), net: m(item.netPay) },
    employmentType: item.employmentType,
    placement: item.placement,
    structure: item.structureKey ? { key: item.structureKey, version: item.structureVersion } : null,
    inputs: item.inputs,
    notices: item.notices,
    exceptions: item.exceptions,
    itemHash: item.itemHash,
    lines: item.lines.map((l) => ({ code: l.code, label: l.label, kind: l.kind, source: l.source, sourceRef: l.sourceRef, amount: m(l.amount), basis: l.basis })),
  };
}

