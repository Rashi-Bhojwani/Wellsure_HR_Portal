import type { Prisma, SalaryChangeReason } from "@prisma/client";
import { z } from "zod";
import { ITEM_CODE_PATTERN } from "@shared/constants/payrollSalary";
import { loadCycleRules, cycleForRules } from "../../../lib/attendanceCycle";
import { writeAuditLog } from "../../../lib/audit";
import { businessToday } from "../../../lib/businessDate";
import {
  employeeIdsOnStructure,
  employeeIdsPlacedOn,
  employedOn,
  latestSalaries,
  lockEmployees,
  maxScheduleAheadDays,
  namesOn,
  planTimelineChange,
  salaryHistory,
  salaryRowsOfRevision,
  writeBackdatedSalaryChange,
  writeSalaryChange,
  type SalaryWithLines,
} from "../../../lib/effectiveDating";
import { activeUsersHoldingPermission } from "../../../lib/permissions";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { adapterFor, availabilityFrom, consume, decide, liveApproval, registerSubject, submit, voidApproval, voidLive, type CheckerAvailability } from "../approvals";
import { recordEvent } from "../events";
import { payrollHash } from "../hash";
import { ZERO, canonicalDecimal, dec, percentOf, roundTo, type Money } from "../money";
import { namesOfUsers } from "../names";
import { RuleContext, RuleNotSetError, type RulePin } from "../rules/context";
import { decimalText } from "../rules/schemas";
import { arrearsToJson, computeArrears, getArrearsBasisProvider, lockedCyclesFrom, type CycleArrears } from "./arrears";
import { computeBreakup, type BreakupLine, type RoundingRule } from "./breakup";
import { assertNotOwnPay, employeeIdOfUser, userIdsOfEmployees } from "./guards";
import type { ComponentValue } from "./schemas";
import { loadStructureVersion } from "./structures";

// Salary revisions (docs/plans/PHASE_6.md §14B): the only way a salary row is written. A revision is a unit: who it covers (frozen at creation), what changes,
// from when. Its figures are recomputed from those inputs every time they are shown, approved or applied, so the checker approves exactly what would be
// written, and anything that moved in between (somebody else's revision, a new structure version, the rounding rule) voids the approval.
//
//   preview  -> create (and submit) -> a different person decides -> apply (one transaction: lock, recompute, check the hash, write, arrears, consume)

const code = z.string().regex(ITEM_CODE_PATTERN);
const money2 = z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "An amount in rupees, up to two decimal places");

export const revisionInputSchema = z
  .object({
    selection: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("EMPLOYEES"), employeeIds: z.array(z.string().min(1)).min(1).max(1000) }).strict(),
      z.object({ kind: z.literal("BRANCH"), locationId: z.string().min(1) }).strict(),
      z.object({ kind: z.literal("GRADE"), gradeId: z.string().min(1) }).strict(),
      z.object({ kind: z.literal("STRUCTURE"), structureKey: code, structureVersion: z.number().int().min(1).optional() }).strict(),
      z.object({ kind: z.literal("ALL") }).strict(),
    ]),
    change: z
      .object({
        ctc: z.discriminatedUnion("mode", [z.object({ mode: z.literal("SET"), annual: money2 }).strict(), z.object({ mode: z.literal("INCREASE_PERCENT"), percent: decimalText }).strict()]).optional(),
        structure: z.object({ key: code, version: z.number().int().min(1) }).strict().optional(),
        perPerson: z.record(z.string(), z.record(code, decimalText)).optional(),
      })
      .strict()
      .refine((c) => c.ctc || c.structure, "Say what changes: the CTC, the structure, or both"),
    effectiveFrom: z.iso.date(),
    reason: z.enum(["REVISION", "CORRECTION"]).default("REVISION"),
    note: z.string().trim().max(500).default(""),
  })
  .strict();
export type RevisionInput = z.infer<typeof revisionInputSchema>;

export type RevisionChange = RevisionInput["change"];

// ── The plan: what the revision would write, recomputed from its inputs ──

interface PreviousSalary {
  id: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  annualCtc: Money;
  monthlyCtc: Money;
  structureKey: string;
  structureVersion: number;
  lines: Array<{ component: string; version: number; amount: Money }>;
}

export interface PersonPlan {
  employeeId: string;
  employeeCode: string;
  name: string;
  rowReason: SalaryChangeReason;
  previous: PreviousSalary | null;
  next: { annualCtc: Money; monthlyCtc: Money; structureKey: string; structureVersion: number; structureHash: string; lines: BreakupLine[] } | null;
  differences: Array<{ component: string; old: Money; next: Money; difference: Money }>;
  firstCycle: string;
  lockedCycles: string[];
  arrears: CycleArrears[];
  problems: string[];
}

export interface RevisionPlan {
  effectiveFrom: Date;
  reason: SalaryChangeReason;
  people: PersonPlan[];
  /** Things that stop the whole revision, not one person: a rule with no value yet, arrears that cannot be worked out. */
  blockers: string[];
  rulePins: RulePin[];
  hash: string;
}

export interface ResolvedRevision {
  employeeIds: string[];
  change: RevisionChange;
  effectiveFrom: Date;
  reason: "REVISION" | "CORRECTION";
}

