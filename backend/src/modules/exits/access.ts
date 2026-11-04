import type { Prisma } from "@prisma/client";
import { HR_ROLE_CODES } from "@shared/constants/sensitiveData";
import { capabilityState, switchRowsFor } from "../../lib/hrCapabilities";
import { buildEmployeeScopeWhere, getTeamEmployeeIds } from "../../lib/dataScope";
import { inForceOn } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";
import { memberStateFor } from "../peeps/office";
import { getExitSetting } from "./settings";
import type { NextFunction, Request, Response } from "express";
import { resolveAccess } from "../../lib/permissions";
import { HttpError } from "../../middleware/errorHandler";
import type { AuthenticatedUser } from "../../middleware/types";

export type ExitActor = AuthenticatedUser;
export type ExitMeta = { actorUserId: string; ipAddress?: string | null; userAgent?: string | null };
export const metaOf = (req: Request): ExitMeta => ({ actorUserId: req.user!.userId, ipAddress: req.ip, userAgent: req.headers["user-agent"] });
export function requireExitUser(req: Request, _res: Response, next: NextFunction) {
  if (req.user!.roleCodes.includes("DEVELOPER")) return next(new HttpError(403, "Exits are unavailable to Developer.", "FORBIDDEN"));
  next();
}
export async function requireExitDirector(userId: string) {
  const access = await resolveAccess(userId);
  if (!access.isSuperAdmin) throw new HttpError(403, "Only a director can do this.", "FORBIDDEN");
}

// Current permissions, current reporting line and current membership. Nothing is
// cached across requests, so an HR switch or team move takes effect immediately.
export async function exitContext(actor: ExitActor) {
  const access = await resolveAccess(actor.userId);
  if (access.roleCodes.includes("DEVELOPER")) throw new HttpError(403, "Exits are unavailable to Developer.", "FORBIDDEN");
  const director = access.isSuperAdmin;
  const hr = access.roleCodes.some((r) => (HR_ROLE_CODES as readonly string[]).includes(r));
  const hrOn = hr && capabilityState(await switchRowsFor(actor.userId, access.roleCodes), "MANAGE_EXITS", actor.userId, access.roleCodes, new Date()) === "ON";
  const member = await memberStateFor(actor.employeeId);
  const office = Boolean((!hr || hrOn) && member?.capabilities.includes("MANAGE_EXITS") && (await getExitSetting("officeAudience"))?.officeManages);
  const manager = access.roleCodes.includes("MANAGER") && (!hr || hrOn || director);
  const teamIds = manager ? await getTeamEmployeeIds(actor.employeeId) : [];
  const manage = director || office || (hrOn && access.permissions.has("exits.manage"));
  const employeeScope = director || office ? {} : await buildEmployeeScopeWhere(actor.employeeId, access.dataScope);
  return { ...actor, ...access, director, hr, hrOn, office, manager, teamIds, manage, employeeScope };
}
export type ExitContext = Awaited<ReturnType<typeof exitContext>>;
export function resignationWhere(c: ExitContext): Prisma.ResignationWhereInput {
  if(c.manage&&Object.keys(c.employeeScope).length===0)return {};
  return { OR: [{ employeeId: c.employeeId }, ...(c.manage ? [{ employee: c.employeeScope }] : []), ...(c.teamIds.length ? [{ employeeId: { in: c.teamIds } }] : [])] };
}
export async function managesEmployee(c: ExitContext, employeeId: string): Promise<boolean> {
  return c.manage && (await prisma.employee.count({ where: { id: employeeId, AND: [c.employeeScope] } })) > 0;
}
export async function mayAccept(c: ExitContext, employeeId: string): Promise<boolean> {
  if (employeeId === c.employeeId && !c.director) return false;
  return await managesEmployee(c, employeeId) || (c.manager && c.permissions.has("exits.accept") && c.teamIds.includes(employeeId));
}
export async function currentManager(employeeId: string): Promise<{ userId: string; employeeId: string } | null> {
  const job = await prisma.employeeJobHistory.findFirst({ where: { employeeId, ...inForceOn() }, select: { reportingManagerId: true } });
  if (!job?.reportingManagerId) return null;
  const manager = await prisma.user.findFirst({ where: { employeeId: job.reportingManagerId, status: "ACTIVE", employee: { status: "ACTIVE" }, roles: { some: { role: { code: "MANAGER" } } } }, select: { id: true, employeeId: true } });
  return manager ? { userId: manager.id, employeeId: manager.employeeId } : null;
}
