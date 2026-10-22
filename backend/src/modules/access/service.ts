import { DEVELOPER_FORBIDDEN_KEYS, DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { MANAGER_GRANTABLE_KEYS, META_PERMISSION_KEYS, PERMISSION_CATALOG, PERMISSION_KEYS, type PermissionKey } from "@shared/constants/permissions";
import type { DataScope } from "@shared/constants/roles";
import { writeAuditLog } from "../../lib/audit";
import { buildEmployeeScopeWhere } from "../../lib/dataScope";
import { resolveAccess, SUPER_ADMIN_ROLE_CODE } from "../../lib/permissions";
import { prisma } from "../../lib/prisma";
import { assertSuperAdminRemains } from "../../lib/superAdminGuard";
import { HttpError } from "../../middleware/errorHandler";
import { getSocketServer } from "../../realtime/emit";
import { notifyAccessChanged } from "../../lib/accessChanged";
import { appointManager } from "../managers/service";
import { moveReportingLine } from "../managers/hierarchy";
import { businessToday } from "../../lib/businessDate";
import { checkRoleCombination, isTopLevel } from "../../lib/reportingHierarchy";
import { logger } from "../../lib/logger";
import { sendSecurityChangeNoticeEmail } from "../auth/emails";
import { adminIssuePasswordReset, adminResetTotp, adminUnlock } from "../auth/service";
import { inForceOn } from "../../lib/effectiveDating";

// Roles & permissions (spec §2, Phase 5 commit E1). The rules, numbered as in
// docs/plans/PHASE_5.md §E1, are enforced HERE (the routes only check that
// the caller is signed in and may *see* the screen):
//   1. SUPER_ADMIN's permissions can't be edited or revoked by anyone,
//      including a SUPER_ADMIN: its role definition is locked and overrides
//      on a SUPER_ADMIN holder are refused. (It holds everything in code —
//      lib/permissions.ts — so there is nothing to edit.)
//   2. Only a SUPER_ADMIN changes role definitions (permissions, scope).
//   3. Nobody grants a permission they don't hold.
//   4. Meta-permissions (power over others' access) are granted only by a
//      SUPER_ADMIN, and never to the MANAGER role or a MANAGER holder.
//   5. Per-user overrides: SUPER_ADMIN on anyone but a SUPER_ADMIN holder;
//      anyone else only on MANAGER holders with manager.permissions.manage
//      (arrives in E2 — until then, SUPER_ADMIN only); never on yourself.
//   6. Role assignment: SUPER_ADMIN only in E1 (incl. SUPER_ADMIN itself —
//      only an existing SUPER_ADMIN can create another); MANAGER also via
//      Manager Management in E2.
//   7. The last active SUPER_ADMIN is never lost (lib/superAdminGuard.ts +
//      database triggers).
//   8. Every change is audit-logged with before and after.

export interface AccessActor {
  userId: string;
  employeeId: string;
  roleCodes: string[];
  permissions: Set<string>;
  dataScope: DataScope;
}
export interface ActorMeta {
  actorUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const MANAGER_ROLE_CODE = "MANAGER";
// Manager Management (E2): lets HR set per-manager exceptions (rule 5's
// non-SUPER_ADMIN path).
const MANAGER_PERMISSIONS_MANAGE = "manager.permissions.manage";

const isSuperAdmin = (actor: AccessActor) => actor.roleCodes.includes(SUPER_ADMIN_ROLE_CODE);
const isKnownKey = (key: string): key is PermissionKey => (PERMISSION_KEYS as readonly string[]).includes(key);
const isMeta = (key: string) => (META_PERMISSION_KEYS as readonly string[]).includes(key);
const forbid = (message: string, code = "FORBIDDEN") => new HttpError(403, message, code);

// E2 (user decision 2026-10-02): a MANAGER holder may only ever hold keys
// from the manager-grantable list — "the one place the system overrules a
// Super Admin". Widening it is a code change (shared/constants/permissions.ts).
function assertManagerGrantable(keys: readonly string[]) {
  const outside = keys.filter((k) => !(MANAGER_GRANTABLE_KEYS as readonly string[]).includes(k));
  if (outside.length) {
    throw forbid(
      `A manager can't be given ${outside.map((k) => PERMISSION_CATALOG[k as PermissionKey]?.label ?? k).join(", ")} — managers only ever get permissions limited to their own team. This list is fixed in code.`,
      "NOT_MANAGER_GRANTABLE",
    );
  }
}

// P6-6 (docs/plans/PHASE_6.md §14J): the developer role holds none of the owners' secrets and none of the power over others' access. lib/permissions.ts removes those keys
// from a developer whatever is stored; these checks stop anyone being told otherwise, in words, at the moment of the click.
const isDeveloperForbidden = (key: string) => (DEVELOPER_FORBIDDEN_KEYS as readonly string[]).includes(key);
function assertDeveloperCeiling(keys: readonly string[]) {
  const outside = keys.filter(isDeveloperForbidden);
  if (outside.length) {
    throw forbid(
      `A developer can't be given ${outside.map((k) => PERMISSION_CATALOG[k as PermissionKey]?.label ?? k).join(", ")}. The person who builds and runs the system never holds the owners' salaries, bank details, identifiers or bank layout, nor power over other people's access. This is fixed in code.`,
      "DEVELOPER_CEILING",
    );
  }
}

function requireSuperAdmin(actor: AccessActor, what: string) {
  if (!isSuperAdmin(actor)) throw forbid(`Only a Super Admin can ${what}.`, "SUPER_ADMIN_ONLY");
}

// ── Roles ───────────────────────────────────────────────────────────────

export async function listRoles() {
  const roles = await prisma.role.findMany({
    include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } },
    orderBy: { createdAt: "asc" },
  });
  return roles.map((r) => {
    const locked = r.code === SUPER_ADMIN_ROLE_CODE;
    return {
      // MANAGER: locked empty — permissions are granted per manager (2026-10-03).
      managerLocked: r.code === MANAGER_ROLE_CODE,
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      locked, // SUPER_ADMIN: "All permissions — can't be changed"
      dataScope: (locked ? "ALL" : r.dataScope) as DataScope,
      // What holders actually get: SUPER_ADMIN everything (in code), others
      // their stored set (only known keys — a stale row for a retired key
      // shows nothing).
      permissions: locked ? [...PERMISSION_KEYS] : r.permissions.map((p) => p.permission.key).filter(isKnownKey).sort(),
      holderCount: r._count.users,
    };
  });
}

