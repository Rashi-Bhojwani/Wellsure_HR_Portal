import { MANAGER_GRANTABLE_KEYS, PERMISSION_CATALOG, type PermissionKey } from "@shared/constants/permissions";
import { writeAuditLog } from "../../lib/audit";
import { prisma } from "../../lib/prisma";
import { checkRoleCombination, EMPLOYEE_ROLE, isTopLevel, MANAGER_ROLE_CODE } from "../../lib/reportingHierarchy";
import { HttpError } from "../../middleware/errorHandler";
import { emitTasksCounts, emitTeamChanged } from "../../realtime/emit";
import { notifyAccessChanged } from "../../lib/accessChanged";
import { assertReportingLine, directReportIds, moveReportingLine, parseMoveDate, roleCodesOf } from "./hierarchy";

// Manager Management (Phase 5 commit E2, docs/plans/PHASE_5.md §E2):
// appoint/remove managers (manager.appoint), move people into and out of
// teams (manager.team.assign), the Unassigned list. Every move is an
// effective-dated EmployeeJobHistory row and an audit entry; the three-level
// rules (model A) are enforced through ./hierarchy.ts. Routes gate on the
// permission; scope is company-wide by nature (these are HR/Admin tools —
// the keys are not manager-grantable).

export interface ManagersActor {
  userId: string;
  employeeId: string;
  permissions: Set<string>;
}
export interface Meta {
  actorUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const MOVE_REASON = { assign: "Team assignment", remove: "Removed from team", appoint: "Appointed manager", demote: "Manager role removed" };

async function placementLabels(employeeIds: string[]) {
  const rows = await prisma.employee.findMany({
    where: { id: { in: employeeIds } },
    select: {
      id: true,
      employeeCode: true,
      status: true,
      nameHistory: { where: { effectiveTo: null }, select: { fullName: true } },
      jobHistory: {
        where: { effectiveTo: null },
        select: { effectiveFrom: true, reportingManagerId: true, department: { select: { name: true } }, designation: { select: { name: true } }, location: { select: { name: true } } },
      },
    },
  });
  return new Map(
    rows.map((r) => {
      const job = r.jobHistory[0];
      return [
        r.id,
        {
          employeeId: r.id,
          employeeCode: r.employeeCode,
          name: r.nameHistory[0]?.fullName ?? r.employeeCode,
          status: r.status,
          department: job?.department.name ?? null,
          designation: job?.designation.name ?? null,
          branch: job?.location.name ?? null,
          reportingManagerId: job?.reportingManagerId ?? null,
          placedSince: job?.effectiveFrom.toISOString().slice(0, 10) ?? null,
        },
      ] as const;
    }),
  );
}

export async function listManagers() {
  const holders = await prisma.userRole.findMany({
    where: { role: { code: MANAGER_ROLE_CODE }, user: { employee: { status: "ACTIVE" } } },
    select: { user: { select: { employeeId: true } } },
  });
  const ids = holders.map((h) => h.user.employeeId);
  const labels = await placementLabels(ids);
  const counts = await prisma.employeeJobHistory.groupBy({ by: ["reportingManagerId"], where: { reportingManagerId: { in: ids }, effectiveTo: null, employee: { status: "ACTIVE" } }, _count: { _all: true } });
  const countBy = new Map(counts.map((c) => [c.reportingManagerId, c._count._all]));
  return ids
    .map((id) => ({ ...labels.get(id)!, teamSize: countBy.get(id) ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Picker options for "Reporting manager" (Add Employee, Change job
// details): active managers only, since nobody else may be one (model A).
export async function managerOptions() {
  const list = await listManagers();
  return list.map((m) => ({ employeeId: m.employeeId, employeeCode: m.employeeCode, name: m.name, teamSize: m.teamSize }));
}

export async function getTeam(managerId: string) {
  await requireActiveManager(managerId);
  const ids = await directReportIds(managerId);
  const labels = await placementLabels([managerId, ...ids]);
  return { manager: labels.get(managerId)!, members: ids.map((id) => labels.get(id)!).sort((a, b) => a.name.localeCompare(b.name)) };
}

// Active people who need a manager and don't have a valid one: no
// placement at all, no reporting manager, or a manager who is inactive or no
// longer holds MANAGER. Top-level people (Super Admin, Manager, HR Admin)
// never need one.
export async function listUnassigned() {
  const people = await prisma.employee.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      user: { select: { roles: { select: { role: { select: { code: true } } } } } },
      jobHistory: { where: { effectiveTo: null }, select: { reportingManagerId: true } },
    },
  });
  const managerIds = new Set(
    (await prisma.userRole.findMany({ where: { role: { code: MANAGER_ROLE_CODE }, user: { employee: { status: "ACTIVE" } } }, select: { user: { select: { employeeId: true } } } })).map((h) => h.user.employeeId),
  );
  const unassigned = people.filter((p) => {
    const roles = p.user?.roles.map((r) => r.role.code) ?? [];
    if (isTopLevel(roles)) return false;
    const job = p.jobHistory[0];
    return !job || !job.reportingManagerId || !managerIds.has(job.reportingManagerId);
  });
  const labels = await placementLabels(unassigned.map((p) => p.id));
  return unassigned
    .map((p) => {
      const l = labels.get(p.id)!;
      const why = !l.placedSince ? "No job placement yet" : !l.reportingManagerId ? "No reporting manager" : "Their manager is inactive or no longer a manager";
      return { ...l, why };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function requireActiveManager(managerId: string) {
  const e = await prisma.employee.findUnique({ where: { id: managerId }, select: { status: true } });
  if (!e) throw new HttpError(404, "Manager not found.", "NOT_FOUND");
  if (e.status !== "ACTIVE" || !(await roleCodesOf(managerId)).includes(MANAGER_ROLE_CODE)) throw new HttpError(404, "Manager not found.", "NOT_FOUND");
}

async function loadPerson(employeeId: string) {
  const e = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, employeeCode: true, status: true, user: { select: { id: true, employeeId: true, status: true } } } });
  if (!e?.user) throw new HttpError(404, "Employee not found.", "NOT_FOUND");
  if (e.status !== "ACTIVE") throw new HttpError(409, "This person isn't active.", "NOT_ACTIVE");
  return { ...e, user: e.user, roleCodes: await roleCodesOf(employeeId) };
}

// ── Appoint / remove ─────────────────────────────────────────────────────

export async function appointManager(employeeId: string, input: { effectiveFrom?: string }, meta: Meta) {
  const person = await loadPerson(employeeId);
  if (person.roleCodes.includes(MANAGER_ROLE_CODE)) throw new HttpError(409, "They're already a manager.", "ALREADY_MANAGER");
  const combo = checkRoleCombination([...person.roleCodes, MANAGER_ROLE_CODE]);
  if (combo) throw new HttpError(400, combo, "HIERARCHY");
  // The manager-grantable guard (E2): someone becoming a manager can't
  // carry a per-user grant outside the list.
  const grants = await prisma.userPermissionOverride.findMany({ where: { userId: person.user.id, effect: "GRANT" }, include: { permission: true } });
  const disallowed = grants.filter((g) => !(MANAGER_GRANTABLE_KEYS as readonly string[]).includes(g.permission.key));
  if (disallowed.length) {
    throw new HttpError(403, `Remove their exceptions first — a manager can't hold: ${disallowed.map((g) => PERMISSION_CATALOG[g.permission.key as PermissionKey]?.label ?? g.permission.key).join(", ")}.`, "NOT_MANAGER_GRANTABLE");
  }
  const current = await prisma.employeeJobHistory.findFirst({ where: { employeeId, effectiveTo: null } });
  if (!current) throw new HttpError(409, "They have no job placement yet — set their department, designation and branch first.", "NO_PLACEMENT");
  const effectiveFrom = parseMoveDate(input.effectiveFrom, current.effectiveFrom);
  const role = await prisma.role.findUniqueOrThrow({ where: { code: MANAGER_ROLE_CODE } });
  const oldManagerId = current.reportingManagerId;

  const move = await prisma.$transaction(async (tx) => {
    await tx.userRole.create({ data: { userId: person.user.id, roleId: role.id, assignedByUserId: meta.actorUserId } });
    // Model A: a manager sits directly under Admin — no reporting manager.
    return moveReportingLine(tx, employeeId, null, effectiveFrom, meta.actorUserId, MOVE_REASON.appoint);
  });
  await writeAuditLog({ ...meta, action: "manager.appointed", entityType: "Employee", entityId: employeeId, before: { roles: person.roleCodes, reportingManagerId: oldManagerId }, after: { roles: [...person.roleCodes, MANAGER_ROLE_CODE], reportingManagerId: null, effectiveFrom: effectiveFrom.toISOString().slice(0, 10), jobHistoryId: move.after.id } });
  await notifyAccessChanged([{ id: person.user.id, employeeId }]);
  emitTeamChanged([oldManagerId, employeeId]);
  return { employeeId, effectiveFrom: effectiveFrom.toISOString().slice(0, 10) };
}

export async function removeManager(employeeId: string, input: { newManagerId: string | null; effectiveFrom?: string }, meta: Meta) {
  const person = await loadPerson(employeeId);
  if (!person.roleCodes.includes(MANAGER_ROLE_CODE)) throw new HttpError(404, "Manager not found.", "NOT_FOUND");
  const team = await directReportIds(employeeId);
  if (team.length > 0) throw new HttpError(409, `Reassign their ${team.length} team member${team.length === 1 ? "" : "s"} first.`, "TEAM_NOT_EMPTY");
  const remainingRoles = person.roleCodes.filter((r) => r !== MANAGER_ROLE_CODE);
  // Their own new line, as the plain employee they become.
  await assertReportingLine({ code: person.employeeCode, roleCodes: remainingRoles }, input.newManagerId);
  const current = await prisma.employeeJobHistory.findFirst({ where: { employeeId, effectiveTo: null } });
  const effectiveFrom = parseMoveDate(input.effectiveFrom, current?.effectiveFrom ?? null);
  const role = await prisma.role.findUniqueOrThrow({ where: { code: MANAGER_ROLE_CODE } });

  await prisma.$transaction(async (tx) => {
    await tx.userRole.delete({ where: { userId_roleId: { userId: person.user.id, roleId: role.id } } });
    if (current) await moveReportingLine(tx, employeeId, input.newManagerId, effectiveFrom, meta.actorUserId, MOVE_REASON.demote);
  });
  // A plain employee always keeps EMPLOYEE.
  const employeeRole = await prisma.role.findUnique({ where: { code: EMPLOYEE_ROLE } });
  if (employeeRole && !remainingRoles.includes(EMPLOYEE_ROLE)) {
    await prisma.userRole.create({ data: { userId: person.user.id, roleId: employeeRole.id, assignedByUserId: meta.actorUserId } });
  }
  await writeAuditLog({ ...meta, action: "manager.removed", entityType: "Employee", entityId: employeeId, before: { roles: person.roleCodes }, after: { roles: remainingRoles, reportingManagerId: input.newManagerId, effectiveFrom: effectiveFrom.toISOString().slice(0, 10) } });
  await notifyAccessChanged([{ id: person.user.id, employeeId }]);
  emitTeamChanged([employeeId, input.newManagerId]);
}

// ── Team moves ───────────────────────────────────────────────────────────

export async function assignTeamMembers(managerId: string, input: { employeeIds: string[]; effectiveFrom?: string }, meta: Meta) {
  await requireActiveManager(managerId);
  const ids = [...new Set(input.employeeIds)];
  const people = await Promise.all(ids.map((id) => loadPerson(id)));
  for (const p of people) {
    if (p.id === managerId) throw new HttpError(400, "A manager can't be in their own team.", "HIERARCHY");
    await assertReportingLine({ code: p.employeeCode, roleCodes: p.roleCodes }, managerId);
  }
  const currents = await prisma.employeeJobHistory.findMany({ where: { employeeId: { in: ids }, effectiveTo: null } });
  const byEmployee = new Map(currents.map((c) => [c.employeeId, c]));
  for (const p of people) {
    if (!byEmployee.get(p.id)) throw new HttpError(409, `${p.employeeCode} has no job placement yet — set their department, designation and branch first.`, "NO_PLACEMENT");
  }
  const dates = new Map(people.map((p) => [p.id, parseMoveDate(input.effectiveFrom, byEmployee.get(p.id)!.effectiveFrom)]));

  const moves = await prisma.$transaction(async (tx) => {
    const out = [];
    for (const p of people) out.push({ person: p, ...(await moveReportingLine(tx, p.id, managerId, dates.get(p.id)!, meta.actorUserId, MOVE_REASON.assign)) });
    return out;
  });
  const changed = moves.filter((m) => m.changed);
  for (const m of changed) {
    await writeAuditLog({ ...meta, action: "manager.team.member_assigned", entityType: "Employee", entityId: m.person.id, before: { reportingManagerId: m.before.reportingManagerId }, after: { reportingManagerId: managerId, effectiveFrom: m.after.effectiveFrom.toISOString().slice(0, 10), jobHistoryId: m.after.id } });
  }
  emitTeamChanged([managerId, ...changed.map((m) => m.before.reportingManagerId)]);
  for (const m of changed) emitTasksCounts(m.before.reportingManagerId);
  emitTasksCounts(managerId);
  return { assigned: changed.length, alreadyInTeam: moves.length - changed.length };
}

export async function removeTeamMember(managerId: string, memberId: string, input: { effectiveFrom?: string }, meta: Meta) {
  const current = await prisma.employeeJobHistory.findFirst({ where: { employeeId: memberId, effectiveTo: null } });
  if (!current || current.reportingManagerId !== managerId) throw new HttpError(404, "They aren't in this manager's team.", "NOT_FOUND");
  const effectiveFrom = parseMoveDate(input.effectiveFrom, current.effectiveFrom);
  const move = await prisma.$transaction((tx) => moveReportingLine(tx, memberId, null, effectiveFrom, meta.actorUserId, MOVE_REASON.remove));
  await writeAuditLog({ ...meta, action: "manager.team.member_removed", entityType: "Employee", entityId: memberId, before: { reportingManagerId: managerId }, after: { reportingManagerId: null, effectiveFrom: effectiveFrom.toISOString().slice(0, 10), jobHistoryId: move.after.id } });
  emitTeamChanged([managerId]);
  emitTasksCounts(managerId);
}
