import type { Request, Response } from "express";
import * as notificationsService from "./service";

export async function listNotifications(req: Request, res: Response): Promise<void> {
  const query = req.query as never as { page: number; pageSize: number };
  res.status(200).json(await notificationsService.listNotifications(req.user!.userId, query));
}

export async function getUnreadCount(req: Request, res: Response): Promise<void> {
  res.status(200).json({ count: await notificationsService.getUnreadCount(req.user!.userId) });
}

export async function markAsRead(req: Request, res: Response): Promise<void> {
  await notificationsService.markAsRead(req.params.id as string, req.user!.userId);
  res.status(204).send();
}

export async function markAllAsRead(req: Request, res: Response): Promise<void> {
  await notificationsService.markAllAsRead(req.user!.userId);
  res.status(204).send();
}