async function holdersOf(roleId: string) {
  return prisma.userRole.findMany({ where: { roleId }, select: { user: { select: { id: true, employeeId: true } } } });
}


export async function updateRole(roleCode: string, input: { permissions?: string[]; dataScope?: DataScope }, actor: AccessActor, meta: ActorMeta) {
  requireSuperAdmin(actor, "change what a role may do"); // rule 2
  const role = await prisma.role.findUnique({ where: { code: roleCode }, include: { permissions: { include: { permission: true } } } });
  if (!role) throw new HttpError(404, "Role not found.", "NOT_FOUND");
  if (role.code === SUPER_ADMIN_ROLE_CODE) throw forbid("The Super Admin role always has every permission and can't be changed.", "SUPER_ADMIN_LOCKED"); // rule 1
  // User decision 2026-10-03: being a manager grants nothing on its own, and
  // every manager power is granted to that one manager — never to all
  // managers at once through the role. So the role's definition is locked
  // empty with TEAM scope, even for a Super Admin.
  if (role.code === MANAGER_ROLE_CODE) {
    throw forbid("The Manager role grants nothing by itself and can't be changed — give each manager what they need in Manager Management (or their Access tab).", "MANAGER_ROLE_LOCKED");
  }

  const before = { permissions: role.permissions.map((p) => p.permission.key).sort(), dataScope: role.dataScope };
  let next = before.permissions;
  if (input.permissions) {
    if (role.code === DEVELOPER_ROLE_CODE) assertDeveloperCeiling(input.permissions);
    const unknown = input.permissions.filter((k) => !isKnownKey(k));
    if (unknown.length) throw new HttpError(400, `Unknown permission: ${unknown.join(", ")}.`, "VALIDATION_ERROR");
    next = [...new Set(input.permissions)].sort();
    const added = next.filter((k) => !before.permissions.includes(k));
    const notHeld = added.filter((k) => !actor.permissions.has(k)); // rule 3
    if (notHeld.length) throw forbid(`You can't grant a permission you don't hold: ${notHeld.join(", ")}.`, "NOT_HELD");
    if (role.code === MANAGER_ROLE_CODE) {
      const meta4 = next.filter(isMeta); // rule 4
      if (meta4.length) throw forbid(`The Manager role can never hold access-management permissions (${meta4.map((k) => PERMISSION_CATALOG[k as PermissionKey].label).join(", ")}).`, "META_TO_MANAGER");
      assertManagerGrantable(next); // E2 — even for a Super Admin
    }
  }
  if (role.code === MANAGER_ROLE_CODE && input.dataScope === "ALL") {
    throw forbid("A manager's data scope can't be everyone — managers see their own team.", "NOT_MANAGER_GRANTABLE");
  }

  await prisma.$transaction(async (tx) => {
    if (input.permissions) {
      const keyRows = await tx.permission.findMany({ where: { key: { in: next } } });
      await tx.rolePermission.deleteMany({ where: { roleId: role.id, permission: { key: { notIn: next } } } });
      for (const p of keyRows) {
        await tx.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: p.id } }, create: { roleId: role.id, permissionId: p.id }, update: {} });
      }
    }
    if (input.dataScope) await tx.role.update({ where: { id: role.id }, data: { dataScope: input.dataScope } });
  });
  const after = { permissions: next, dataScope: input.dataScope ?? role.dataScope };
  await writeAuditLog({ ...meta, action: "access.role.updated", entityType: "Role", entityId: role.id, before: { code: role.code, ...before }, after: { code: role.code, ...after } }); // rule 8
  await notifyAccessChanged((await holdersOf(role.id)).map((h) => h.user));
  return (await listRoles()).find((r) => r.code === roleCode)!;
}