const toPrev = (r: SalaryWithLines): PreviousSalary => ({
  id: r.id,
  effectiveFrom: r.effectiveFrom,
  effectiveTo: r.effectiveTo,
  annualCtc: dec(r.annualCtc.toString()),
  monthlyCtc: dec(r.monthlyCtc.toString()),
  structureKey: r.structureKey,
  structureVersion: r.structureVersion,
  lines: r.lines.map((l) => ({ component: l.componentCode, version: l.componentVersion, amount: dec(l.amount.toString()) })),
});

const iso = (d: Date) => d.toISOString().slice(0, 10);

async function ruleOrBlocker<T>(ctx: RuleContext, key: string, blockers: string[]): Promise<T | null> {
  try {
    return ctx.rule<T>(key);
  } catch (err) {
    if (err instanceof RuleNotSetError) {
      blockers.push(err.message);
      return null;
    }
    throw err;
  }
}

export async function computeRevisionPlan(rev: ResolvedRevision): Promise<RevisionPlan> {
  const today = businessToday();
  const blockers: string[] = [];
  const ctx = await RuleContext.load();
  const rounding = await ruleOrBlocker<RoundingRule>(ctx, "LINE_ROUNDING", blockers);
  const ctcRounding = rev.change.ctc?.mode === "INCREASE_PERCENT" ? await ruleOrBlocker<RoundingRule>(ctx, "REVISION_CTC_ROUNDING", blockers) : null;
  const typedRounding = rounding && rounding.mode !== "NONE" ? (rounding as RoundingRule & { mode: Exclude<RoundingRule["mode"], "NONE"> }) : null;
  if (rounding && !typedRounding) {
    blockers.push('The rule "Rounding of salary lines" is set to no rounding, but one twelfth of a yearly CTC is not a finite number. Choose a rounding mode and a number of decimal places for it.');
  }

  const [employees, latest, names, cycleRules, maxAhead] = await Promise.all([
    prisma.employee.findMany({ where: { id: { in: rev.employeeIds } }, select: { id: true, employeeCode: true, dateOfJoining: true, lastWorkingDate: true } }),
    latestSalaries(rev.employeeIds),
    namesOn(rev.employeeIds, rev.effectiveFrom),
    loadCycleRules(),
    maxScheduleAheadDays(),
  ]);
  const byId = new Map(employees.map((e) => [e.id, e]));
  // The name in force on the effective date; for somebody whose name history starts later (a joiner dated back), the name they have today.
  for (const [id, n] of await namesOn(rev.employeeIds, today)) if (!names.has(id)) names.set(id, n);
  const lockedCycles = await lockedCyclesFrom(cycleRules, rev.effectiveFrom, today);
  const firstCycle = cycleForRules(cycleRules, rev.effectiveFrom).label;
  const provider = getArrearsBasisProvider();
  if (lockedCycles.length && !provider) {
    blockers.push(
      `This is dated inside a payroll period that has been finalised (${lockedCycles.map((c) => c.label).join(", ")}), so what it owes is paid as arrears in the next run, and arrears cannot be worked out yet: the record of what each person was paid is not available. Date it after the last finalised period.`,
    );
  }

  const structureCache = new Map<string, Awaited<ReturnType<typeof loadStructureVersion>>>();
  const structureOf = async (key: string, version: number) => {
    const k = `${key}@${version}`;
    if (!structureCache.has(k)) structureCache.set(k, await loadStructureVersion(key, version));
    return structureCache.get(k)!;
  };
  const componentFlags = new Map<string, boolean>(); // "CODE@version" -> prorates
  const proratesOf = async (componentCode: string, version: number): Promise<boolean> => {
    const k = `${componentCode}@${version}`;
    if (!componentFlags.has(k)) {
      const row = await prisma.payrollItemVersion.findFirst({ where: { kind: "COMPONENT", key: componentCode, version }, select: { value: true } });
      componentFlags.set(k, row ? (row.value as unknown as ComponentValue).prorates : true);
    }
    return componentFlags.get(k)!;
  };

  const people: PersonPlan[] = [];
  for (const employeeId of rev.employeeIds) {
    const emp = byId.get(employeeId);
    const prevRow = latest.get(employeeId);
    const previous = prevRow ? toPrev(prevRow) : null;
    const plan: PersonPlan = {
      employeeId,
      employeeCode: emp?.employeeCode ?? "",
      name: names.get(employeeId) ?? emp?.employeeCode ?? employeeId,
      rowReason: previous ? rev.reason : "JOINING",
      previous,
      next: null,
      differences: [],
      firstCycle,
      lockedCycles: lockedCycles.map((c) => c.label),
      arrears: [],
      problems: [],
    };
    people.push(plan);
    const problem = (m: string) => plan.problems.push(m);
    if (!emp) {
      problem("This person was not found.");
      continue;
    }
    if (rev.effectiveFrom < emp.dateOfJoining) problem(`They joined on ${iso(emp.dateOfJoining)}, so a salary cannot start before that.`);
    if (emp.lastWorkingDate && rev.effectiveFrom > emp.lastWorkingDate) problem(`They left on ${iso(emp.lastWorkingDate)}, so a salary cannot start after that.`);
    if (previous) {
      try {
        planTimelineChange([{ id: previous.id, from: previous.effectiveFrom, to: previous.effectiveTo }], rev.effectiveFrom, today, maxAhead);
        if (rev.effectiveFrom.getTime() === previous.effectiveFrom.getTime()) problem(`A salary already starts on ${iso(rev.effectiveFrom)}. It is never overwritten: date this after it, or cancel that one if it has not started.`);
      } catch (err) {
        if (!(err instanceof HttpError)) throw err;
        problem(err.message);
      }
    }
    const structureRef = rev.change.structure ?? (previous ? { key: previous.structureKey, version: previous.structureVersion } : null);
    if (!structureRef) {
      problem("A first salary needs a structure.");
      continue;
    }
    let annual: Money | null = null;
    if (rev.change.ctc?.mode === "SET") annual = dec(rev.change.ctc.annual);
    else if (rev.change.ctc?.mode === "INCREASE_PERCENT") {
      if (!previous) problem("A percentage increase needs an existing salary to increase.");
      else if (ctcRounding) {
        const raised = previous.annualCtc.plus(percentOf(previous.annualCtc, dec(rev.change.ctc.percent)));
        annual = ctcRounding.mode === "NONE" ? raised : roundTo(raised, ctcRounding.scale, ctcRounding.mode);
        if (!annual.equals(annual.toDecimalPlaces(2))) {
          problem(`A ${rev.change.ctc.percent}% increase gives ${canonicalDecimal(annual)}, which has more than two decimal places. Set "Rounding of a new CTC after a percentage increase" to round it to the paisa or the rupee.`);
          annual = null;
        }
      }
    } else if (previous) annual = previous.annualCtc;
    else problem("A first salary needs a CTC.");
    if (!annual || !typedRounding) continue;
    if (!annual.greaterThan(ZERO)) {
      problem("A CTC has to be more than zero.");
      continue;
    }
    try {
      const structure = await structureOf(structureRef.key, structureRef.version);
      const typed: Record<string, Money> = {};
      for (const line of structure.value.lines) {
        if (line.calc.method !== "PER_PERSON") continue;
        const given = rev.change.perPerson?.[employeeId]?.[line.component];
        const carried = previous?.lines.find((l) => l.component === line.component)?.amount;
        if (given !== undefined) typed[line.component] = dec(given);
        else if (carried) typed[line.component] = carried;
      }
      const b = computeBreakup({
        annualCtc: annual,
        structure: structure.value,
        components: new Map([...structure.components].map(([c, v]) => [c, { version: v.version, value: v.value }])),
        perPerson: typed,
        rounding: typedRounding,
      });
      plan.next = { annualCtc: annual, monthlyCtc: b.monthlyCtc, structureKey: structureRef.key, structureVersion: structureRef.version, structureHash: structure.hash, lines: b.lines };
    } catch (err) {
      if (err instanceof HttpError) {
        problem(err.message);
        continue;
      }
      throw err;
    }
    const oldBy = new Map((previous?.lines ?? []).map((l) => [l.component, l.amount]));
    const newBy = new Map(plan.next.lines.map((l) => [l.component, l.amount]));
    for (const c of [...new Set([...oldBy.keys(), ...newBy.keys()])].sort()) {
      const o = oldBy.get(c) ?? ZERO;
      const n = newBy.get(c) ?? ZERO;
      plan.differences.push({ component: c, old: o, next: n, difference: n.minus(o) });
    }
    if (lockedCycles.length && provider) {
      try {
        const prorates = new Map<string, boolean>();
        for (const l of plan.next.lines) prorates.set(l.component, await proratesOf(l.component, l.componentVersion));
        for (const l of previous?.lines ?? []) if (!prorates.has(l.component)) prorates.set(l.component, await proratesOf(l.component, l.version));
        plan.arrears = await computeArrears({ employeeId, effectiveFrom: rev.effectiveFrom, old: oldBy, next: newBy, prorates, lockedCycles, rounding: typedRounding, provider });
      } catch (err) {
        if (!(err instanceof HttpError)) throw err;
        problem(err.message);
      }
    }
  }

  const rulePins = ctx.pins();
  const hash = payrollHash({
    t: "SALARY_REVISION",
    effectiveFrom: iso(rev.effectiveFrom),
    reason: rev.reason,
    blockers,
    rulePins,
    people: people.map((p) => ({
      employeeId: p.employeeId,
      rowReason: p.rowReason,
      previous: p.previous ? { id: p.previous.id, annualCtc: canonicalDecimal(p.previous.annualCtc), structure: `${p.previous.structureKey}@${p.previous.structureVersion}` } : null,
      next: p.next
        ? { annualCtc: canonicalDecimal(p.next.annualCtc), monthlyCtc: canonicalDecimal(p.next.monthlyCtc), structure: `${p.next.structureKey}@${p.next.structureVersion}`, structureHash: p.next.structureHash, lines: p.next.lines.map((l) => ({ c: l.component, v: l.componentVersion, a: canonicalDecimal(l.amount) })) }
        : null,
      lockedCycles: p.lockedCycles,
      arrears: p.arrears.map(arrearsToJson),
      problems: p.problems,
    })),
  });
  return { effectiveFrom: rev.effectiveFrom, reason: rev.reason, people, blockers, rulePins, hash };
}

