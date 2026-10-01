import type { Request, Response } from "express";
import * as service from "./service";

function viewer(req: Request): service.HelpdeskViewer {
  return { userId: req.user!.userId, employeeId: req.user!.employeeId, permissions: req.user!.permissions };
}
function actorMeta(req: Request): service.ActorMeta {
  return { actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null };
}
const id = (req: Request) => req.params.id as string;
const files = (req: Request) => (Array.isArray(req.files) ? req.files : []);

// Categories
export async function listActiveCategories(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.listActiveCategories());
}
export async function listAllCategories(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.listAllCategories());
}
export async function createCategory(req: Request, res: Response): Promise<void> {
  res.status(201).json(await service.createCategory(req.body, actorMeta(req)));
}
export async function updateCategory(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.updateCategory(id(req), req.body, actorMeta(req)));
}
export async function listAssignees(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.listAssignees());
}

// Tickets
export async function raiseTicket(req: Request, res: Response): Promise<void> {
  res.status(201).json(await service.raiseTicket(viewer(req), req.body, files(req), actorMeta(req)));
}
export async function listMyTickets(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.listMyTickets(viewer(req), req.query as never));
}
export async function listQueue(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.listQueue(viewer(req), req.query as never));
}
export async function getTicket(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.getTicket(id(req), viewer(req), actorMeta(req)));
}
export async function addMessage(req: Request, res: Response): Promise<void> {
  res.status(201).json(await service.addMessage(id(req), viewer(req), req.body, files(req), actorMeta(req)));
}
export async function updateTicket(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.updateTicket(id(req), viewer(req), req.body, actorMeta(req)));
}
export async function reopenTicket(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.reopenTicket(id(req), viewer(req), actorMeta(req)));
}
export async function downloadAttachment(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.downloadAttachment(id(req), viewer(req)));
}