// ── One person's access ────────────────────────────────────────────────

async function loadTargetUser(employeeId: string, actor: AccessActor) {
  const scopeWhere = await buildEmployeeScopeWhere(actor.employeeId, actor.dataScope);
  const employee = await prisma.employee.findFirst({ where: { AND: [{ id: employeeId }, scopeWhere] }, include: { user: true } });
  if (!employee?.user) throw new HttpError(404, "Employee not found.", "NOT_FOUND");
  return { employee, user: employee.user };
}

export async function getEmployeeAccess(employeeId: string, actor: AccessActor) {
  const { employee, user } = await loadTargetUser(employeeId, actor);
  const [userRoles, overrides, access] = await Promise.all([
    prisma.userRole.findMany({ where: { userId: user.id }, include: { role: { include: { permissions: { include: { permission: true } } } } }, orderBy: { assignedAt: "asc" } }),
    prisma.userPermissionOverride.findMany({ where: { userId: user.id }, include: { permission: true } }),
    resolveAccess(user.id),
  ]);
  const overrideByKey = new Map(overrides.map((o) => [o.permission.key, o]));
  const isTargetSuperAdmin = access.isSuperAdmin;
  const actorIsSuperAdmin = isSuperAdmin(actor);
  const isSelf = user.id === actor.userId;
  return {
    employeeId: employee.id,
    userId: user.id,
    status: user.status,
    totpEnabled: user.totpEnabled,
    locked: Boolean(user.lockedUntil && user.lockedUntil > new Date()),
    isSuperAdmin: isTargetSuperAdmin,
    isManager: access.roleCodes.includes(MANAGER_ROLE_CODE),
    dataScope: access.dataScope,
    roles: userRoles.map((ur) => ({ code: ur.role.code, name: ur.role.name, assignedAt: ur.assignedAt.toISOString() })),
    permissions: PERMISSION_KEYS.map((key) => {
      const inheritedFrom = isTargetSuperAdmin ? [SUPER_ADMIN_ROLE_CODE] : userRoles.filter((ur) => ur.role.permissions.some((p) => p.permission.key === key)).map((ur) => ur.role.code);
      const o = isTargetSuperAdmin ? undefined : overrideByKey.get(key);
      return {
        key,
        effective: access.permissions.has(key),
        inheritedFrom,
        override: o ? { effect: o.effect, reason: o.reason, createdByUserId: o.createdByUserId, createdAt: o.createdAt.toISOString() } : null,
      };
    }),
    // What the caller may do here — the UI only offers these; the server
    // re-checks every one.
    can: {
      editRoles: actorIsSuperAdmin,
      // E2: holders of manager.permissions.manage may set exceptions on a
      // manager (manager-grantable keys only — checked again on write).
      editOverrides: !isTargetSuperAdmin && !isSelf && (actorIsSuperAdmin || (actor.permissions.has(MANAGER_PERMISSIONS_MANAGE) && access.roleCodes.includes(MANAGER_ROLE_CODE))),
      securityActions: !isSelf && (actorIsSuperAdmin || (actor.permissions.has("user.security.manage") && !isTargetSuperAdmin)),
    },
  };
}

