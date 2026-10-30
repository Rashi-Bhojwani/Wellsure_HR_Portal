import { HR_CAPABILITIES, hrCapability } from "@shared/constants/hrCapabilities";
import { HR_ROLE_CODES } from "@shared/constants/sensitiveData";
import { writeAuditLog } from "../../lib/audit";
import { notifyAccessChanged } from "../../lib/accessChanged";
import { requireDirector, requireDirectorTwoFactor } from "../../lib/directorAuthority";
import { namesOn } from "../../lib/effectiveDating";
import { rowState } from "../../lib/hrCapabilities";
import { SUPER_ADMIN_ROLE_CODE } from "../../lib/permissions";
import { prisma } from "../../lib/prisma";
import { Prisma } from "@prisma/client";
import { HttpError } from "../../middleware/errorHandler";
import { hrCapabilityQueue } from "../../jobs/hrCapabilityQueue";
import type { SetCapabilityInput } from "./validators";

// The HR capability switches (docs/plans/HR_CAPABILITIES.md §1B). Only a director writes; every change needs a reason, is audited, and is a new row (nothing is edited).

export interface Meta {
  actorUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const ONE_YEAR_MS = 366 * 24 * 3600 * 1000;
const businessNow = () => new Date(); // allow-clock: an instant, not a business date

export async function notifySubjectAccessChanged(subjectKind: string, subjectKey: string): Promise<void> {
  const users =
    subjectKind === "ROLE"
      ? await prisma.user.findMany({ where: { roles: { some: { role: { code: subjectKey } } } }, select: { id: true, employeeId: true } })
      : await prisma.user.findMany({ where: { id: subjectKey }, select: { id: true, employeeId: true } });
  await notifyAccessChanged(users);
}

const hrHolderWhere = { status: "ACTIVE" as const, roles: { some: { role: { code: { in: [...HR_ROLE_CODES] } } } }, NOT: { roles: { some: { role: { code: SUPER_ADMIN_ROLE_CODE } } } } };

async function personLine(employeeIds: string[]) {
  const names = await namesOn(employeeIds, businessNow());
  return (id: string) => names.get(id) ?? "";
}

export async function overview(actorUserId: string) {
  await requireDirector(actorUserId, "see what HR can do");
  const now = businessNow();
  const rows = await prisma.hrCapabilitySwitch.findMany({ orderBy: { effectiveFrom: "asc" } });
  const roleRows = await prisma.rolePermission.findMany({ where: { role: { code: { in: [...HR_ROLE_CODES] } } }, select: { role: { select: { code: true } }, permission: { select: { key: true } } } });
  const heldBy = (code: string) => new Set(roleRows.filter((r) => r.role.code === code).map((r) => r.permission.key));
  const holders = await prisma.user.findMany({ where: hrHolderWhere, select: { id: true, employeeId: true, employee: { select: { employeeCode: true } }, roles: { select: { role: { select: { code: true } } } } }, orderBy: { createdAt: "asc" } });
  const name = await personLine(holders.map((h) => h.employeeId));
  const people = holders.map((h) => ({ userId: h.id, employeeId: h.employeeId, employeeCode: h.employee.employeeCode, name: name(h.employeeId), roleCodes: h.roles.map((r) => r.role.code).filter((c) => (HR_ROLE_CODES as readonly string[]).includes(c)) }));
  const pendingOf = (kind: string, key: string, cap: string) => {
    const later = rows.filter((r) => r.capability === cap && r.subjectKind === kind && r.subjectKey === key && r.effectiveFrom.getTime() > now.getTime());
    const last = later[later.length - 1];
    return last ? { state: last.state, effectiveFrom: last.effectiveFrom.toISOString() } : null;
  };
  const capabilities = HR_CAPABILITIES.map((cap) => ({
    id: cap.id,
    label: cap.label,
    what: cap.what,
    keys: cap.keys,
    roles: HR_ROLE_CODES.map((code) => ({
      roleCode: code,
      state: rowState(rows, cap.id, "ROLE", code, now) ?? "DEFAULT",
      defaultHolds: cap.keys.every((k) => heldBy(code).has(k)), // what the role's own permission rows give, with no switch
      pending: pendingOf("ROLE", code, cap.id),
    })),
    people: people
      .map((p) => ({ ...p, state: rowState(rows, cap.id, "USER", p.userId, now) ?? "DEFAULT", pending: pendingOf("USER", p.userId, cap.id) }))
      .filter((p) => p.state !== "DEFAULT" || p.pending),
  }));
  return { capabilities, people };
}

export async function history(actorUserId: string, q: { capability?: string; page?: number; pageSize?: number }) {
  await requireDirector(actorUserId, "see what HR can do");
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 25;
  const where = q.capability ? { capability: q.capability } : {};
  const [total, rows] = await Promise.all([
    prisma.hrCapabilitySwitch.count({ where }),
    prisma.hrCapabilitySwitch.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  const userIds = [...new Set([...rows.map((r) => r.createdByUserId), ...rows.filter((r) => r.subjectKind === "USER").map((r) => r.subjectKey)])];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, employeeId: true, employee: { select: { employeeCode: true } } } });
  const name = await personLine(users.map((u) => u.employeeId));
  const who = (id: string) => {
    const u = users.find((x) => x.id === id);
    return u ? { employeeCode: u.employee.employeeCode, name: name(u.employeeId) } : { employeeCode: "", name: "" };
  };
  return {
    total,
    page,
    pageSize,
    rows: rows.map((r) => ({
      id: r.id,
      capability: r.capability,
      label: hrCapability(r.capability)?.label ?? r.capability,
      subjectKind: r.subjectKind,
      subject: r.subjectKind === "ROLE" ? { roleCode: r.subjectKey } : who(r.subjectKey),
      state: r.state,
      effectiveFrom: r.effectiveFrom.toISOString(),
      reason: r.reason,
      changedBy: who(r.createdByUserId),
      changedAt: r.createdAt.toISOString(),
    })),
  };
}