// ── Choosing the people ──

export interface Resolved extends ResolvedRevision {
  selection: RevisionInput["selection"];
  skipped: Array<{ employeeId: string; name: string; reason: string }>;
}

export async function resolveSelection(input: RevisionInput, actorUserId: string): Promise<Resolved> {
  const day = new Date(input.effectiveFrom);
  const own = await employeeIdOfUser(actorUserId);
  const skipped: Resolved["skipped"] = [];
  let ids: string[];
  const sel = input.selection;
  if (sel.kind === "EMPLOYEES") {
    ids = [...new Set(sel.employeeIds)];
    await assertNotOwnPay(actorUserId, ids, "This revision");
  } else {
    if (sel.kind === "BRANCH") ids = await employeeIdsPlacedOn(day, { locationId: sel.locationId });
    else if (sel.kind === "GRADE") ids = await employeeIdsPlacedOn(day, { gradeId: sel.gradeId });
    else if (sel.kind === "STRUCTURE") ids = await employeeIdsOnStructure(day, sel.structureKey, sel.structureVersion);
    else ids = (await prisma.employee.findMany({ where: employedOn(day), select: { id: true } })).map((e) => e.id);
    const names = await namesOn(ids, day);
    if (own && ids.includes(own)) {
      skipped.push({ employeeId: own, name: names.get(own) ?? "You", reason: "Your own pay: somebody else has to prepare a change to it." });
      ids = ids.filter((i) => i !== own);
    }
    if (sel.kind !== "STRUCTURE") {
      const has = await latestSalaries(ids);
      const none = ids.filter((i) => !has.has(i));
      for (const i of none) skipped.push({ employeeId: i, name: names.get(i) ?? i, reason: "No salary on record. To give them a first salary, pick them by name." });
      ids = ids.filter((i) => has.has(i));
    }
  }
  if (ids.length === 0) throw new HttpError(400, "That picks nobody. Choose different people or a different date.", "VALIDATION_ERROR", { skipped });
  return { employeeIds: ids.sort(), change: input.change, effectiveFrom: day, reason: input.reason, selection: sel, skipped };
}