// Rule 5 (+3, +4) for a per-user override.
async function assertMayOverride(targetUserId: string, key: string, effect: "GRANT" | "REVOKE", actor: AccessActor) {
  if (!isKnownKey(key)) throw new HttpError(400, `Unknown permission: ${key}.`, "VALIDATION_ERROR");
  if (targetUserId === actor.userId) throw forbid("You can't change your own access.", "SELF");
  const target = await resolveAccess(targetUserId);
  if (target.isSuperAdmin) throw forbid("A Super Admin always has every permission; it can't be granted or revoked.", "SUPER_ADMIN_LOCKED"); // rule 1
  if (!isSuperAdmin(actor)) {
    // E2 path: only on MANAGER holders, only with manager.permissions.manage.
    if (!actor.permissions.has(MANAGER_PERMISSIONS_MANAGE) || !target.roleCodes.includes(MANAGER_ROLE_CODE)) {
      throw forbid("Only a Super Admin can change this person's access.", "SUPER_ADMIN_ONLY");
    }
    if (isMeta(key)) throw forbid("Only a Super Admin can grant access-management permissions.", "META_SUPER_ADMIN_ONLY"); // rule 4
  }
  if (effect === "GRANT") {
    if (target.roleCodes.includes(MANAGER_ROLE_CODE)) assertManagerGrantable([key]); // E2
    if (target.roleCodes.includes(DEVELOPER_ROLE_CODE)) assertDeveloperCeiling([key]); // P6-6
    if (!actor.permissions.has(key)) throw forbid("You can't grant a permission you don't hold.", "NOT_HELD"); // rule 3
    if (isMeta(key) && target.roleCodes.includes(MANAGER_ROLE_CODE)) {
      throw forbid("A manager can never hold access-management permissions.", "META_TO_MANAGER"); // rule 4
    }
  }
}

