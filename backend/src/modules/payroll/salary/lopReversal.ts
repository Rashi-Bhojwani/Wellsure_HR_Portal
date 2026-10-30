import { Prisma } from "@prisma/client";
import { z } from "zod";
import { LOP_REVERSAL_CODE } from "@shared/constants/payrollSalary";
import { businessToday } from "../../../lib/businessDate";
import { writeAuditLog } from "../../../lib/audit";
import { namesOn, notifyPayrollInputsChanged } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { recordEvent } from "../events";
import { payrollHash } from "../hash";
import { ZERO, canonicalDecimal, dec, roundTo, sum, type Money, type RoundingMode } from "../money";
import { RuleContext, RuleNotSetError } from "../rules/context";
import { assertNotOwnPay } from "./guards";

// Loss-of-pay reversal and retro loss of pay (Stage 3.3b, docs/plans/PAYROLL_MODEL_PLAN.md). Attendance is corrected for a month whose run is already final.
// The final run is never touched. A director records the correction, naming the days and a reference for it; it becomes ONE pending adjustment of its own
// (source LOP_REVERSAL), which a later run pays as a line for each prorated head. The idempotency key is month + employee + correction reference: the same
// correction cannot be recorded twice, and a different correction cannot give back more loss of pay than the month had.
//
//   amount for a head on a day = that head's monthly amount in force on the day x days restored / the divisor the run used for loss of pay
// which is exactly the fraction the run took off for that day, so restoring a whole day gives back what the run took.

const RESTORE = /^-?(?:0|1)(?:\.5)?$/;

export const lopCorrectionInputSchema = z
  .object({
    employeeId: z.string().min(1),
    /** First day of the closed cycle the loss of pay belongs to. */
    cycleStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /** The reference of the attendance correction (or whatever the director calls it); with the month and the person it is the idempotency key. */
    correctionRef: z.string().trim().min(1).max(64),
    /** One row per day: 0.5 or 1 gives back loss of pay; -0.5 or -1 takes more (the correction found the person was absent after all). */
    days: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), restored: z.string().regex(RESTORE, "Half a day or a whole day, with a minus sign for more loss of pay") }).strict()).min(1).max(32),
    reason: z.string().trim().min(3, "Say why").max(200),
    /** Required when the correction is older than the look-back and the rule allows a director to override it. */
    overrideReason: z.string().trim().min(3).max(200).optional(),
  })
  .strict();
export type LopCorrectionInput = z.infer<typeof lopCorrectionInputSchema>;

/** Whole months from the start of the cycle's month to the month of `today`. */
export function monthsBack(cycleStart: string, today: string): number {
  const a = Number(cycleStart.slice(0, 4)) * 12 + Number(cycleStart.slice(5, 7)); // allow-number: a calendar month index, not money
  const b = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)); // allow-number: a calendar month index, not money
  return b - a;
}

export interface HeadPart {
  from: string;
  to: string;
  monthly: string;
}
export interface HeadForReversal {
  code: string;
  prorates: boolean;
  parts: HeadPart[];
}
export interface HeadAmount {
  component: string;
  /** Signed: positive is paid to the person. */
  amount: Money;
  /** The unrounded figure, to show the working. */
  exact: Money;
}

/**
 * What each prorated head gives back (or takes) for the days named. Exact fractions, rounded once per head by that head's rule. A day outside every part of a head
 * (the head was not in force) adds nothing for that head.
 */
export function reversalAmounts(input: {
  heads: readonly HeadForReversal[];
  days: ReadonlyArray<{ date: string; restored: string }>;
  divisor: Money;
  rounding: (code: string) => { mode: RoundingMode; scale: number };
}): HeadAmount[] {
  if (!input.divisor.greaterThan(ZERO)) throw new HttpError(409, "The month's loss-of-pay divisor is zero, so a day of it cannot be valued.", "LOP_DIVISOR_INVALID");
  const out: HeadAmount[] = [];
  for (const head of [...input.heads].sort((a, b) => a.code.localeCompare(b.code))) {
    if (!head.prorates) continue;
    // The products are added first and divided once, so that days which cancel (a day given back and the same day taken again) come to exactly nothing, never to a
    // speck of rounding that a mode such as FLOOR would turn into a rupee.
    let product = ZERO;
    for (const d of input.days) {
      const part = head.parts.find((p) => p.from <= d.date && d.date <= p.to);
      if (!part) continue;
      product = product.plus(dec(part.monthly).times(dec(d.restored)));
    }
    const exact = product.dividedBy(input.divisor);
    const r = input.rounding(head.code);
    const amount = roundTo(exact, r.scale, r.mode);
    if (!amount.isZero()) out.push({ component: head.code, amount, exact });
  }
  return out;
}