// ── Showing it ──

const s = (m: Money) => canonicalDecimal(m);

export function planToJson(plan: RevisionPlan) {
  return {
    effectiveFrom: iso(plan.effectiveFrom),
    reason: plan.reason,
    blockers: plan.blockers,
    hash: plan.hash,
    people: plan.people.map((p) => ({
      employeeId: p.employeeId,
      employeeCode: p.employeeCode,
      name: p.name,
      rowReason: p.rowReason,
      problems: p.problems,
      previous: p.previous ? { annualCtc: s(p.previous.annualCtc), monthlyCtc: s(p.previous.monthlyCtc), structure: `${p.previous.structureKey} v${p.previous.structureVersion}`, startedOn: iso(p.previous.effectiveFrom) } : null,
      next: p.next ? { annualCtc: s(p.next.annualCtc), monthlyCtc: s(p.next.monthlyCtc), structure: `${p.next.structureKey} v${p.next.structureVersion}`, lines: p.next.lines.map((l) => ({ component: l.component, type: l.type, amount: s(l.amount) })) } : null,
      differences: p.differences.map((d) => ({ component: d.component, old: s(d.old), next: s(d.next), difference: s(d.difference) })),
      firstCycle: p.firstCycle,
      lockedCycles: p.lockedCycles,
      arrears: p.arrears.map((a) => ({ cycle: a.cycleLabel, ...arrearsToJson(a) })),
    })),
  };
}

async function checkersFor(makerUserId: string, employeeIds: readonly string[]): Promise<CheckerAvailability> {
  const adapter = adapterFor("SALARY_REVISION");
  const holders = await activeUsersHoldingPermission(adapter.checkerPermission);
  const names = await namesOfUsers(holders.map((h) => h.userId));
  const affected = new Set(await userIdsOfEmployees(employeeIds));
  return availabilityFrom(
    holders.map((h) => ({ userId: h.userId, name: names.get(h.userId) ?? "Someone" })),
    { makerUserId, affected },
  );
}

export async function previewRevision(rawInput: unknown, actorUserId: string) {
  const input = revisionInputSchema.parse(rawInput);
  const resolved = await resolveSelection(input, actorUserId);
  const plan = await computeRevisionPlan(resolved);
  const checkers = await checkersFor(actorUserId, resolved.employeeIds);
  const problems = plan.people.flatMap((p) => p.problems.map((m) => `${p.name}: ${m}`));
  const blockers = [...plan.blockers, ...problems];
  if (checkers.state === "NONE") blockers.push(checkers.message);
  return { ...planToJson(plan), skipped: resolved.skipped, selection: input.selection, change: input.change, note: input.note, blockers, canSubmit: blockers.length === 0, checkers, fingerprint: plan.hash };
}

// ── Creating, submitting, withdrawing ──

type RevisionRow = Awaited<ReturnType<typeof prisma.payrollSalaryRevision.findUniqueOrThrow>>;

