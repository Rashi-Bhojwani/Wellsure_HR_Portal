import { z } from "zod";
import { writeAuditLog } from "../../lib/audit";
import { businessToday } from "../../lib/businessDate";
import { activeDirectors, requireDirector } from "../../lib/directorAuthority";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { finalisedPeriodsOverlapping } from "../attendance/lockedPeriods";
import { requestRecomputeForEveryone } from "../attendance/recompute";
import { notifyEmployee } from "../notifications/notifyEmployee";
import { namesOfUsers } from "../payroll/names";
import { DEFAULT_RULE, type HalfDaySetting, type LateRule, type MissingPunchSetting } from "./evaluate";

// Lateness rule settings (docs/plans/LATE_CHECKLIST.md §1). Kept in the existing two-director store (behaviour_proposals / behaviour_confirmations, keys "late.*"),
// which refuses in the database a proposer confirming their own proposal. Every value carries effectiveFrom (the 1st of a month); a month uses the confirmed
// version with the latest effectiveFrom on or before its 1st. Nothing confirmed: the rule is OFF, and missing punch / half-day thresholds are today's behaviour.

export const LATE_KEYS = ["late.rule", "late.missingPunch", "late.halfDay"] as const;
export type LateKey = (typeof LATE_KEYS)[number];

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "A time as HH:MM, for example 10:10");
const monthStart = z.iso.date().refine((d) => d.endsWith("-01"), "Settings start on the 1st of a month");
const days = z.enum(["0.5", "1", "1.5", "2"]);
const rupees = z.string().regex(/^\d{1,6}(\.\d{1,2})?$/, "Rupees, up to two decimals").refine((s) => Number(s) > 0, "More than zero");
const outcome = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("NOT_SET") }).strict(),
  z.object({ kind: z.literal("NONE") }).strict(),
  z.object({ kind: z.literal("MARK") }).strict(),
  z.object({ kind: z.literal("CUT"), days }).strict(),
  z.object({ kind: z.literal("PENALTY"), amount: rupees }).strict(),
]);
const applies = z.discriminatedUnion("mode", [z.object({ mode: z.literal("EVERY_TIME") }).strict(), z.object({ mode: z.literal("AFTER_FREE"), free: z.number().int().min(1).max(31) }).strict()]);
const cutoff = z.object({ time: hhmm, edge: z.enum(["INCLUSIVE", "EXCLUSIVE"]) }).strict();
const band = z.object({ outcome, applies }).strict();

export const ruleSchema = z
  .object({
    effectiveFrom: monthStart,
    active: z.boolean(),
    cutoffs: z.tuple([cutoff, cutoff, cutoff]),
    bands: z.tuple([band, band, band]),
    penaltyHead: z.string().regex(/^[A-Z][A-Z0-9_]{1,31}$/).nullable(),
  })
  .strict()
  .refine((v) => v.cutoffs[0].time < v.cutoffs[1].time && v.cutoffs[1].time < v.cutoffs[2].time, { message: "Each cutoff must be later than the one before", path: ["cutoffs"] })
  .refine((v) => !v.bands.some((b) => b.outcome.kind === "PENALTY") || v.penaltyHead !== null, { message: "A penalty needs the deduction head it is paid through", path: ["penaltyHead"] });
export const missingPunchSchema = z.object({ effectiveFrom: monthStart, outcome: z.enum(["ABSENT_FULL_DAY", "HALF_DAY", "PRESENT_FLAGGED"]) }).strict();
export const halfDaySchema = z
  .object({ effectiveFrom: monthStart, fullDayMinMinutes: z.number().int().min(60).max(1440), halfDayMinMinutes: z.number().int().min(30).max(1440), halfDayMinNotMetLopDays: z.enum(["0.5", "1"]) })
  .strict()
  .refine((v) => v.halfDayMinMinutes < v.fullDayMinMinutes, { message: "A half day needs fewer minutes than a full day", path: ["halfDayMinMinutes"] });

const SCHEMAS = { "late.rule": ruleSchema, "late.missingPunch": missingPunchSchema, "late.halfDay": halfDaySchema } as const;

export const TITLES: Record<LateKey, { title: string; what: string; defaultText: string }> = {
  "late.rule": {
    title: "Lateness rule",
    what: "Cutoffs (and whether the edge minute counts as late), what each band of lateness costs (nothing, a late mark, a salary cut in days through loss of pay, or a fixed penalty as its own payslip deduction), and free allowances a month. Off until two directors switch it on.",
    defaultText: "Off: nobody is marked late by this rule and nothing changes anywhere",
  },
  "late.missingPunch": {
    title: "Missing punch (only one punch on a working day)",
    what: "What a working day with a single punch becomes once the day has closed.",
    defaultText: "Default in use: absent, a full day of loss of pay (as today)",
  },
  "late.halfDay": {
    title: "Half-day thresholds",
    what: "Minutes worked for a full day and for a half day, and the loss of pay when even the half-day minimum is not met. When set, these replace every attendance policy's own figures.",
    defaultText: "Default in use: each attendance policy's own thresholds (Attendance Settings), as today",
  },
};

