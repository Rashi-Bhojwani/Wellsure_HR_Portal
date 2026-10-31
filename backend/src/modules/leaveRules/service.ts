import { Prisma } from "@prisma/client";
import { PEEPS_LEAVE_TYPE_CODES, isPeepsLeaveTypeCode, type PeepsLeaveTypeCode } from "@shared/constants/peepsLeave";
import { writeAuditLogs } from "../../lib/audit";
import { businessToday } from "../../lib/businessDate";
import { inForceOn } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import type { ActorMeta } from "../peeps/types";
import { leaveRulesSchema, type LeaveRules } from "./rules";

// Governance of the four new leave types (Q-15). HR (leave.policy.manage) or a director prepares a rule version; a different director approves it,
// effective from a date that is not in the past (service + database trigger). Approval activates the type and sets its paid / half-day flags and policy
// row from the rules; a newer version voids the approval (the type is switched off) until it is approved itself. Versions and approvals are append-only.

export interface RulesActor {
  userId: string;
  isDirector: boolean;
  canPrepare: boolean; // leave.policy.manage, or a director
}

type VersionRow = Prisma.LeaveRuleVersionGetPayload<{ include: { approval: true } }>;

const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

async function typeByCode(code: string, client: Prisma.TransactionClient | typeof prisma = prisma) {
  if (!isPeepsLeaveTypeCode(code)) throw new HttpError(404, "Not one of the new leave types.", "NOT_FOUND");
  const t = await client.leaveType.findUnique({ where: { code } });
  if (!t) throw new HttpError(404, "Leave type not found.", "NOT_FOUND");
  return t;
}

/** The rules in force for a new-type leave starting on `onDate`: the latest version, if it is approved and effective by then; otherwise null. */
export async function rulesInForce(leaveTypeId: string, onDate: Date, client: Prisma.TransactionClient | typeof prisma = prisma): Promise<{ version: number; rules: LeaveRules; effectiveFrom: Date } | null> {
  const latest = await client.leaveRuleVersion.findFirst({ where: { leaveTypeId }, orderBy: { version: "desc" }, include: { approval: true } });
  if (!latest?.approval || latest.approval.effectiveFrom.getTime() > onDate.getTime()) return null;
  return { version: latest.version, rules: leaveRulesSchema.parse(latest.rules), effectiveFrom: latest.approval.effectiveFrom };
}

function present(v: VersionRow) {
  return {
    version: v.version,
    rules: v.rules as LeaveRules,
    note: v.note,
    preparedByUserId: v.preparedByUserId,
    preparedAt: v.preparedAt.toISOString(),
    approval: v.approval ? { approvedByUserId: v.approval.approvedByUserId, approvedAt: v.approval.approvedAt.toISOString(), effectiveFrom: dateOnly(v.approval.effectiveFrom), note: v.approval.note } : null,
  };
}

export type RulesState = "NOT_SET" | "AWAITING_APPROVAL" | "APPROVED";

/** The four types with their state, the version in force, the one awaiting approval and the history (newest first). */
export async function listRules(viewerUserId?: string) {
  const types = await prisma.leaveType.findMany({ where: { code: { in: [...PEEPS_LEAVE_TYPE_CODES] } }, include: { ruleVersions: { include: { approval: true }, orderBy: { version: "desc" } } } });
  const names = await userNames(types.flatMap((t) => t.ruleVersions.flatMap((v) => [v.preparedByUserId, ...(v.approval ? [v.approval.approvedByUserId] : [])])));
  return PEEPS_LEAVE_TYPE_CODES.map((code) => {
    const t = types.find((x) => x.code === code)!;
    const latest = t.ruleVersions[0];
    const approved = t.ruleVersions.find((v) => v.approval);
    const state: RulesState = !latest ? "NOT_SET" : latest.approval ? "APPROVED" : "AWAITING_APPROVAL";
    const withNames = (v: VersionRow) => ({ ...present(v), preparedBy: names.get(v.preparedByUserId) ?? "", preparedByMe: v.preparedByUserId === viewerUserId, approvedBy: v.approval ? (names.get(v.approval.approvedByUserId) ?? "") : null });
    return {
      code,
      leaveTypeId: t.id,
      name: t.name,
      isActive: t.isActive,
      state,
      inForce: latest?.approval ? withNames(latest) : null,
      awaiting: latest && !latest.approval ? withNames(latest) : null,
      voidedVersion: latest && !latest.approval && approved ? approved.version : null,
      yearEnd: "EXCLUDED" as const, // the year-end process handles PL only; see the plan
      history: t.ruleVersions.map(withNames),
    };
  });
}