function resolvedOf(rev: RevisionRow): ResolvedRevision {
  return { employeeIds: rev.employeeIds as string[], change: rev.change as unknown as RevisionChange, effectiveFrom: rev.effectiveFrom, reason: rev.reason === "CORRECTION" ? "CORRECTION" : "REVISION" };
}

async function liveHash(revisionId: string): Promise<string> {
  const rev = await prisma.payrollSalaryRevision.findUnique({ where: { id: revisionId } });
  if (!rev) throw new HttpError(404, "No such salary revision.", "NOT_FOUND");
  return (await computeRevisionPlan(resolvedOf(rev))).hash;
}

export async function createRevision(rawInput: unknown, fingerprint: string, actor: { userId: string; ip?: string | null }) {
  const input = revisionInputSchema.parse(rawInput);
  const resolved = await resolveSelection(input, actor.userId);
  const plan = await computeRevisionPlan(resolved);
  if (fingerprint !== plan.hash) throw new HttpError(409, "This changed since you previewed it. Preview it again.", "PREVIEW_STALE");
  const blockers = [...plan.blockers, ...plan.people.flatMap((p) => p.problems.map((m) => `${p.name}: ${m}`))];
  if (blockers.length) throw new HttpError(409, `This cannot be submitted yet: ${blockers[0]}`, "REVISION_BLOCKED", { blockers });
  const row = await prisma.payrollSalaryRevision.create({
    data: {
      effectiveFrom: resolved.effectiveFrom,
      reason: input.reason,
      note: input.note,
      selection: input.selection as unknown as Prisma.InputJsonValue,
      employeeIds: resolved.employeeIds as unknown as Prisma.InputJsonValue,
      change: input.change as unknown as Prisma.InputJsonValue,
      createdByUserId: actor.userId,
    },
  });
  await recordEvent({ subjectType: "SALARY_REVISION", subjectId: row.id, type: "CREATED", actorUserId: actor.userId, payload: { hash: plan.hash, people: resolved.employeeIds.length, effectiveFrom: iso(resolved.effectiveFrom) } });
  await writeAuditLog({ actorUserId: actor.userId, action: "payroll.salary_revision.created", entityType: "PayrollSalaryRevision", entityId: row.id, after: { effectiveFrom: iso(resolved.effectiveFrom), people: resolved.employeeIds.length, reason: input.reason, hash: plan.hash }, ipAddress: actor.ip ?? null });
  await submit({ subject: "SALARY_REVISION", subjectId: row.id, makerUserId: actor.userId, previewFingerprint: plan.hash, note: input.note, ip: actor.ip ?? null });
  return { id: row.id };
}

/** Submits (or resubmits, after a rejection or a void) the revision as it would be applied today. */
export async function submitRevision(revisionId: string, fingerprint: string, actor: { userId: string; ip?: string | null }) {
  const rev = await prisma.payrollSalaryRevision.findUnique({ where: { id: revisionId } });
  if (!rev) throw new HttpError(404, "No such salary revision.", "NOT_FOUND");
  if (rev.appliedAt || rev.withdrawnAt) throw new HttpError(409, "This revision is already applied or withdrawn.", "CONFLICT");
  const plan = await computeRevisionPlan(resolvedOf(rev));
  if (fingerprint !== plan.hash) throw new HttpError(409, "This changed since you looked at it. Look at it again.", "PREVIEW_STALE");
  const blockers = [...plan.blockers, ...plan.people.flatMap((p) => p.problems.map((m) => `${p.name}: ${m}`))];
  if (blockers.length) throw new HttpError(409, `This cannot be submitted yet: ${blockers[0]}`, "REVISION_BLOCKED", { blockers });
  await submit({ subject: "SALARY_REVISION", subjectId: revisionId, makerUserId: actor.userId, previewFingerprint: plan.hash, ip: actor.ip ?? null });
  return { id: revisionId };
}

export async function withdrawRevision(revisionId: string, reason: string, actor: { userId: string; ip?: string | null }) {
  const why = reason.trim();
  if (why.length < 3) throw new HttpError(400, "Say why you are withdrawing it.", "VALIDATION_ERROR");
  const rev = await prisma.payrollSalaryRevision.findUnique({ where: { id: revisionId } });
  if (!rev) throw new HttpError(404, "No such salary revision.", "NOT_FOUND");
  if (rev.appliedAt) throw new HttpError(409, "This revision has already been applied.", "CONFLICT");
  if (rev.withdrawnAt) throw new HttpError(409, "This revision is already withdrawn.", "CONFLICT");
  await voidLive("SALARY_REVISION", revisionId, `Withdrawn: ${why}`, actor.userId);
  await prisma.payrollSalaryRevision.update({ where: { id: revisionId }, data: { withdrawnAt: new Date(), withdrawnReason: why } }); // allow-clock: an instant, not a business date
  await recordEvent({ subjectType: "SALARY_REVISION", subjectId: revisionId, type: "WITHDRAWN", actorUserId: actor.userId, payload: { reason: why } });
  await writeAuditLog({ actorUserId: actor.userId, action: "payroll.salary_revision.withdrawn", entityType: "PayrollSalaryRevision", entityId: revisionId, after: { reason: why }, ipAddress: actor.ip ?? null });
}

