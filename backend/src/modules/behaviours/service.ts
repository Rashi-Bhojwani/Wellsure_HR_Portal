import { z } from "zod";
import { writeAuditLog } from "../../lib/audit";
import { requireDirector } from "../../lib/directorAuthority";
import { namesOfUsers } from "../payroll/names";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";

// D-37 (docs/plans/D37_DEFAULTS.md). Behaviour settings: each key's value in force is the latest proposal a DIFFERENT director confirmed; with none, it is the key's
// default. Exactly three keys have a common default (the owners' D-37 exception, labelled "Default, change in settings"); the max-deduction percentage has none (Not set).
// Proposals and confirmations are append-only in the database, which also refuses a proposer confirming their own proposal.

export const DEFAULT_LABEL = "Default, change in settings";
export const LOAN_SHORTFALL_RULES = ["STOP_RUN", "SKIP_AND_CARRY", "PARTIAL_AND_CARRY"] as const;
export type LoanShortfallRule = (typeof LOAN_SHORTFALL_RULES)[number];
export const LEAVING_MONTH_MODES = ["NONE", "FULL_MONTH", "PRO_RATA_DAYS_WORKED", "FULL_IF_MIN_DAYS"] as const;
export type LeavingMonthAccrual = { mode: "NONE" | "FULL_MONTH" | "PRO_RATA_DAYS_WORKED" } | { mode: "FULL_IF_MIN_DAYS"; minDays: number };

const percentText = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, "A percentage, for example 50")
  .refine((s) => Number(s) > 0 && Number(s) <= 100, "More than 0 and at most 100"); // allow-number: a percentage's bounds

export const BEHAVIOURS = {
  "loan.shortfall": {
    title: "Loan instalment when net pay is too low",
    what: "Per loan type: stop the run, skip the instalment and carry it forward, or recover what net pay allows and carry the rest. Net pay never goes below zero because of a loan.",
    schema: z.record(z.string().regex(/^[A-Z][A-Z0-9_]{1,31}$/), z.enum(LOAN_SHORTFALL_RULES)),
    /** A loan type not named uses SKIP_AND_CARRY. */
    defaultValue: {} as Record<string, LoanShortfallRule>,
    d37: true,
    defaultText: "Skip the instalment and carry it forward, with a warning naming the loan (every loan type)",
  },
  "leave.leavingMonthAccrual": {
    title: "Leave accrual in the month of leaving",
    what: "None, a full month, pro-rata by days worked (the policy's own rounding), or a full month only if at least N days were worked (N has no default).",
    schema: z.discriminatedUnion("mode", [
      z.object({ mode: z.enum(["NONE", "FULL_MONTH", "PRO_RATA_DAYS_WORKED"]) }).strict(),
      z.object({ mode: z.literal("FULL_IF_MIN_DAYS"), minDays: z.number().int().min(1).max(31) }).strict(), // allow-number: days in a month
    ]),
    defaultValue: { mode: "PRO_RATA_DAYS_WORKED" } as LeavingMonthAccrual,
    d37: true,
    defaultText: "Pro-rata by days worked, using the leave policy's rounding",
  },
  "leave.proRataRounding": {
    title: "Rounding of a pro-rata leave figure",
    what: "How a pro-rata leave accrual that is not exact to two decimals is rounded (a mode and 0 to 2 decimals). The leave policy has no rounding of its own.",
    schema: z.object({ mode: z.enum(["HALF_UP", "HALF_EVEN", "UP", "DOWN", "CEIL", "FLOOR"]), scale: z.number().int().min(0).max(2) }).strict(), // allow-number: decimals of a day
    defaultValue: null as { mode: "HALF_UP" | "HALF_EVEN" | "UP" | "DOWN" | "CEIL" | "FLOOR"; scale: number } | null,
    d37: false,
    defaultText: "Not set: a pro-rata figure that needs rounding waits for this; an exact one is applied",
  },
  "access.developerSeesSwipes": {
    title: "The Developer role sees Employee Swipes",
    what: "Whether the person who builds and runs the system can open the raw punch log.",
    schema: z.boolean(),
    defaultValue: false as boolean,
    d37: true,
    defaultText: "Off: the Developer role does not see Employee Swipes",
  },
  // M session, task 1 (docs/plans/M_CHECKLIST.md): decision b. Off = HR's entries are written at once, as before this setting existed.
  "identity.directorConfirmsHrChanges": {
    title: "A director confirms HR's bank and statutory changes before they take effect",
    what: "When on, a bank account or a PAN, Aadhaar, UAN or ESI number entered by HR waits, masked, until a director other than the person who entered it confirms it. A director's change to their own record always waits for the other director.",
    schema: z.boolean(),
    defaultValue: true as boolean,
    d37: true,
    defaultText: "On: a director confirms HR's bank and statutory changes before they take effect",
  },
  // M session, LT-08: which letter templates an employee may ask for (codes). Empty by default: nobody can ask until a director lists one.
  "letters.employeeMayAsk": {
    title: "Letters an employee may ask for",
    what: "The letter templates (by code) an employee can ask for from their Document Center, for example an address proof. Whoever may prepare the template then prepares it or declines with a reason.",
    schema: z.array(z.string().regex(/^[A-Z0-9_]{1,40}$/)).max(50), // allow-number: template codes, a short list
    defaultValue: [] as string[],
    d37: true,
    defaultText: "None: employees cannot ask for a letter until a director lists a template",
  },
  "loan.maxTotalDeductionPercent": {
    title: "Most a month's deductions may take (percentage of gross)",
    what: "When set, loan instalments are limited so total deductions stay within this percentage of gross earnings; the shortfall rule applies to what does not fit. Owner-entered with a source note.",
    schema: z.object({ percent: percentText, sourceNote: z.string().trim().min(3).max(300) }).strict(),
    defaultValue: null as { percent: string; sourceNote: string } | null,
    d37: false,
    defaultText: "Not set: no percentage limit (net pay still never goes below zero because of a loan)",
  },
} as const;
export type BehaviourKey = keyof typeof BEHAVIOURS;
export const BEHAVIOUR_KEYS = Object.keys(BEHAVIOURS) as BehaviourKey[];
type ValueOf<K extends BehaviourKey> = (typeof BEHAVIOURS)[K]["defaultValue"] | z.infer<(typeof BEHAVIOURS)[K]["schema"]>;