async function userNames(userIds: string[]): Promise<Map<string, string>> {
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(userIds)] } }, select: { id: true, employee: { select: { employeeCode: true, nameHistory: { where: inForceOn(), select: { fullName: true } } } } } });
  return new Map(users.map((u) => [u.id, u.employee.nameHistory[0]?.fullName ?? u.employee.employeeCode]));
}

export async function prepareRules(code: string, input: { rules: unknown; note?: string }, actor: RulesActor, meta: ActorMeta) {
  if (!actor.canPrepare) throw new HttpError(403, "Missing permission: leave.policy.manage", "FORBIDDEN");
  const parsed = leaveRulesSchema.safeParse(input.rules);
  if (!parsed.success) throw new HttpError(400, `Every rule must be set: ${parsed.error.issues.map((i) => `${i.path.join(".") || "rules"}: ${i.message}`).join("; ")}`, "VALIDATION_ERROR");
  const created = await prisma.$transaction(
    async (tx) => {
      const t = await typeByCode(code, tx);
      const latest = await tx.leaveRuleVersion.findFirst({ where: { leaveTypeId: t.id }, orderBy: { version: "desc" }, include: { approval: true } });
      const v = await tx.leaveRuleVersion.create({ data: { leaveTypeId: t.id, version: (latest?.version ?? 0) + 1, rules: parsed.data as Prisma.InputJsonValue, note: input.note ?? "", preparedByUserId: actor.userId } });
      const audits: Parameters<typeof writeAuditLogs>[0] = [{ ...meta, action: "leave.rules.prepared", entityType: "LeaveRuleVersion", entityId: v.id, after: { code, version: v.version, rules: parsed.data } }];
      // Any change voids the approval: the type cannot be applied for until this version is approved.
      if (t.isActive) {
        await tx.leaveType.update({ where: { id: t.id }, data: { isActive: false } });
        audits.push({ ...meta, action: "leave.rules.voided", entityType: "LeaveType", entityId: t.id, before: { isActive: true, version: latest?.version ?? null }, after: { isActive: false, pendingVersion: v.version } });
      }
      await writeAuditLogs(audits, tx);
      return v;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  return { code, version: created.version };
}

export async function approveRules(code: string, version: number, input: { effectiveFrom: string; note?: string }, actor: RulesActor, meta: ActorMeta) {
  if (!actor.isDirector) throw new HttpError(403, "Only a director approves leave rules.", "DIRECTORS_ONLY");
  const effectiveFrom = new Date(`${input.effectiveFrom}T00:00:00.000Z`);
  if (effectiveFrom.getTime() < businessToday().getTime()) throw new HttpError(400, "The rules cannot start in the past.", "VALIDATION_ERROR");
  await prisma.$transaction(
    async (tx) => {
      const t = await typeByCode(code, tx);
      const row = await tx.leaveRuleVersion.findUnique({ where: { leaveTypeId_version: { leaveTypeId: t.id, version } }, include: { approval: true } });
      if (!row) throw new HttpError(404, "That version does not exist.", "NOT_FOUND");
      if (row.approval) throw new HttpError(409, "That version is already approved.", "ALREADY_APPROVED");
      const latest = await tx.leaveRuleVersion.findFirst({ where: { leaveTypeId: t.id }, orderBy: { version: "desc" }, select: { version: true } });
      if (latest && latest.version !== version) throw new HttpError(409, "A newer version has been prepared since; approve that one instead.", "STALE_VERSION");
      if (row.preparedByUserId === actor.userId) throw new HttpError(403, "The person who prepared these rules cannot approve them. A different director approves them.", "SAME_PERSON");
      const rules = leaveRulesSchema.parse(row.rules);
      const approval = await tx.leaveRuleApproval.create({ data: { versionId: row.id, approvedByUserId: actor.userId, effectiveFrom, note: input.note ?? "" } });
      // The type follows its approved rules: paid or unpaid, half days or not, and a balance check only for a balance HR grants.
      await tx.leaveType.update({ where: { id: t.id }, data: { isPaid: rules.paid, allowHalfDay: rules.units === "HALF_DAY", isActive: true } });
      const policy = { accrualEnabled: false, negativeBalanceAllowed: false, skipBalanceCheck: rules.entitlement.kind === "CAP", yearEndEncashment: false, carryForwardCapDays: null };
      await tx.leavePolicy.upsert({ where: { leaveTypeId: t.id }, create: { leaveTypeId: t.id, ...policy }, update: policy });
      await writeAuditLogs([{ ...meta, action: "leave.rules.approved", entityType: "LeaveRuleVersion", entityId: row.id, after: { code, version, approvalId: approval.id, effectiveFrom: input.effectiveFrom } }], tx);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  return (await listRules(actor.userId)).find((r) => r.code === code)!;
}

export const peepsLeaveCodes = (): readonly PeepsLeaveTypeCode[] => PEEPS_LEAVE_TYPE_CODES;