export async function setOverride(employeeId: string, key: string, input: { effect: "GRANT" | "REVOKE"; reason: string }, actor: AccessActor, meta: ActorMeta) {
  const { user } = await loadTargetUser(employeeId, actor);
  await assertMayOverride(user.id, key, input.effect, actor);
  const permission = await prisma.permission.findUnique({ where: { key } });
  if (!permission) throw new HttpError(400, `Unknown permission: ${key}.`, "VALIDATION_ERROR");
  const before = await prisma.userPermissionOverride.findUnique({ where: { userId_permissionId: { userId: user.id, permissionId: permission.id } } });
  await prisma.userPermissionOverride.upsert({
    where: { userId_permissionId: { userId: user.id, permissionId: permission.id } },
    create: { userId: user.id, permissionId: permission.id, effect: input.effect, reason: input.reason, createdByUserId: actor.userId },
    update: { effect: input.effect, reason: input.reason, createdByUserId: actor.userId, createdAt: new Date() },
  });
  await writeAuditLog({
    ...meta,
    action: "access.override.set",
    entityType: "User",
    entityId: user.id,
    before: before ? { key, effect: before.effect, reason: before.reason } : null,
    after: { key, effect: input.effect, reason: input.reason },
  });
  await notifyAccessChanged([user]);
  return getEmployeeAccess(employeeId, actor);
}

export async function clearOverride(employeeId: string, key: string, input: { reason: string }, actor: AccessActor, meta: ActorMeta) {
  const { user } = await loadTargetUser(employeeId, actor);
  const permission = await prisma.permission.findUnique({ where: { key } });
  const existing = permission ? await prisma.userPermissionOverride.findUnique({ where: { userId_permissionId: { userId: user.id, permissionId: permission.id } } }) : null;
  if (!existing) throw new HttpError(404, "There's no override for that permission.", "NOT_FOUND");
  await assertMayOverride(user.id, key, existing.effect, actor);
  await prisma.userPermissionOverride.delete({ where: { id: existing.id } });
  await writeAuditLog({ ...meta, action: "access.override.cleared", entityType: "User", entityId: user.id, before: { key, effect: existing.effect, reason: existing.reason }, after: { key, reason: input.reason } });
  await notifyAccessChanged([user]);
  return getEmployeeAccess(employeeId, actor);
}

// ── Role assignment (rule 6) ───────────────────────────────────────────

export async function assignRole(employeeId: string, roleCode: string, actor: AccessActor, meta: ActorMeta) {
  requireSuperAdmin(actor, "assign roles");
  const { user } = await loadTargetUser(employeeId, actor);
  if (user.status === "DEACTIVATED") throw new HttpError(409, "This person's account is deactivated.", "DEACTIVATED");
  const role = await prisma.role.findUnique({ where: { code: roleCode } });
  if (!role) throw new HttpError(404, "Role not found.", "NOT_FOUND");
  const before = (await prisma.userRole.findMany({ where: { userId: user.id }, include: { role: true } })).map((ur) => ur.role.code).sort();
  if (before.includes(role.code)) return getEmployeeAccess(employeeId, actor);
  // E2: appointing a manager is one operation wherever it starts — the
  // role, the cleared reporting line and the grantable check together.
  if (role.code === MANAGER_ROLE_CODE) {
    await appointManager(employeeId, {}, meta);
    return getEmployeeAccess(employeeId, actor);
  }
  // E2: a manager holds no role but EMPLOYEE alongside MANAGER.
  const combo = checkRoleCombination([...before, role.code]);
  if (combo) throw new HttpError(400, combo, "HIERARCHY");
  // P6-6: nobody is both a developer and a Super Admin, and a developer is never given a role that carries an owner's secret.
  const nowHolding = [...before, role.code];
  if (nowHolding.includes(DEVELOPER_ROLE_CODE)) {
    if (nowHolding.includes(SUPER_ADMIN_ROLE_CODE)) throw forbid("Nobody can be both a developer and a Super Admin: the developer is the one person who must not hold the owners' secrets.", "DEVELOPER_CEILING");
    const carried = await prisma.rolePermission.findMany({ where: { role: { code: { in: nowHolding } }, permission: { key: { in: [...DEVELOPER_FORBIDDEN_KEYS] } } }, include: { permission: true, role: true } });
    if (carried.length) assertDeveloperCeiling([...new Set(carried.map((c) => c.permission.key))]);
  }
  await prisma.$transaction(async (tx) => {
    await tx.userRole.create({ data: { userId: user.id, roleId: role.id, assignedByUserId: actor.userId } });
    // Model A: Super Admins and HR Admins sit directly under Admin.
    if (isTopLevel([role.code])) {
      const current = await tx.employeeJobHistory.findFirst({ where: { employeeId, ...inForceOn() } });
      if (current?.reportingManagerId) await moveReportingLine(tx, employeeId, null, businessToday(), actor.userId, `Became ${role.name}`);
    }
  });
  await writeAuditLog({ ...meta, action: "access.role.assigned", entityType: "User", entityId: user.id, before: { roles: before }, after: { roles: [...before, role.code].sort() } });
  await notifyAccessChanged([user]);
  return getEmployeeAccess(employeeId, actor);
}