// ── Deciding ──

export async function decideRevision(revisionId: string, input: { decision: "APPROVE" | "REJECT"; note?: string; fingerprint: string }, checker: { userId: string; ip?: string | null }) {
  const rev = await prisma.payrollSalaryRevision.findUnique({ where: { id: revisionId } });
  if (!rev) throw new HttpError(404, "No such salary revision.", "NOT_FOUND");
  if (rev.appliedAt || rev.withdrawnAt) throw new HttpError(409, "This revision is already applied or withdrawn.", "CONFLICT");
  const approval = await liveApproval("SALARY_REVISION", revisionId);
  if (!approval || approval.status !== "PENDING") throw new HttpError(409, "This is not waiting for a decision.", "APPROVAL_NOT_PENDING");
  const live = (await computeRevisionPlan(resolvedOf(rev))).hash;
  if (input.fingerprint !== live) throw new HttpError(409, "The figures changed since you opened this. Look at it again before deciding.", "PREVIEW_STALE");
  return decide({ approvalId: approval.id, checkerUserId: checker.userId, decision: input.decision, ...(input.note !== undefined ? { note: input.note } : {}), ip: checker.ip ?? null });
}

// ── Applying ──

// A salary revision can cover the whole company and writes a row and its lines for each person in one transaction, so it needs far longer than the default.
const APPLY_TRANSACTION = { timeout: 120_000, maxWait: 15_000 };

export async function applyRevision(revisionId: string, actor: { userId: string; ip?: string | null }) {
  const rev = await prisma.payrollSalaryRevision.findUnique({ where: { id: revisionId } });
  if (!rev) throw new HttpError(404, "No such salary revision.", "NOT_FOUND");
  if (rev.appliedAt) throw new HttpError(409, "This revision has already been applied.", "CONFLICT");
  if (rev.withdrawnAt) throw new HttpError(409, "This revision was withdrawn.", "CONFLICT");
  await assertNotOwnPay(actor.userId, rev.employeeIds as string[], "Applying this revision");
  const written: Array<{ employeeId: string; salaryId: string; arrears: number }> = [];

  await prisma.$transaction(async (tx) => {
    await lockEmployees(tx, rev.employeeIds as string[]);
    const approval = await tx.payrollApproval.findFirst({ where: { subject: "SALARY_REVISION", subjectId: revisionId, status: "APPROVED" } });
    if (!approval) throw new HttpError(409, "A second person has not approved this, so it cannot be applied.", "APPROVAL_REQUIRED");
    const plan = await computeRevisionPlan(resolvedOf(rev));
    if (plan.hash !== approval.hashAtDecision) {
      await voidApproval(approval, "The figures no longer match what was approved.", actor.userId); // outside the transaction, so the void survives the rollback
      throw new HttpError(409, "Something changed after this was approved (somebody's salary, a structure, or a rule), so the approval is void. It needs to be submitted and approved again.", "APPROVAL_VOIDED");
    }
    const blockers = [...plan.blockers, ...plan.people.flatMap((p) => p.problems.map((m) => `${p.name}: ${m}`))];
    if (blockers.length) throw new HttpError(409, `This cannot be applied: ${blockers[0]}`, "REVISION_BLOCKED", { blockers });

    for (const person of plan.people) {
      const next = person.next!;
      const data = {
        reason: person.rowReason,
        annualCtc: canonicalDecimal(next.annualCtc),
        monthlyCtc: canonicalDecimal(next.monthlyCtc),
        structureKey: next.structureKey,
        structureVersion: next.structureVersion,
        structureHash: next.structureHash,
        roundingPin: (plan.rulePins.find((p) => p.key === "LINE_ROUNDING") ?? null) as unknown as Prisma.InputJsonValue,
        revisionId,
        note: rev.note,
        lines: next.lines.map((l) => ({ componentCode: l.component, componentVersion: l.componentVersion, componentType: l.type, amount: canonicalDecimal(l.amount), sortOrder: l.order })),
      };
      // Dated inside a finalised period: the true date goes on the timeline and the arrears (made in this same transaction) pay what it owes.
      const backdated = person.lockedCycles.length > 0;
      const write = backdated ? writeBackdatedSalaryChange : writeSalaryChange;
      const { after } = await write(tx, person.employeeId, plan.effectiveFrom, data, { createdByUserId: actor.userId });
      for (const a of person.arrears) {
        const direction = a.total.isNegative() ? "DEDUCTION" : "EARNING";
        await tx.payrollAdjustment.create({
          data: {
            employeeId: person.employeeId,
            componentCode: "ARREARS",
            direction,
            amount: canonicalDecimal(a.total.abs()),
            reason: `Arrears from the salary revision effective ${iso(plan.effectiveFrom)}, for ${a.cycleLabel}`,
            source: "SALARY_ARREARS",
            sourceRef: `${revisionId}:${person.employeeId}:${iso(a.cycleStart)}`,
            periodStart: a.cycleStart,
            periodEnd: a.cycleEnd,
            breakdown: a.lines.map((l) => ({ component: l.component, amount: canonicalDecimal(l.amount) })) as unknown as Prisma.InputJsonValue,
            createdByUserId: actor.userId,
          },
        });
      }
      await recordEvent({ subjectType: "SALARY_REVISION", subjectId: revisionId, type: "SALARY_WRITTEN", actorUserId: actor.userId, payload: { employeeId: person.employeeId, salaryId: after.id, annualCtc: canonicalDecimal(next.annualCtc), monthlyCtc: canonicalDecimal(next.monthlyCtc), arrears: person.arrears.map(arrearsToJson) } }, tx);
      written.push({ employeeId: person.employeeId, salaryId: after.id, arrears: person.arrears.length });
    }
    await tx.payrollSalaryRevision.update({ where: { id: revisionId }, data: { appliedAt: new Date(), appliedByUserId: actor.userId } }); // allow-clock: an instant, not a business date
    await consume("SALARY_REVISION", revisionId, actor.userId, actor.ip ?? null, tx);
    await recordEvent({ subjectType: "SALARY_REVISION", subjectId: revisionId, type: "APPLIED", actorUserId: actor.userId, payload: { people: written.length, hash: plan.hash } }, tx);
  }, APPLY_TRANSACTION);

  // Audit rows carry references and redacted figures: the amounts live in the payroll tables and events, behind payroll permissions (docs/plans/PHASE_6.md §15 item 14).
  for (const w of written) {
    await writeAuditLog({ actorUserId: actor.userId, action: "payroll.salary.revised", entityType: "PayrollSalary", entityId: w.salaryId, after: { employeeId: w.employeeId, revisionId, effectiveFrom: iso(rev.effectiveFrom), arrearsCycles: w.arrears, amounts: "redacted" }, ipAddress: actor.ip ?? null });
  }
  await writeAuditLog({ actorUserId: actor.userId, action: "payroll.salary_revision.applied", entityType: "PayrollSalaryRevision", entityId: revisionId, after: { people: written.length, effectiveFrom: iso(rev.effectiveFrom) }, ipAddress: actor.ip ?? null });
  return { id: revisionId, applied: written.length };
}

