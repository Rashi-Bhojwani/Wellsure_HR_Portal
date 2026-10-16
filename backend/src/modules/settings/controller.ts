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

export async function getHelpdeskSettings(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await settingsService.getHelpdeskSettingsForAdmin());
}

export async function updateHelpdeskSettings(req: Request, res: Response): Promise<void> {
  res.status(200).json(await settingsService.updateHelpdeskSettings(req.body, actorMeta(req)));
}

export async function getDeviceHealthSettings(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await settingsService.getDeviceHealthSettings());
}

export async function updateDeviceHealthSettings(req: Request, res: Response): Promise<void> {
  res.status(200).json(await settingsService.updateDeviceHealthSettings(req.body, actorMeta(req)));
}

export async function getDeviceAlertSettings(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await settingsService.getDeviceAlertSettingsForAdmin());
}

export async function updateDeviceAlertSettings(req: Request, res: Response): Promise<void> {
  res.status(200).json(await settingsService.updateDeviceAlertSettings(req.body, actorMeta(req)));
}

export async function getRegularizationSettings(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await settingsService.getRegularizationSettingsForAdmin());
}

export async function updateRegularizationSettings(req: Request, res: Response): Promise<void> {
  res.status(200).json(await settingsService.updateRegularizationSettings(req.body, actorMeta(req)));
}

export async function getExcessHoursSettings(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await settingsService.getExcessHoursSettingsForAdmin());
}

export async function updateExcessHoursSettings(req: Request, res: Response): Promise<void> {
  res.status(200).json(await settingsService.updateExcessHoursSettings(req.body, actorMeta(req)));
}