export async function removeRole(employeeId: string, roleCode: string, actor: AccessActor, meta: ActorMeta) {
  requireSuperAdmin(actor, "remove roles");
  const { user } = await loadTargetUser(employeeId, actor);
  const userRole = await prisma.userRole.findFirst({ where: { userId: user.id, role: { code: roleCode } }, include: { role: true } });
  if (!userRole) throw new HttpError(404, "This person doesn't hold that role.", "NOT_FOUND");
  if (roleCode === SUPER_ADMIN_ROLE_CODE) await assertSuperAdminRemains(user.id); // rule 7
  if (roleCode === MANAGER_ROLE_CODE) {
    // E2: their team has to go somewhere and they need a manager of their
    // own — both chosen in Manager Management.
    throw new HttpError(409, "Remove a manager from Admin Tools → Manager Management, which reassigns their team and gives them a manager of their own.", "USE_MANAGER_MANAGEMENT");
  }
  const before = (await prisma.userRole.findMany({ where: { userId: user.id }, include: { role: true } })).map((ur) => ur.role.code).sort();
  await prisma.userRole.delete({ where: { userId_roleId: { userId: user.id, roleId: userRole.roleId } } });
  await writeAuditLog({ ...meta, action: "access.role.removed", entityType: "User", entityId: user.id, before: { roles: before }, after: { roles: before.filter((c) => c !== roleCode) } });
  await notifyAccessChanged([user]);
  return getEmployeeAccess(employeeId, actor);
}

// ── Security actions (Access tab) ──────────────────────────────────────
// user.security.manage on non-Super-Admins; a Super Admin's sign-in can only
// be reset by another Super Admin (this is recovery step 1). Never yourself
// — your own 2FA/password have their own self-service flows.

async function assertMaySecure(employeeId: string, actor: AccessActor) {
  const { user } = await loadTargetUser(employeeId, actor);
  if (user.id === actor.userId) throw forbid("Use your own account security settings for this.", "SELF");
  const target = await resolveAccess(user.id);
  if (target.isSuperAdmin ? !isSuperAdmin(actor) : !(isSuperAdmin(actor) || actor.permissions.has("user.security.manage"))) {
    throw forbid(target.isSuperAdmin ? "Only another Super Admin can reset a Super Admin's sign-in." : "Missing permission: user.security.manage", "FORBIDDEN");
  }
  return user;
}

// E1.1: the person is always told, by email, who changed their sign-in and why.
async function tellTarget(userId: string, change: string, reason: string, actor: AccessActor) {
  const [target, by] = await Promise.all([
    prisma.employee.findFirst({ where: { user: { id: userId } }, include: { personal: true, nameHistory: { where: inForceOn() } } }),
    prisma.employee.findUnique({ where: { id: actor.employeeId }, include: { nameHistory: { where: inForceOn() } } }),
  ]);
  const email = target?.personal?.personalEmail;
  if (!target || !email) return;
  const byLabel = by ? `${by.nameHistory[0]?.fullName ?? by.employeeCode} (${by.employeeCode})` : "an administrator";
  await sendSecurityChangeNoticeEmail(email, target.nameHistory[0]?.fullName ?? target.employeeCode, change, byLabel, reason).catch((err: unknown) =>
    logger.error({ err, userId }, "failed to send security change notice"),
  );
}

