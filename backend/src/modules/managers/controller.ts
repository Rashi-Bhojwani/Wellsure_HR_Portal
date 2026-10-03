import type { Request, Response } from "express";
import * as service from "./service";

const meta = (req: Request): service.Meta => ({ actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.get("user-agent") ?? null });
const id = (req: Request) => req.params.employeeId as string;

export async function listManagers(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ managers: await service.listManagers() });
}
export async function managerOptions(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ managers: await service.managerOptions() });
}
export async function listUnassigned(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ employees: await service.listUnassigned() });
}
export async function getTeam(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.getTeam(id(req)));
}
export async function appointManager(req: Request, res: Response): Promise<void> {
  res.status(201).json(await service.appointManager(req.body.employeeId, req.body, meta(req), req.user!));
}
export async function removeManager(req: Request, res: Response): Promise<void> {
  await service.removeManager(id(req), req.body, meta(req));
  res.status(204).send();
}
export async function assignTeamMembers(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.assignTeamMembers(id(req), req.body, meta(req)));
}
export async function removeTeamMember(req: Request, res: Response): Promise<void> {
  await service.removeTeamMember(id(req), req.params.memberId as string, req.body ?? {}, meta(req));
  res.status(204).send();
}
export async function setLeaveApproval(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.setLeaveApproval(id(req), req.body.grant, req.user!, meta(req)));
}
