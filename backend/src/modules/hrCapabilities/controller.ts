import type { Request, Response } from "express";
import * as service from "./service";

const meta = (req: Request): service.Meta => ({ actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null });

export async function getOverview(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.overview(req.user!.userId));
}
export async function getHistory(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.history(req.user!.userId, req.query as { capability?: string; page?: number; pageSize?: number }));
}
export async function putSwitch(req: Request, res: Response): Promise<void> {
  const result = await service.setSwitch(req.body, meta(req));
  res.status(200).json({ ...result, overview: await service.overview(req.user!.userId) });
}
