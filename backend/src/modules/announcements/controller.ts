import type { Request, Response } from "express";
import * as announcementsService from "./service";
import type { ActorMeta } from "./types";

function actorMeta(req: Request): ActorMeta {
  return { actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null };
}

export async function listAnnouncements(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ announcements: await announcementsService.listAnnouncements() });
}

export async function createAnnouncement(req: Request, res: Response): Promise<void> {
  res.status(201).json(await announcementsService.createAnnouncement(req.body, actorMeta(req)));
}

export async function updateAnnouncement(req: Request, res: Response): Promise<void> {
  res.status(200).json(await announcementsService.updateAnnouncement(req.params.id as string, req.body, actorMeta(req)));
}

export async function deleteAnnouncement(req: Request, res: Response): Promise<void> {
  await announcementsService.deleteAnnouncement(req.params.id as string, actorMeta(req));
  res.status(204).send();
}

export async function getActiveAnnouncement(req: Request, res: Response): Promise<void> {
  res.status(200).json({ announcement: await announcementsService.getActiveAnnouncementForEmployee(req.user!.employeeId) });
}