// ── Reading ──

export type RevisionStatus = "DRAFT" | "WAITING_FOR_CHECKER" | "APPROVED" | "REJECTED" | "VOIDED" | "APPLIED" | "WITHDRAWN";

async function statusOf(rev: RevisionRow): Promise<{ status: RevisionStatus; approval: Awaited<ReturnType<typeof prisma.payrollApproval.findFirst>> }> {
  const approvals = await prisma.payrollApproval.findMany({ where: { subject: "SALARY_REVISION", subjectId: rev.id }, orderBy: { submittedAt: "desc" } });
  const latest = approvals[0] ?? null;
  if (rev.appliedAt) return { status: "APPLIED", approval: latest };
  if (rev.withdrawnAt) return { status: "WITHDRAWN", approval: latest };
  if (!latest) return { status: "DRAFT", approval: null };
  if (latest.status === "PENDING") return { status: "WAITING_FOR_CHECKER", approval: latest };
  if (latest.status === "APPROVED") return { status: "APPROVED", approval: latest };
  return { status: latest.status === "REJECTED" ? "REJECTED" : "VOIDED", approval: latest };
}

export async function listRevisions(page: number, pageSize: number) {
  const [rows, total] = await Promise.all([
    prisma.payrollSalaryRevision.findMany({ orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.payrollSalaryRevision.count(),
  ]);
  const makers = await namesOfUsers(rows.map((r) => r.createdByUserId));
  const items = [];
  for (const r of rows) {
    const { status } = await statusOf(r);
    items.push({ id: r.id, status, effectiveFrom: iso(r.effectiveFrom), reason: r.reason, people: (r.employeeIds as string[]).length, createdAt: r.createdAt.toISOString(), createdBy: makers.get(r.createdByUserId) ?? "Someone", note: r.note, selection: r.selection });
  }
  return { total, items };
}

/** An applied revision as it was written: the rows it created, the row each one replaced, and the arrears it made. Never recomputed from today's setup. */
async function appliedPlanJson(rev: RevisionRow) {
  const rows = await salaryRowsOfRevision(rev.id);
  const ids = rows.map((r) => r.employeeId);
  const [names, employees, adjustments, cycleRules] = await Promise.all([
    namesOn(ids, rev.effectiveFrom),
    prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, employeeCode: true } }),
    prisma.payrollAdjustment.findMany({ where: { source: "SALARY_ARREARS", sourceRef: { startsWith: `${rev.id}:` } }, orderBy: { periodStart: "asc" } }),
    loadCycleRules(),
  ]);
  const codeOf = new Map(employees.map((e) => [e.id, e.employeeCode]));
  const people = [];
  for (const row of rows) {
    const history = await salaryHistory(row.employeeId); // newest first
    const previous = history.find((h) => h.effectiveTo !== null && h.effectiveTo.getTime() === row.effectiveFrom.getTime()) ?? null;
    const oldBy = new Map((previous?.lines ?? []).map((l) => [l.componentCode, dec(l.amount.toString())]));
    const newBy = new Map(row.lines.map((l) => [l.componentCode, dec(l.amount.toString())]));
    const mine = adjustments.filter((a) => a.employeeId === row.employeeId);
    people.push({
      employeeId: row.employeeId,
      employeeCode: codeOf.get(row.employeeId) ?? "",
      name: names.get(row.employeeId) ?? codeOf.get(row.employeeId) ?? row.employeeId,
      rowReason: row.reason,
      problems: [] as string[],
      previous: previous ? { annualCtc: s(dec(previous.annualCtc.toString())), monthlyCtc: s(dec(previous.monthlyCtc.toString())), structure: `${previous.structureKey} v${previous.structureVersion}`, startedOn: iso(previous.effectiveFrom) } : null,
      next: { annualCtc: s(dec(row.annualCtc.toString())), monthlyCtc: s(dec(row.monthlyCtc.toString())), structure: `${row.structureKey} v${row.structureVersion}`, lines: row.lines.map((l) => ({ component: l.componentCode, type: l.componentType, amount: s(dec(l.amount.toString())) })) },
      differences: [...new Set([...oldBy.keys(), ...newBy.keys()])].sort().map((c) => ({ component: c, old: s(oldBy.get(c) ?? ZERO), next: s(newBy.get(c) ?? ZERO), difference: s((newBy.get(c) ?? ZERO).minus(oldBy.get(c) ?? ZERO)) })),
      firstCycle: cycleForRules(cycleRules, rev.effectiveFrom).label,
      lockedCycles: mine.map((a) => cycleForRules(cycleRules, a.periodStart!).label),
      arrears: mine.map((a) => {
        const lines = (a.breakdown as Array<{ component: string; amount: string }>) ?? [];
        const total = a.direction === "DEDUCTION" ? `-${canonicalDecimal(dec(a.amount.toString()))}` : canonicalDecimal(dec(a.amount.toString()));
        return { cycle: cycleForRules(cycleRules, a.periodStart!).label, cycleStart: iso(a.periodStart!), cycleEnd: iso(a.periodEnd!), total, lines };
      }),
    });
  }
  return { effectiveFrom: iso(rev.effectiveFrom), reason: rev.reason, blockers: [] as string[], hash: "", people };
}

