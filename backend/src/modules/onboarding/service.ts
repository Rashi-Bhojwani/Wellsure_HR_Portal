import { z } from "zod";
import type { DataScope } from "../../lib/dataScope";
import { buildEmployeeScopeWhere } from "../../lib/dataScope";
import { writeAuditLog } from "../../lib/audit";
import { addCalendarDays, businessToday } from "../../lib/businessDate";
import { inForceOn } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { notifyEmployee } from "../notifications/notifyEmployee";
import { parseOnboardingLine, policyInForce } from "../policySettings/service";

// M session block 2, OE-04: onboarding checklist. HR (employee.edit, data scope) starts a joiner's onboarding: the checklist in force
// (policy.onboarding, a conventional default list) is copied as that person's steps, each owned by HR, the reporting manager or the employee, due a
// number of days after joining. The owner ticks a step done (HR any step in scope; the manager only MANAGER steps of their own direct report; the
// employee only their own EMPLOYEE steps). Ticking is audited and may be undone by the same people.

export interface Viewer {
  userId: string;
  employeeId: string;
  dataScope: DataScope;
  permissions: ReadonlySet<string>;
}
export interface ActorMeta {
  actorUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
export const doneBody = z.object({ done: z.boolean() }).strict();
export const listQuery = z.object({ show: z.enum(["open", "all"]).default("open") }).strict();
const isHr = (v: Viewer) => v.permissions.has("employee.edit");

const taskView = (t: { id: string; position: number; owner: string; step: string; dueDate: Date; doneAt: Date | null }) => ({ id: t.id, position: t.position, owner: t.owner, step: t.step, dueDate: iso(t.dueDate), doneAt: t.doneAt?.toISOString() ?? null });

async function inScope(employeeId: string, viewer: Viewer) {
  const scope = await buildEmployeeScopeWhere(viewer.employeeId, viewer.dataScope);
  return prisma.employee.findFirst({ where: { AND: [{ id: employeeId }, scope] }, select: { id: true, dateOfJoining: true, jobHistory: { where: inForceOn(), select: { reportingManagerId: true } } } });
}

/** HR: joiners in scope with onboarding progress; "open" = not started, or started and not finished; joined within the last 120 days. */
export async function list(viewer: Viewer, show: "open" | "all") {
  const scope = await buildEmployeeScopeWhere(viewer.employeeId, viewer.dataScope);
  const since = addCalendarDays(businessToday(), -120);
  const people = await prisma.employee.findMany({
    where: { AND: [{ status: "ACTIVE", dateOfJoining: { gte: since } }, scope] },
    select: { id: true, employeeCode: true, dateOfJoining: true, nameHistory: { where: inForceOn(), select: { fullName: true } }, onboardingTasks: { select: { doneAt: true, dueDate: true } } },
    orderBy: { dateOfJoining: "desc" },
  });
  const today = iso(businessToday());
  return people
    .map((p) => ({ employeeId: p.id, employeeCode: p.employeeCode, fullName: p.nameHistory[0]?.fullName ?? p.employeeCode, dateOfJoining: iso(p.dateOfJoining), started: p.onboardingTasks.length > 0, total: p.onboardingTasks.length, done: p.onboardingTasks.filter((t) => t.doneAt).length, overdue: p.onboardingTasks.filter((t) => !t.doneAt && iso(t.dueDate) < today).length }))
    .filter((p) => show === "all" || !p.started || p.done < p.total);
}

export async function start(employeeId: string, viewer: Viewer, meta: ActorMeta) {
  const e = await inScope(employeeId, viewer);
  if (!e) throw new HttpError(404, "Employee not found.", "NOT_FOUND");
  if (await prisma.onboardingTask.count({ where: { employeeId } })) throw new HttpError(409, "Onboarding has already started.", "ALREADY_STARTED");
  const policy = (await policyInForce<{ items: string[] }>("policy.onboarding"))!;
  const items = policy.items.map(parseOnboardingLine).filter((x): x is NonNullable<typeof x> => !!x);
  if (!items.length) throw new HttpError(409, "The onboarding checklist is empty. A director sets it in Policy settings.", "EMPTY_CHECKLIST");
  await prisma.onboardingTask.createMany({ data: items.map((it, i) => ({ employeeId, position: i + 1, owner: it.owner, step: it.step, dueDate: addCalendarDays(e.dateOfJoining, it.days), startedByUserId: viewer.userId })) });
  await writeAuditLog({ ...meta, action: "employee.onboarding.started", entityType: "Employee", entityId: employeeId, after: { steps: items.length } });
  await notifyEmployee(employeeId, { type: "onboarding.started", title: "Welcome! Your onboarding steps are ready", body: "See what to do in your first weeks.", link: "/app/todo/onboarding" });
  const managerId = e.jobHistory[0]?.reportingManagerId;
  if (managerId && items.some((it) => it.owner === "MANAGER")) await notifyEmployee(managerId, { type: "onboarding.manager_steps", title: "A new joiner in your team has onboarding steps for you", body: "Open My onboarding tasks.", link: "/app/todo/onboarding" });
  return { employeeId, steps: items.length };
}

/** The steps of one person: HR in scope, the person themself, or their reporting manager (who sees only the steps, not other data). */
export async function steps(employeeId: string, viewer: Viewer) {
  const self = employeeId === viewer.employeeId;
  const e = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, jobHistory: { where: inForceOn(), select: { reportingManagerId: true } } } });
  const isManager = !!e && e.jobHistory[0]?.reportingManagerId === viewer.employeeId;
  const hrInScope = isHr(viewer) && !!(await inScope(employeeId, viewer));
  if (!e || !(self || isManager || hrInScope)) throw new HttpError(404, "Not found.", "NOT_FOUND");
  const tasks = await prisma.onboardingTask.findMany({ where: { employeeId }, orderBy: { position: "asc" } });
  return { employeeId, tasks: tasks.map(taskView) };
}