export async function resetTwoFactor(employeeId: string, reason: string, actor: AccessActor, meta: ActorMeta) {
  const user = await assertMaySecure(employeeId, actor);
  await adminResetTotp(user.id, { ...meta, reason });
  await tellTarget(user.id, "Your two-factor authentication was reset and you were signed out everywhere", reason, actor);
  return getEmployeeAccess(employeeId, actor);
}

export async function unlockAccount(employeeId: string, reason: string, actor: AccessActor, meta: ActorMeta) {
  const user = await assertMaySecure(employeeId, actor);
  await adminUnlock(user.id, { ...meta, reason });
  await tellTarget(user.id, "Your account was unlocked after failed sign-in attempts", reason, actor);
  return getEmployeeAccess(employeeId, actor);
}

export async function sendPasswordReset(employeeId: string, reason: string, actor: AccessActor, meta: ActorMeta) {
  const user = await assertMaySecure(employeeId, actor);
  if (user.status !== "ACTIVE") throw new HttpError(409, "Only an active account can be sent a password reset (resend the invitation instead).", "NOT_ACTIVE");
  const { emailedTo } = await adminIssuePasswordReset(user.id, { ...meta, reason });
  if (!emailedTo) throw new HttpError(409, "This person has no personal email on file, so the link couldn't be sent.", "NO_EMAIL");
  await tellTarget(user.id, "A password-reset link was sent to you", reason, actor);
  return { emailed: true };
}

// ── Security events (E1.1) ─────────────────────────────────────────────
// Raised by the break-glass CLIs (lib/securityAlerts.ts). Super Admins only.
// A banner stays until a Super Admin OTHER than the event's target
// acknowledges it — the person recovered can't clear their own alarm.

export async function listSecurityEvents(actor: AccessActor, status: "open" | "all") {
  requireSuperAdmin(actor, "see security events");
  const rows = await prisma.securityEvent.findMany({ where: status === "open" ? { acknowledgedAt: null } : {}, orderBy: { createdAt: "desc" }, take: 100 });
  return rows.map((e) => ({
    id: e.id,
    kind: e.kind,
    summary: e.summary,
    details: e.details,
    createdAt: e.createdAt.toISOString(),
    acknowledgedAt: e.acknowledgedAt?.toISOString() ?? null,
    acknowledgedByUserId: e.acknowledgedByUserId,
    acknowledgementNote: e.acknowledgementNote,
    youAreTarget: e.targetUserId === actor.userId,
  }));
}

export async function acknowledgeSecurityEvent(id: string, note: string, actor: AccessActor, meta: ActorMeta) {
  requireSuperAdmin(actor, "acknowledge security events");
  const event = await prisma.securityEvent.findUnique({ where: { id } });
  if (!event) throw new HttpError(404, "Security event not found.", "NOT_FOUND");
  if (event.acknowledgedAt) throw new HttpError(409, "Already acknowledged.", "ALREADY_ACKNOWLEDGED");
  if (event.targetUserId === actor.userId) throw forbid("This event is about your own account — another Super Admin has to acknowledge it.", "SELF");
  await prisma.securityEvent.update({ where: { id }, data: { acknowledgedAt: new Date(), acknowledgedByUserId: actor.userId, acknowledgementNote: note } });
  await writeAuditLog({ ...meta, action: "security_event.acknowledged", entityType: "SecurityEvent", entityId: id, after: { note } });
  getSocketServer()?.to(`role:${SUPER_ADMIN_ROLE_CODE}`).emit("security.event", { id });
}

