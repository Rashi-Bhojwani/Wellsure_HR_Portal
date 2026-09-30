import type { Request, Response } from "express";
import * as settingsService from "./service";

function actorMeta(req: Request) {
  return { actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null };
}

export async function getSettings(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await settingsService.getSettings());
}

export async function updateSettings(req: Request, res: Response): Promise<void> {
  res.status(200).json(await settingsService.updateSettings(req.body, actorMeta(req)));
}

export async function getLeaveSettings(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await settingsService.getLeaveSettings());
}

export async function updateLeaveSettings(req: Request, res: Response): Promise<void> {
  res.status(200).json(await settingsService.updateLeaveSettings(req.body, actorMeta(req)));
}

export async function getPeopleDocumentsSettings(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await settingsService.getPeopleDocumentsSettingsForAdmin());
}

export async function updatePeopleDocumentsSettings(req: Request, res: Response): Promise<void> {
  res.status(200).json(await settingsService.updatePeopleDocumentsSettings(req.body, actorMeta(req)));
}