export async function getRevision(revisionId: string, viewerUserId: string) {
  const rev = await prisma.payrollSalaryRevision.findUnique({ where: { id: revisionId } });
  if (!rev) throw new HttpError(404, "No such salary revision.", "NOT_FOUND");
  const { status, approval } = await statusOf(rev);
  const closed = status === "APPLIED" || status === "WITHDRAWN";
  // A closed revision is shown as it was recorded; an open one is recomputed from today's setup, which is exactly what a checker approves and apply writes.
  const live = closed ? null : await computeRevisionPlan(resolvedOf(rev));
  const plan = status === "APPLIED" ? await appliedPlanJson(rev) : live ? planToJson(live) : planToJson(await computeRevisionPlan(resolvedOf(rev)));
  const people = rev.employeeIds as string[];
  const people2 = await namesOfUsers([rev.createdByUserId, ...(approval?.checkerUserId ? [approval.checkerUserId] : []), ...(rev.appliedByUserId ? [rev.appliedByUserId] : [])]);
  const checkers = status === "DRAFT" || status === "WAITING_FOR_CHECKER" || status === "REJECTED" || status === "VOIDED" ? await checkersFor(rev.createdByUserId, people) : null;
  const viewerEmployee = await employeeIdOfUser(viewerUserId);
  return {
    id: rev.id,
    status,
    effectiveFrom: iso(rev.effectiveFrom),
    reason: rev.reason,
    note: rev.note,
    selection: rev.selection,
    change: rev.change,
    createdAt: rev.createdAt.toISOString(),
    createdBy: people2.get(rev.createdByUserId) ?? "Someone",
    createdByUserId: rev.createdByUserId,
    appliedAt: rev.appliedAt?.toISOString() ?? null,
    appliedBy: rev.appliedByUserId ? (people2.get(rev.appliedByUserId) ?? "Someone") : null,
    withdrawnAt: rev.withdrawnAt?.toISOString() ?? null,
    withdrawnReason: rev.withdrawnReason,
    approval: approval ? { status: approval.status, decidedBy: approval.checkerUserId ? (people2.get(approval.checkerUserId) ?? "Someone") : null, decisionNote: approval.decisionNote, voidReason: approval.voidReason } : null,
    plan,
    fingerprint: live?.hash ?? approval?.hashAtDecision ?? "",
    blockers: live ? [...live.blockers, ...live.people.flatMap((p) => p.problems.map((m) => `${p.name}: ${m}`))] : [],
    checkers,
    includesViewer: viewerEmployee !== null && people.includes(viewerEmployee),
  };
}

// ── The approval adapter ──

registerSubject({
  subject: "SALARY_REVISION",
  makerPermission: "payroll.salary.edit",
  checkerPermission: "payroll.approve",
  async describe(subjectId) {
    return `the salary revision ${subjectId}`;
  },
  hash: liveHash,
  async affectedUserIds(subjectId) {
    const rev = await prisma.payrollSalaryRevision.findUnique({ where: { id: subjectId }, select: { employeeIds: true } });
    return rev ? userIdsOfEmployees(rev.employeeIds as string[]) : [];
  },
});
