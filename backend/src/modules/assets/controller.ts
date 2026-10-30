import type { Request, Response } from "express";
import type { AssetSettingKind } from "@shared/constants/assets";
import * as service from "./service";
import * as settings from "./settings";
import type { ActorMeta, AssetViewer } from "./types";

function viewer(req: Request): AssetViewer {
  return { userId: req.user!.userId, employeeId: req.user!.employeeId, dataScope: req.user!.dataScope, permissions: req.user!.permissions };
}
function meta(req: Request): ActorMeta {
  return { actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null };
}
const id = (req: Request) => req.params.id as string;
const kind = (req: Request) => req.params.kind as AssetSettingKind;

// Settings
export async function getSettings(req: Request, res: Response): Promise<void> {
  res.status(200).json(await settings.getSettings(req.user!.userId));
}
export async function proposeSetting(req: Request, res: Response): Promise<void> {
  res.status(201).json(await settings.proposeSetting(kind(req), req.body, meta(req)));
}
export async function confirmSetting(req: Request, res: Response): Promise<void> {
  res.status(200).json(await settings.confirmSetting(kind(req), req.body, meta(req)));
}

export async function getLists(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await settings.inForceLists());
}

// Register
export async function listAssets(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.listAssets(viewer(req), req.query as never));
}
export async function getAsset(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.getAsset(id(req), viewer(req)));
}
export async function searchHolders(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.searchHolders(viewer(req), (req.query as { q: string }).q));
}
export async function listEmployeeAssets(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.listEmployeeAssets(req.params.employeeId as string, viewer(req)));
}
export async function createAsset(req: Request, res: Response): Promise<void> {
  res.status(201).json(await service.createAsset(req.body, viewer(req), meta(req)));
}
export async function updateAsset(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.updateAsset(id(req), req.body, viewer(req), meta(req)));
}
export async function issueAsset(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.issueAsset(id(req), req.body, viewer(req), meta(req)));
}
export async function returnAsset(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.returnAsset(id(req), req.body, viewer(req), meta(req)));
}
export async function transferAsset(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.transferAsset(id(req), req.body, viewer(req), meta(req)));
}
export async function markLost(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.markLost(id(req), req.body, viewer(req), meta(req)));
}
export async function markDamaged(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.markDamaged(id(req), req.body, viewer(req), meta(req)));
}

// Self
export async function listMine(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.listMine(viewer(req)));
}
export async function acknowledge(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.acknowledge(id(req), viewer(req), meta(req)));
}