export interface LopCorrectionPreview {
  employeeId: string;
  employeeName: string;
  cycleLabel: string;
  correctionRef: string;
  key: string;
  days: Array<{ date: string; restored: string; hadLop: string }>;
  lines: Array<{ component: string; amount: string; exact: string }>;
  net: string;
  lookbackMonths: number;
  monthsBack: number;
  needsOverride: boolean;
  overrideReason: string | null;
  effect: string;
  fingerprint: string;
}

interface Resolved {
  employee: { id: string; employeeCode: string };
  cycle: { start: Date; end: Date; label: string };
  heads: HeadForReversal[];
  lopOnDay: Map<string, Money>;
  divisor: Money;
  rounding: (code: string) => { mode: RoundingMode; scale: number };
  lookback: number;
  overrideAllowed: boolean;
}

async function resolve(input: LopCorrectionInput, actorUserId: string): Promise<Resolved> {
  await assertNotOwnPay(actorUserId, [input.employeeId], "This correction");
  const employee = await prisma.employee.findUnique({ where: { id: input.employeeId }, select: { id: true, employeeCode: true } });
  if (!employee) throw new HttpError(404, "That employee was not found.", "NOT_FOUND");
  const run = await prisma.payrollRun.findFirst({ where: { status: "FINALISED", cycleStart: new Date(`${input.cycleStart}T00:00:00Z`) }, select: { id: true, cycleStart: true, cycleEnd: true, cycleLabel: true } });
  if (!run) throw new HttpError(409, "There is no finalised payroll run for that month. A correction to a month that is not yet final is simply made in attendance, and the run picks it up.", "NO_FINAL_RUN");
  const item = await prisma.payrollRunItem.findFirst({ where: { runId: run.id, employeeId: input.employeeId, status: { not: "EXCLUDED" } }, select: { id: true, inputs: true } });
  if (!item) throw new HttpError(409, `${employee.employeeCode} was not paid in ${run.cycleLabel}, so there is no loss of pay there to correct.`, "NOT_IN_RUN");
  const days = (item.inputs as { days?: { lopDivisorDays: string; lopByDay: Array<{ date: string; lop: string }> } }).days;
  if (!days) throw new HttpError(409, "That run has no record of the days, so a correction cannot be valued.", "NO_DAY_RECORD");

  const ctx = await RuleContext.load();
  let lookback: number;
  let overrideAllowed: boolean;
  let lineRule: { mode: RoundingMode | "NONE"; scale: number };
  try {
    lookback = ctx.rule<number>("LOP_REVERSAL_LOOKBACK_MONTHS");
    overrideAllowed = ctx.rule<boolean>("LOP_REVERSAL_OVERRIDE_ALLOWED");
    lineRule = ctx.rule<{ mode: RoundingMode | "NONE"; scale: number }>("LINE_ROUNDING");
  } catch (err) {
    if (err instanceof RuleNotSetError) throw new HttpError(409, err.message, "RULE_NOT_SET");
    throw err;
  }
  const perHead = ctx.ifSet<Record<string, { mode: RoundingMode | "NONE"; scale: number }>>("HEAD_ROUNDING") ?? {};
  const rounding = (code: string): { mode: RoundingMode; scale: number } => {
    const r = perHead[code] ?? lineRule;
    if (r.mode === "NONE") throw new HttpError(409, 'The rule "Rounding of salary lines" is set to no rounding, so a day of loss of pay cannot be turned into rupees. Choose a rounding mode for it.', "ROUNDING_NONE");
    return { mode: r.mode, scale: r.scale };
  };

  const lines = await prisma.payrollRunLine.findMany({ where: { runItemId: item.id, source: "COMPONENT" }, select: { code: true, basis: true } });
  const heads: HeadForReversal[] = lines.map((l) => {
    const b = l.basis as { prorates?: boolean; parts?: Array<{ from: string; to: string; monthly: string }> };
    return { code: l.code, prorates: b.prorates === true, parts: b.parts ?? [] };
  });
  return {
    employee,
    cycle: { start: run.cycleStart, end: run.cycleEnd, label: run.cycleLabel },
    heads,
    lopOnDay: new Map(days.lopByDay.map((d) => [d.date, dec(d.lop)])),
    divisor: dec(days.lopDivisorDays),
    rounding,
    lookback,
    overrideAllowed,
  };
}