interface Confirmed<T> {
  id: string;
  value: T;
  reason: string;
  proposedByUserId: string;
  confirmedByUserId: string;
  confirmedAt: Date;
  createdAt: Date;
}

async function confirmedVersions<T extends { effectiveFrom: string }>(key: LateKey): Promise<Array<Confirmed<T>>> {
  const rows = await prisma.behaviourProposal.findMany({ where: { key, confirmation: { isNot: null } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { confirmation: true } });
  return rows.map((r) => ({ id: r.id, value: r.value as unknown as T, reason: r.reason, proposedByUserId: r.proposedByUserId, confirmedByUserId: r.confirmation!.confirmedByUserId, confirmedAt: r.confirmation!.createdAt, createdAt: r.createdAt }));
}

/** The version in force for the month starting `monthFirst` (YYYY-MM-01): the latest effectiveFrom on or before it; a later confirmation wins a tie. */
export function versionFor<T extends { effectiveFrom: string }>(versions: Array<{ value: T; confirmedAt: Date }>, monthFirst: string): T | null {
  let best: { value: T; confirmedAt: Date } | null = null;
  for (const v of versions) {
    if (v.value.effectiveFrom > monthFirst) continue;
    if (!best || v.value.effectiveFrom > best.value.effectiveFrom || (v.value.effectiveFrom === best.value.effectiveFrom && v.confirmedAt >= best.confirmedAt)) best = v;
  }
  return best?.value ?? null;
}

export interface MonthSettings {
  rule: LateRule | null; // null = off (nothing confirmed, or confirmed with active: false)
  ruleConfigured: LateRule | null; // the version in force whether active or not (for display)
  missingPunch: MissingPunchSetting | null; // null = today's behaviour
  halfDay: HalfDaySetting | null; // null = each policy's own thresholds
}

/** Settings for each month (keys YYYY-MM) of the list, read once. */
export async function settingsForMonths(months: string[]): Promise<Map<string, MonthSettings>> {
  const [rules, missing, half] = await Promise.all([confirmedVersions<LateRule>("late.rule"), confirmedVersions<MissingPunchSetting>("late.missingPunch"), confirmedVersions<HalfDaySetting>("late.halfDay")]);
  const out = new Map<string, MonthSettings>();
  for (const m of months) {
    const first = `${m}-01`;
    const r = versionFor(rules, first);
    out.set(m, { rule: r && r.active ? r : null, ruleConfigured: r, missingPunch: versionFor(missing, first), halfDay: versionFor(half, first) });
  }
  return out;
}

export async function settingsForMonth(month: string): Promise<MonthSettings> {
  return (await settingsForMonths([month])).get(month)!;
}

export interface Actor {
  userId: string;
  ip?: string | null;
}

const monthEnd = (first: string) => {
  const d = new Date(`${first}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
};

/** A finalised month is never recomputed except through the existing correction path: a setting cannot start inside one. */
async function refuseFinalised(effectiveFrom: string): Promise<void> {
  const locked = await finalisedPeriodsOverlapping(effectiveFrom, monthEnd(effectiveFrom));
  if (locked.length) throw new HttpError(409, `Attendance from ${locked[0]!.from} to ${locked[0]!.to} is finalised. A setting cannot start in a finalised month; choose a later month.`, "MONTH_FINALISED");
}

async function refuseUnknownDeductionHead(head: string | null): Promise<void> {
  if (!head) return;
  const v = await prisma.payrollItemVersion.findFirst({ where: { kind: "COMPONENT", key: head, authorUserId: { not: null } }, orderBy: { version: "desc" }, select: { value: true } });
  if (!v) throw new HttpError(400, `'${head}' is not a salary head in this company. Add a deduction head under Payroll, Salary Components first.`, "UNKNOWN_SALARY_HEAD");
  if ((v.value as { type?: string }).type !== "DEDUCTION") throw new HttpError(400, `'${head}' is not a deduction head. A penalty is paid through a deduction head.`, "NOT_A_DEDUCTION");
}

export const proposeBody = z.object({ value: z.unknown(), reason: z.string().trim().min(3).max(300) }).strict();

export async function propose(key: string, raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "propose a lateness or attendance-outcome setting");
  if (!(LATE_KEYS as readonly string[]).includes(key)) throw new HttpError(404, "There is no such setting.", "NOT_FOUND");
  const k = key as LateKey;
  const body = proposeBody.safeParse(raw);
  if (!body.success) throw new HttpError(400, body.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const parsed = SCHEMAS[k].safeParse(body.data.value);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join(".") || "value"}: ${i.message}`).join("; "), "VALIDATION_ERROR");
  await refuseFinalised(parsed.data.effectiveFrom);
  if (k === "late.rule") await refuseUnknownDeductionHead((parsed.data as LateRule).penaltyHead);
  const row = await prisma.behaviourProposal.create({ data: { key: k, value: parsed.data as object, reason: body.data.reason, proposedByUserId: actor.userId } });
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "settings.lateness.proposed", entityType: "BehaviourProposal", entityId: row.id, after: { key: k, value: parsed.data, reason: body.data.reason } });
  const me = await prisma.user.findUnique({ where: { id: actor.userId }, select: { employeeId: true } });
  for (const d of await activeDirectors()) {
    if (d.userId === actor.userId || d.employeeId === me?.employeeId) continue;
    await notifyEmployee(d.employeeId, { type: "settings.lateness.proposed", title: `A change to "${TITLES[k].title}" waits for you`, body: "Another director proposed it; you confirm it or leave it.", link: "/admin/workforce/attendance/lateness-rule" });
  }
  return { id: row.id };
}

