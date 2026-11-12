import { z, type ZodTypeAny } from "zod";
import { DEFAULT_LABEL, INACTIVE_LABEL, NOT_SET_LABEL, POLICY_SETTINGS, policyDef, type PolicyField, type PolicySettingDef } from "@shared/constants/policySettings";
import { writeAuditLog } from "../../lib/audit";
import { activeDirectors, requireDirector } from "../../lib/directorAuthority";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { namesOfUsers } from "../payroll/names";
import { notifyEmployee } from "../notifications/notifyEmployee";

// M session, block 2: the policy settings of the decision rows (shared/constants/policySettings.ts). Stored in the D-37 two-director store
// (behaviour_proposals / behaviour_confirmations, keys "policy.*"), which already refuses a proposer confirming their own proposal in the database.
// An activation setting has no effect until a confirmed proposal turns it on: `policyInForce` returns null for it until then.

function fieldSchema(f: PolicyField): ZodTypeAny {
  switch (f.type) {
    case "boolean":
      return z.boolean();
    case "int": {
      const n = z.number().int().min(f.min).max(f.max);
      return f.optional ? n.nullable().optional() : n;
    }
    case "choice":
      return z.enum(f.options.map((o) => o.value) as [string, ...string[]]);
    case "codes":
      return z.array(z.string().trim().regex(/^[A-Z0-9_-]{1,40}$/, "Codes in capitals, for example PL")).max(f.max);
    case "lines":
      return z.array(z.string().trim().min(1).max(200)).max(f.max);
  }
}

export function valueSchema(def: PolicySettingDef) {
  const shape: Record<string, ZodTypeAny> = Object.fromEntries(def.fields.map((f) => [f.name, fieldSchema(f)]));
  if (def.kind === "activation") shape.active = z.boolean();
  return z.object(shape).strict();
}

async function latestConfirmed(key: string) {
  return prisma.behaviourProposal.findFirst({ where: { key, confirmation: { isNot: null } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: { confirmation: true } });
}

export type PolicyState = "DEFAULT" | "CONFIRMED" | "INACTIVE" | "NOT_SET";

/**
 * The value in force. plain: the confirmed value, else the default. activation: the confirmed value only when it is on, else null (no effect).
 * notSet: the confirmed value, else null.
 */
export async function policyInForce<T extends Record<string, unknown>>(key: string): Promise<T | null> {
  const def = policyDef(key);
  if (!def) throw new Error(`Unknown policy setting ${key}`);
  const row = await latestConfirmed(key);
  if (!row) return def.kind === "plain" ? (def.defaultValue as T) : null;
  const v = row.value as T & { active?: boolean };
  if (def.kind === "activation" && v.active !== true) return null;
  return v;
}

export interface Actor {
  userId: string;
  ip?: string | null;
}

export async function list(actor: Actor) {
  await requireDirector(actor.userId, "see policy settings");
  const out = [];
  for (const def of POLICY_SETTINGS) {
    const [current, pending] = await Promise.all([latestConfirmed(def.key), prisma.behaviourProposal.findMany({ where: { key: def.key, confirmation: null }, orderBy: { createdAt: "desc" }, take: 10 })]);
    const names = await namesOfUsers([current?.proposedByUserId ?? "", current?.confirmation?.confirmedByUserId ?? "", ...pending.map((p) => p.proposedByUserId)].filter(Boolean));
    const value = current ? (current.value as Record<string, unknown>) : def.defaultValue;
    const active = def.kind === "activation" ? current !== null && (current.value as { active?: boolean }).active === true : null;
    const state: PolicyState = def.kind === "activation" ? (active ? "CONFIRMED" : "INACTIVE") : current ? "CONFIRMED" : def.kind === "plain" ? "DEFAULT" : "NOT_SET";
    out.push({
      key: def.key,
      area: def.area,
      row: def.row,
      title: def.title,
      what: def.what,
      kind: def.kind,
      fields: def.fields,
      value,
      active,
      state,
      label: state === "DEFAULT" ? DEFAULT_LABEL : state === "INACTIVE" ? INACTIVE_LABEL : state === "NOT_SET" ? NOT_SET_LABEL : null,
      suggestion: def.kind === "activation" ? def.defaultValue : null,
      confirmed: current ? { reason: current.reason, proposedBy: names.get(current.proposedByUserId) ?? "A director", confirmedBy: names.get(current.confirmation!.confirmedByUserId) ?? "A director", at: current.confirmation!.createdAt.toISOString() } : null,
      pending: pending.map((p) => ({ id: p.id, value: p.value, reason: p.reason, proposedBy: names.get(p.proposedByUserId) ?? "A director", mine: p.proposedByUserId === actor.userId, at: p.createdAt.toISOString() })),
    });
  }
  return { settings: out };
}

export const proposeSchema = z.object({ value: z.unknown(), reason: z.string().trim().min(3).max(300) }).strict();

export async function propose(key: string, raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "propose a policy setting");
  const def = policyDef(key);
  if (!def) throw new HttpError(404, "There is no such setting.", "NOT_FOUND");
  const body = proposeSchema.safeParse(raw);
  if (!body.success) throw new HttpError(400, body.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const value = valueSchema(def).safeParse(body.data.value);
  if (!value.success) throw new HttpError(400, value.error.issues.map((i) => `${i.path.join(".") || "value"}: ${i.message}`).join("; "), "VALIDATION_ERROR");
  const extra = await validateExtra(def.key, value.data);
  if (extra) throw new HttpError(400, extra, "VALIDATION_ERROR");
  const row = await prisma.behaviourProposal.create({ data: { key: def.key, value: value.data as object, reason: body.data.reason, proposedByUserId: actor.userId } });
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "settings.policy.proposed", entityType: "BehaviourProposal", entityId: row.id, after: { key: def.key, value: value.data, reason: body.data.reason } });
  const me = await prisma.user.findUnique({ where: { id: actor.userId }, select: { employeeId: true } });
  for (const d of await activeDirectors()) {
    if (d.userId === actor.userId || d.employeeId === me?.employeeId) continue;
    await notifyEmployee(d.employeeId, { type: "settings.policy.proposed", title: `A change to "${def.title}" waits for you`, body: "Another director proposed it; you confirm it or leave it.", link: "/admin/settings/policies" });
  }
  return { id: row.id };
}