const keyOf = (input: LopCorrectionInput) => `${input.cycleStart}:${input.employeeId}:${input.correctionRef}`;

async function alreadyRestored(employeeId: string, cycleStart: Date): Promise<Map<string, Money>> {
  const rows = await prisma.payrollAdjustment.findMany({ where: { employeeId, source: "LOP_REVERSAL", periodStart: cycleStart, status: { not: "CANCELLED" } }, select: { breakdown: true } });
  const by = new Map<string, Money>();
  for (const r of rows) for (const d of ((r.breakdown as { days?: Array<{ date: string; restored: string }> } | null)?.days ?? [])) by.set(d.date, (by.get(d.date) ?? ZERO).plus(dec(d.restored)));
  return by;
}

async function plan(rawInput: unknown, actorUserId: string): Promise<{ input: LopCorrectionInput; r: Resolved; preview: Omit<LopCorrectionPreview, "fingerprint" | "employeeName"> }> {
  const parsed = lopCorrectionInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const input = parsed.data;
  const r = await resolve(input, actorUserId);
  if (await prisma.payrollAdjustment.findUnique({ where: { source_sourceRef: { source: "LOP_REVERSAL", sourceRef: keyOf(input) } }, select: { id: true } })) {
    throw new HttpError(409, "That correction has already been recorded for this person and month. It is posted once.", "LOP_CORRECTION_DUPLICATE");
  }
  const dates = new Set<string>();
  const prior = await alreadyRestored(input.employeeId, r.cycle.start);
  const problems: string[] = [];
  for (const d of input.days) {
    if (dates.has(d.date)) problems.push(`${d.date} is listed twice.`);
    dates.add(d.date);
    if (d.date < r.cycle.start.toISOString().slice(0, 10) || d.date > r.cycle.end.toISOString().slice(0, 10)) problems.push(`${d.date} is not in ${r.cycle.label}.`);
    const had = r.lopOnDay.get(d.date) ?? ZERO;
    const after = had.minus(dec(d.restored)).minus(prior.get(d.date) ?? ZERO);
    if (after.isNegative() && dec(d.restored).greaterThan(ZERO)) problems.push(`${d.date} had ${canonicalDecimal(had)} of loss of pay in the run${(prior.get(d.date) ?? ZERO).isZero() ? "" : ` and ${canonicalDecimal(prior.get(d.date)!)} has already been given back`}, so ${d.restored} more cannot be restored.`);
    if (after.greaterThan(dec("1"))) problems.push(`${d.date} cannot carry more than one day of loss of pay.`);
  }
  if (problems.length) throw new HttpError(409, problems.join(" "), "LOP_CORRECTION_INVALID");
  const today = businessToday().toISOString().slice(0, 10);
  const back = monthsBack(input.cycleStart, today);
  const needsOverride = back > r.lookback;
  if (needsOverride) {
    if (!r.overrideAllowed) throw new HttpError(409, `${r.cycle.label} is ${back} months back, and loss of pay can be corrected only ${r.lookback} month${r.lookback === 1 ? "" : "s"} back. The rule allowing a director to override that is off.`, "LOP_LOOKBACK_EXCEEDED");
    if (!input.overrideReason) throw new HttpError(409, `${r.cycle.label} is ${back} months back, beyond the ${r.lookback} month${r.lookback === 1 ? "" : "s"} allowed. A director can override that by giving a reason.`, "LOP_OVERRIDE_REASON_REQUIRED");
  }
  const amounts = reversalAmounts({ heads: r.heads, days: input.days, divisor: r.divisor, rounding: r.rounding });
  const net = sum(amounts.map((a) => a.amount));
  if (amounts.length === 0 || net.isZero()) throw new HttpError(409, "These days come to nothing for any head that is reduced for loss of pay, so there is nothing to post.", "NOTHING_TO_POST");
  return {
    input,
    r,
    preview: {
      employeeId: input.employeeId,
      cycleLabel: r.cycle.label,
      correctionRef: input.correctionRef,
      key: keyOf(input),
      days: input.days.map((d) => ({ date: d.date, restored: d.restored, hadLop: canonicalDecimal(r.lopOnDay.get(d.date) ?? ZERO) })),
      lines: amounts.map((a) => ({ component: a.component, amount: canonicalDecimal(a.amount), exact: canonicalDecimal(a.exact) })),
      net: canonicalDecimal(net),
      lookbackMonths: r.lookback,
      monthsBack: back,
      needsOverride,
      overrideReason: needsOverride ? (input.overrideReason ?? null) : null,
      effect: `${net.isNegative() ? "Takes" : "Gives back"} ${canonicalDecimal(net.abs())} in the next payroll run as a line for each head, linked to ${r.cycle.label}. ${r.cycle.label}'s own run is not changed. It can be cancelled until a run uses it.`,
    },
  };
}

