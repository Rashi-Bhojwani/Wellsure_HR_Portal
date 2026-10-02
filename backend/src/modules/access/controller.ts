import type { Request, Response } from "express";
import * as service from "./service";

function actor(req: Request): service.AccessActor {
  const u = req.user!;
  return { userId: u.userId, employeeId: u.employeeId, roleCodes: u.roleCodes, permissions: u.permissions, dataScope: u.dataScope };
}
function actorMeta(req: Request): service.ActorMeta {
  return { actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null };
}
const emp = (req: Request) => req.params.employeeId as string;

export async function listRoles(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ roles: await service.listRoles() });
}
export async function updateRole(req: Request, res: Response): Promise<void> {
  res.status(200).json({ role: await service.updateRole(req.params.code as string, req.body, actor(req), actorMeta(req)) });
}
export async function getEmployeeAccess(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.getEmployeeAccess(emp(req), actor(req)));
}
export async function assignRole(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.assignRole(emp(req), req.body.code, actor(req), actorMeta(req)));
}
export async function removeRole(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.removeRole(emp(req), req.params.code as string, actor(req), actorMeta(req)));
}
export async function setOverride(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.setOverride(emp(req), req.params.key as string, req.body, actor(req), actorMeta(req)));
}
export async function clearOverride(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.clearOverride(emp(req), req.params.key as string, req.body, actor(req), actorMeta(req)));
}
export async function resetTwoFactor(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.resetTwoFactor(emp(req), req.body.reason, actor(req), actorMeta(req)));
}
export async function unlockAccount(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.unlockAccount(emp(req), req.body.reason, actor(req), actorMeta(req)));
}
export async function sendPasswordReset(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.sendPasswordReset(emp(req), req.body.reason, actor(req), actorMeta(req)));
}

export async function listSecurityEvents(req: Request, res: Response): Promise<void> {
  res.status(200).json({ events: await service.listSecurityEvents(actor(req), (req.query.status as "open" | "all" | undefined) ?? "open") });
}
export async function acknowledgeSecurityEvent(req: Request, res: Response): Promise<void> {
  await service.acknowledgeSecurityEvent(req.params.id as string, req.body.note, actor(req), actorMeta(req));
  res.status(204).send();
}