export async function confirm(proposalId: string, actor: Actor) {
  await requireDirector(actor.userId, "confirm a policy setting");
  const p = await prisma.behaviourProposal.findUnique({ where: { id: proposalId }, include: { confirmation: true } });
  const def = p ? policyDef(p.key) : undefined;
  if (!p || !def) throw new HttpError(404, "There is no such proposal.", "NOT_FOUND");
  if (p.confirmation) throw new HttpError(409, "This proposal is already confirmed.", "ALREADY_CONFIRMED");
  if (p.proposedByUserId === actor.userId) throw new HttpError(403, "You proposed this, so a different director confirms it.", "CHECKER_IS_MAKER");
  const newer = await prisma.behaviourProposal.findFirst({ where: { key: p.key, createdAt: { gt: p.createdAt } }, select: { id: true } });
  if (newer) throw new HttpError(409, "A newer proposal for this setting replaces this one.", "SUPERSEDED");
  const before = await latestConfirmed(p.key);
  await prisma.behaviourConfirmation.create({ data: { proposalId, confirmedByUserId: actor.userId } });
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "settings.policy.confirmed", entityType: "BehaviourProposal", entityId: proposalId, before: { key: p.key, value: before?.value ?? def.defaultValue, inForce: !!before }, after: { key: p.key, value: p.value } });
  return { key: p.key, value: p.value };
}

/** Checks a field schema cannot express (the line formats, and codes that must exist). */
async function validateExtra(key: string, value: Record<string, unknown>): Promise<string | null> {
  if (key === "policy.onboarding") {
    for (const line of value.items as string[]) if (!parseOnboardingLine(line)) return `"${line}" is not OWNER | days | step (OWNER is HR, MANAGER or EMPLOYEE)`;
  }
  if (key === "policy.leaveLimits") {
    for (const line of value.rules as string[]) if (!parseLeaveLimitLine(line)) return `"${line}" is not CODE | most days | notice days`;
    const codes = (value.rules as string[]).map((l) => parseLeaveLimitLine(l)!.code);
    const missing = await missingLeaveTypes(codes);
    if (missing.length) return `No leave type with code ${missing.join(", ")}`;
  }
  if (key === "policy.sandwich" || key === "policy.encashmentRequests") {
    const missing = await missingLeaveTypes(value.leaveTypes as string[]);
    if (missing.length) return `No leave type with code ${missing.join(", ")}`;
  }
  if (key === "policy.wfh") {
    const codes = value.departments as string[];
    const found = await prisma.department.findMany({ where: { code: { in: codes } }, select: { code: true } });
    const missing = codes.filter((c) => !found.some((f) => f.code === c));
    if (missing.length) return `No department with code ${missing.join(", ")}`;
  }
  return null;
}

async function missingLeaveTypes(codes: string[]): Promise<string[]> {
  const found = await prisma.leaveType.findMany({ where: { code: { in: codes } }, select: { code: true } });
  return codes.filter((c) => !found.some((f) => f.code === c));
}

export function parseOnboardingLine(line: string): { owner: "HR" | "MANAGER" | "EMPLOYEE"; days: number; step: string } | null {
  const m = /^\s*(HR|MANAGER|EMPLOYEE)\s*\|\s*(\d{1,3})\s*\|\s*(.{3,160})$/.exec(line);
  return m ? { owner: m[1] as "HR" | "MANAGER" | "EMPLOYEE", days: Number(m[2]), step: m[3]!.trim() } : null;
}

export function parseLeaveLimitLine(line: string): { code: string; maxDays: number; noticeDays: number } | null {
  const m = /^\s*([A-Z0-9_-]{1,40})\s*\|\s*(\d{1,3})\s*\|\s*(\d{1,3})\s*$/.exec(line);
  if (!m) return null;
  const maxDays = Number(m[2]);
  return maxDays >= 1 ? { code: m[1]!, maxDays, noticeDays: Number(m[3]) } : null;
}
