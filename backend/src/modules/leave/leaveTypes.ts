import { Prisma, type LeavePolicy, type LeaveEligibilityMode } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { writeAuditLog } from "../../lib/audit";
import { HttpError } from "../../middleware/errorHandler";
import type { ActorMeta } from "./types";

// Read-only for commit B (every role needs this for the Leave Apply
// dropdown, same as org masters' reads); commit C adds the mutating admin
// endpoints (create/edit type, upsert policy — leave.policy.manage) below.
export async function listActiveLeaveTypes() {
  return prisma.leaveType.findMany({
    where: { isActive: true },
    select: { id: true, code: true, name: true, isPaid: true, allowHalfDay: true },
    orderBy: { code: "asc" },
  });
}

// Prisma's unique-constraint violation (P2002 on leave_types.code) -> a
// friendly 409, same convention org/service.ts's runUnique uses.
async function runUnique<T>(fn: () => Promise<T>, onConflict: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new HttpError(409, onConflict, "CONFLICT");
    }
    throw err;
  }
}

// Every leave_policies Decimal field converted to number — writeAuditLog's
// Json columns and the API response both need this (a raw Prisma.Decimal
// breaks JSON serialisation outright, and even when it doesn't, it
// serialises as a string, not a number — the same class of bug commit B
// fixed for LeaveRequest.totalDays). This is also the shape the admin
// screen receives back from every write, not just what goes in the audit
// log, so the two never drift apart.
function policyToJson(p: LeavePolicy) {
  return {
    id: p.id,
    leaveTypeId: p.leaveTypeId,
    accrualEnabled: p.accrualEnabled,
    accrualDaysPerMonth: p.accrualDaysPerMonth?.toNumber() ?? null,
    eligibilityMode: p.eligibilityMode,
    eligibilityValue: p.eligibilityValue,
    carryForwardCapDays: p.carryForwardCapDays?.toNumber() ?? null,
    negativeBalanceAllowed: p.negativeBalanceAllowed,
    skipBalanceCheck: p.skipBalanceCheck,
    yearEndEncashment: p.yearEndEncashment,
    compOffMinHoursWorked: p.compOffMinHoursWorked?.toNumber() ?? null,
    compOffExpiryDays: p.compOffExpiryDays,
    wfhMonthlyLimit: p.wfhMonthlyLimit,
    wfhYearlyLimit: p.wfhYearlyLimit,
    rhYearlyQuota: p.rhYearlyQuota,
  };
}

// The admin catalog view (Leave Types & Policies screen) — every type,
// active or not (a retired type's history must stay visible), with its
// policy row serialised.
export async function listAllLeaveTypesWithPolicy() {
  const types = await prisma.leaveType.findMany({ include: { policy: true }, orderBy: { code: "asc" } });
  return types.map((t) => ({
    id: t.id,
    code: t.code,
    name: t.name,
    isPaid: t.isPaid,
    allowHalfDay: t.allowHalfDay,
    isActive: t.isActive,
    policy: t.policy ? policyToJson(t.policy) : null,
  }));
}

interface CreateLeaveTypeInput {
  code: string;
  name: string;
  isPaid: boolean;
  allowHalfDay: boolean;
}

export async function createLeaveType(input: CreateLeaveTypeInput, meta: ActorMeta) {
  const leaveType = await runUnique(() => prisma.leaveType.create({ data: input }), `A leave type with code "${input.code}" already exists.`);
  await writeAuditLog({ ...meta, action: "leave.type.create", entityType: "LeaveType", entityId: leaveType.id, after: leaveType });
  return leaveType;
}

interface UpdateLeaveTypeInput {
  name?: string;
  isPaid?: boolean;
  allowHalfDay?: boolean;
  isActive?: boolean;
}

export async function updateLeaveType(id: string, input: UpdateLeaveTypeInput, meta: ActorMeta) {
  const before = await prisma.leaveType.findUnique({ where: { id } });
  if (!before) throw new HttpError(404, "Leave type not found.", "NOT_FOUND");
  const after = await prisma.leaveType.update({ where: { id }, data: input });
  await writeAuditLog({ ...meta, action: "leave.type.update", entityType: "LeaveType", entityId: id, before, after });
  return after;
}

// Every leave_policies field is nullable/optional on this input — the
// admin screen edits one field at a time via a partial form, not a
// full-row replace; whatever's omitted keeps its current stored value
// (a plain Prisma `update`-shaped upsert, not a destructive replace).
interface UpsertPolicyInput {
  accrualEnabled?: boolean;
  accrualDaysPerMonth?: number | null;
  eligibilityMode?: LeaveEligibilityMode | null;
  eligibilityValue?: number | null;
  carryForwardCapDays?: number | null;
  negativeBalanceAllowed?: boolean;
  skipBalanceCheck?: boolean;
  yearEndEncashment?: boolean;
  compOffMinHoursWorked?: number | null;
  compOffExpiryDays?: number | null;
  wfhMonthlyLimit?: number | null;
  wfhYearlyLimit?: number | null;
  rhYearlyQuota?: number | null;
}

export async function upsertLeavePolicy(leaveTypeId: string, input: UpsertPolicyInput, meta: ActorMeta) {
  const leaveType = await prisma.leaveType.findUnique({ where: { id: leaveTypeId }, include: { policy: true } });
  if (!leaveType) throw new HttpError(404, "Leave type not found.", "NOT_FOUND");

  const before = leaveType.policy;
  const after = await prisma.leavePolicy.upsert({
    where: { leaveTypeId },
    create: { leaveTypeId, ...input },
    update: input,
  });

  await writeAuditLog({
    ...meta,
    action: "leave.policy.update",
    entityType: "LeavePolicy",
    entityId: after.id,
    before: before ? policyToJson(before) : null,
    after: policyToJson(after),
  });
  return policyToJson(after);
}