/** What waits on the signed-in person: their own EMPLOYEE steps, and the MANAGER steps of their direct reports. */
export async function mine(viewer: Viewer) {
  const own = await prisma.onboardingTask.findMany({ where: { employeeId: viewer.employeeId }, orderBy: { position: "asc" } });
  const reports = await prisma.employee.findMany({ where: { status: "ACTIVE", jobHistory: { some: { ...inForceOn(), reportingManagerId: viewer.employeeId } }, onboardingTasks: { some: { owner: "MANAGER" } } }, select: { id: true, employeeCode: true, nameHistory: { where: inForceOn(), select: { fullName: true } }, onboardingTasks: { where: { owner: "MANAGER" }, orderBy: { position: "asc" } } } });
  return {
    own: own.map(taskView),
    team: reports.map((r) => ({ employeeId: r.id, fullName: r.nameHistory[0]?.fullName ?? r.employeeCode, tasks: r.onboardingTasks.map(taskView) })),
  };
}

export async function setDone(taskId: string, done: boolean, viewer: Viewer, meta: ActorMeta) {
  const t = await prisma.onboardingTask.findUnique({ where: { id: taskId }, include: { employee: { select: { jobHistory: { where: inForceOn(), select: { reportingManagerId: true } } } } } });
  if (!t) throw new HttpError(404, "Not found.", "NOT_FOUND");
  const mayHr = isHr(viewer) && t.employeeId !== viewer.employeeId && !!(await inScope(t.employeeId, viewer));
  const mayManager = t.owner === "MANAGER" && t.employee.jobHistory[0]?.reportingManagerId === viewer.employeeId;
  const mayEmployee = t.owner === "EMPLOYEE" && t.employeeId === viewer.employeeId;
  if (!(mayHr || mayManager || mayEmployee)) throw new HttpError(404, "Not found.", "NOT_FOUND");
  if (!!t.doneAt === done) return taskView(t);
  const row = await prisma.onboardingTask.update({ where: { id: taskId }, data: done ? { doneAt: new Date(), doneByUserId: viewer.userId } : { doneAt: null, doneByUserId: null } });
  await writeAuditLog({ ...meta, action: done ? "employee.onboarding.step_done" : "employee.onboarding.step_undone", entityType: "OnboardingTask", entityId: taskId, after: { employeeId: t.employeeId, position: t.position } });
  return taskView(row);
}