export async function confirm(proposalId: string, actor: Actor) {
  await requireDirector(actor.userId, "confirm a lateness or attendance-outcome setting");
  const p = await prisma.behaviourProposal.findUnique({ where: { id: proposalId }, include: { confirmation: true } });
  if (!p || !(LATE_KEYS as readonly string[]).includes(p.key)) throw new HttpError(404, "There is no such proposal.", "NOT_FOUND");
  if (p.confirmation) throw new HttpError(409, "This proposal is already confirmed.", "ALREADY_CONFIRMED");
  if (p.proposedByUserId === actor.userId) throw new HttpError(403, "You proposed this, so a different director confirms it.", "CHECKER_IS_MAKER");
  const newer = await prisma.behaviourProposal.findFirst({ where: { key: p.key, createdAt: { gt: p.createdAt } }, select: { id: true } });
  if (newer) throw new HttpError(409, "A newer proposal for this setting replaces this one.", "SUPERSEDED");
  const value = p.value as { effectiveFrom: string };
  await refuseFinalised(value.effectiveFrom); // a month may have been finalised since it was proposed
  await prisma.behaviourConfirmation.create({ data: { proposalId, confirmedByUserId: actor.userId } });
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "settings.lateness.confirmed", entityType: "BehaviourProposal", entityId: proposalId, after: { key: p.key, value: p.value } });
  // Days from the start date to today are worked out again under the new setting (finalised days never are).
  const today = businessToday().toISOString().slice(0, 10);
  const dates: Date[] = [];
  for (let d = new Date(`${value.effectiveFrom}T00:00:00Z`); d.toISOString().slice(0, 10) <= today; d = new Date(d.getTime() + 86_400_000)) dates.push(d);
  await requestRecomputeForEveryone(dates);
  return { key: p.key, value: p.value };
}

export async function list(actor: Actor) {
  await requireDirector(actor.userId, "see lateness settings");
  const month = businessToday().toISOString().slice(0, 7);
  const out = [];
  for (const key of LATE_KEYS) {
    const [versions, pending] = await Promise.all([confirmedVersions<{ effectiveFrom: string }>(key), prisma.behaviourProposal.findMany({ where: { key, confirmation: null }, orderBy: { createdAt: "desc" }, take: 10 })]);
    const names = await namesOfUsers([...versions.flatMap((v) => [v.proposedByUserId, v.confirmedByUserId]), ...pending.map((p) => p.proposedByUserId)]);
    const inForce = versionFor(versions, `${month}-01`);
    const latestPending = pending[0] ?? null;
    out.push({
      key,
      ...TITLES[key],
      inForce,
      defaultInUse: inForce === null,
      starting: key === "late.rule" ? DEFAULT_RULE : null,
      history: versions
        .slice()
        .reverse()
        .map((v) => ({ id: v.id, value: v.value, reason: v.reason, proposedBy: names.get(v.proposedByUserId) ?? "A director", confirmedBy: names.get(v.confirmedByUserId) ?? "A director", at: v.confirmedAt.toISOString() })),
      pending: latestPending ? [{ id: latestPending.id, value: latestPending.value, reason: latestPending.reason, proposedBy: names.get(latestPending.proposedByUserId) ?? "A director", mine: latestPending.proposedByUserId === actor.userId, at: latestPending.createdAt.toISOString() }] : [],
    });
  }
  return { month, settings: out };
}