export async function setSwitch(input: SetCapabilityInput, meta: Meta): Promise<{ changed: boolean; effectiveFrom: string }> {
  await requireDirector(meta.actorUserId, "change what HR can do");
  await requireDirectorTwoFactor(meta.actorUserId);
  const cap = hrCapability(input.capability);
  if (!cap) throw new HttpError(400, "Unknown capability.", "VALIDATION_ERROR");
  const now = businessNow();
  const at = input.effectiveFrom ? new Date(input.effectiveFrom) : now;
  if (at.getTime() < now.getTime() - 60_000) throw new HttpError(400, "A switch cannot start in the past. Leave the time empty to start it now.", "VALIDATION_ERROR");
  if (at.getTime() > now.getTime() + ONE_YEAR_MS) throw new HttpError(400, "A switch can be planned at most a year ahead.", "VALIDATION_ERROR");
  const effectiveFrom = at.getTime() < now.getTime() ? now : at;

  let subjectKind: "ROLE" | "USER";
  let subjectKey: string;
  let subjectLabel: string;
  if (input.subject.kind === "ROLE") {
    subjectKind = "ROLE";
    subjectKey = input.subject.roleCode;
    subjectLabel = input.subject.roleCode === "HR_ADMIN" ? "HR Admin" : "HR Executive";
  } else {
    const user = await prisma.user.findFirst({
      where: { employeeId: input.subject.employeeId },
      select: { id: true, status: true, roles: { select: { role: { select: { code: true } } } }, employee: { select: { employeeCode: true } } },
    });
    if (!user) throw new HttpError(404, "No such person.", "NOT_FOUND");
    const codes = user.roles.map((r) => r.role.code);
    if (codes.includes(SUPER_ADMIN_ROLE_CODE)) throw new HttpError(409, "A director always has every capability; a switch cannot change that.", "SWITCH_NOT_APPLICABLE");
    if (!codes.some((c) => (HR_ROLE_CODES as readonly string[]).includes(c))) throw new HttpError(409, "This person holds no HR role, so there is nothing to switch for them.", "SWITCH_NOT_APPLICABLE");
    if (user.status !== "ACTIVE") throw new HttpError(409, "This person's account is not active.", "SWITCH_NOT_APPLICABLE");
    subjectKind = "USER";
    subjectKey = user.id;
    subjectLabel = user.employee.employeeCode;
  }

  // Setting what is already in force, with nothing planned, writes nothing (the history stays a record of real changes).
  const rows = await prisma.hrCapabilitySwitch.findMany({ where: { capability: input.capability, subjectKind, subjectKey } });
  const inForce = rowState(rows, input.capability, subjectKind, subjectKey, now) ?? "DEFAULT";
  const hasLater = rows.some((r) => r.effectiveFrom.getTime() > now.getTime());
  if (effectiveFrom.getTime() === now.getTime() && !hasLater && inForce === input.state) return { changed: false, effectiveFrom: now.toISOString() };

  try {
    await prisma.hrCapabilitySwitch.create({
      data: { capability: input.capability, subjectKind, subjectKey, state: input.state, effectiveFrom, reason: input.reason.trim(), createdByUserId: meta.actorUserId },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new HttpError(409, "A change for that moment already exists. Pick another time.", "SWITCH_EXISTS");
    throw err;
  }
  await writeAuditLog({
    actorUserId: meta.actorUserId,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
    action: "hr.capability.switched",
    entityType: "HrCapabilitySwitch",
    entityId: `${input.capability}:${subjectKind}:${subjectKey}`,
    before: { state: inForce },
    after: { capability: input.capability, subject: subjectLabel, state: input.state, effectiveFrom: effectiveFrom.toISOString(), reason: input.reason.trim() },
  });
  if (effectiveFrom.getTime() <= now.getTime()) await notifySubjectAccessChanged(subjectKind, subjectKey);
  else await hrCapabilityQueue().add("activate", { subjectKind, subjectKey }, { delay: effectiveFrom.getTime() - now.getTime() + 1000, removeOnComplete: 100, removeOnFail: 100 });
  return { changed: true, effectiveFrom: effectiveFrom.toISOString() };
}