export interface Actor {
  userId: string;
  ip?: string | null;
}

async function confirmedLatest(key: BehaviourKey) {
  return prisma.behaviourProposal.findFirst({ where: { key, confirmation: { isNot: null } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: { confirmation: true } });
}

/** The value in force: the latest confirmed proposal, or the key's default. */
export async function behaviourValue<K extends BehaviourKey>(key: K): Promise<{ value: ValueOf<K>; isDefault: boolean }> {
  const row = await confirmedLatest(key);
  return row ? { value: row.value as ValueOf<K>, isDefault: false } : { value: BEHAVIOURS[key].defaultValue as ValueOf<K>, isDefault: true };
}

export async function loanShortfallRuleFor(typeKey: string): Promise<LoanShortfallRule> {
  return (await behaviourValue("loan.shortfall")).value[typeKey] ?? "SKIP_AND_CARRY";
}

export async function list(actor: Actor) {
  await requireDirector(actor.userId, "see default behaviours");
  const out = [];
  for (const key of BEHAVIOUR_KEYS) {
    const def = BEHAVIOURS[key];
    const [current, pending] = await Promise.all([confirmedLatest(key), prisma.behaviourProposal.findMany({ where: { key, confirmation: null }, orderBy: { createdAt: "desc" }, take: 20 })]);
    const names = await namesOfUsers([current?.proposedByUserId ?? "", current?.confirmation?.confirmedByUserId ?? "", ...pending.map((p) => p.proposedByUserId)].filter(Boolean));
    out.push({
      key,
      title: def.title,
      what: def.what,
      d37: def.d37,
      value: current ? current.value : def.defaultValue,
      state: current ? "CONFIRMED" : def.d37 ? "DEFAULT" : "NOT_SET",
      label: current ? null : def.d37 ? DEFAULT_LABEL : "Not set",
      defaultText: def.defaultText,
      confirmed: current ? { reason: current.reason, proposedBy: names.get(current.proposedByUserId) ?? "A director", confirmedBy: names.get(current.confirmation!.confirmedByUserId) ?? "A director", at: current.confirmation!.createdAt.toISOString() } : null,
      pending: pending.map((p) => ({ id: p.id, value: p.value, reason: p.reason, proposedBy: names.get(p.proposedByUserId) ?? "A director", mine: p.proposedByUserId === actor.userId, at: p.createdAt.toISOString() })),
    });
  }
  return { behaviours: out };
}

export const proposeSchema = z.object({ value: z.unknown(), reason: z.string().trim().min(3).max(300) }).strict();

export async function propose(key: string, raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "propose a change to a default behaviour");
  if (!(BEHAVIOUR_KEYS as string[]).includes(key)) throw new HttpError(404, "There is no such setting.", "NOT_FOUND");
  const k = key as BehaviourKey;
  const body = proposeSchema.safeParse(raw);
  if (!body.success) throw new HttpError(400, body.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const value = BEHAVIOURS[k].schema.safeParse(body.data.value);
  if (!value.success) throw new HttpError(400, value.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const row = await prisma.behaviourProposal.create({ data: { key: k, value: value.data as object, reason: body.data.reason, proposedByUserId: actor.userId } });
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "settings.behaviour.proposed", entityType: "BehaviourProposal", entityId: row.id, after: { key: k, value: value.data, reason: body.data.reason } });
  return { id: row.id };
}

export async function confirm(proposalId: string, actor: Actor) {
  await requireDirector(actor.userId, "confirm a change to a default behaviour");
  const p = await prisma.behaviourProposal.findUnique({ where: { id: proposalId }, include: { confirmation: true } });
  // M session block 2: the policy settings share these tables; they are confirmed through /api/policy-settings only.
  if (!p || !(BEHAVIOUR_KEYS as string[]).includes(p.key)) throw new HttpError(404, "There is no such proposal.", "NOT_FOUND");
  if (p.confirmation) throw new HttpError(409, "This proposal is already confirmed.", "ALREADY_CONFIRMED");
  if (p.proposedByUserId === actor.userId) throw new HttpError(403, "You proposed this, so a different director confirms it.", "CHECKER_IS_MAKER");
  // A newer proposal for the same key replaces an older one waiting: only the newest waiting one can be confirmed.
  const newer = await prisma.behaviourProposal.findFirst({ where: { key: p.key, createdAt: { gt: p.createdAt } }, select: { id: true } });
  if (newer) throw new HttpError(409, "A newer proposal for this setting replaces this one.", "SUPERSEDED");
  const before = await behaviourValue(p.key as BehaviourKey);
  await prisma.behaviourConfirmation.create({ data: { proposalId, confirmedByUserId: actor.userId } });
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "settings.behaviour.confirmed", entityType: "BehaviourProposal", entityId: proposalId, before: { key: p.key, value: before.value, isDefault: before.isDefault }, after: { key: p.key, value: p.value } });
  return { key: p.key, value: p.value };
}