export async function previewLopCorrection(rawInput: unknown, actorUserId: string): Promise<LopCorrectionPreview> {
  const { input, r, preview } = await plan(rawInput, actorUserId);
  const name = (await namesOn([r.employee.id], businessToday())).get(r.employee.id) ?? r.employee.employeeCode;
  return { ...preview, employeeName: name, fingerprint: payrollHash({ t: "LOP_CORRECTION", k: preview.key, d: input.days, l: preview.lines, o: input.overrideReason ?? null, r: input.reason }) };
}

export async function addLopCorrection(rawInput: unknown, fingerprint: string, actor: { userId: string; ip?: string | null }): Promise<{ id: string }> {
  const { input, r, preview } = await plan(rawInput, actor.userId);
  const expected = payrollHash({ t: "LOP_CORRECTION", k: preview.key, d: input.days, l: preview.lines, o: input.overrideReason ?? null, r: input.reason });
  if (fingerprint !== expected) throw new HttpError(409, "What you are adding is different from what you previewed. Preview it again.", "PREVIEW_STALE");
  const net = dec(preview.net);
  const reason = `${input.reason}${preview.needsOverride ? ` (older than the ${preview.lookbackMonths}-month look-back; director override: ${input.overrideReason})` : ""}`;
  let row;
  try {
    row = await prisma.$transaction(async (tx) => {
      const created = await tx.payrollAdjustment.create({
        data: {
          employeeId: input.employeeId,
          componentCode: LOP_REVERSAL_CODE,
          direction: net.isNegative() ? "DEDUCTION" : "EARNING",
          amount: canonicalDecimal(net.abs()),
          reason,
          source: "LOP_REVERSAL",
          sourceRef: preview.key,
          periodStart: r.cycle.start,
          periodEnd: r.cycle.end,
          breakdown: { lines: preview.lines.map((l) => ({ component: l.component, amount: l.amount })), days: input.days.map((d) => ({ date: d.date, restored: d.restored })), correctionRef: input.correctionRef, overridden: preview.needsOverride } as unknown as Prisma.InputJsonValue,
          createdByUserId: actor.userId,
        },
      });
      await recordEvent({ subjectType: "ADJUSTMENT", subjectId: created.id, type: "ADDED", actorUserId: actor.userId, payload: { kind: "LOP_REVERSAL", employeeId: input.employeeId, cycleStart: input.cycleStart, correctionRef: input.correctionRef, overridden: preview.needsOverride } }, tx);
      return created;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new HttpError(409, "That correction has already been recorded for this person and month. It is posted once.", "LOP_CORRECTION_DUPLICATE");
    throw err;
  }
  await writeAuditLog({ actorUserId: actor.userId, action: "payroll.lop_correction.added", entityType: "PayrollAdjustment", entityId: row.id, after: { employeeId: input.employeeId, cycleStart: input.cycleStart, correctionRef: input.correctionRef, days: input.days.length, overridden: preview.needsOverride, amounts: "redacted" }, ipAddress: actor.ip ?? null });
  await notifyPayrollInputsChanged("a loss-of-pay correction was added", actor.userId);
  return { id: row.id };
}
