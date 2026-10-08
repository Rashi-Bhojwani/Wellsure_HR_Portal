import type { Request, Response } from "express";
import * as service from "./processService";

const meta = (req: Request): service.Meta => ({ actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.get("user-agent") ?? null });

export async function startRun(req: Request, res: Response): Promise<void> {
  res.status(202).json(await service.startProcessRun(req.body, meta(req)));
}
export async function listRuns(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ runs: await service.listProcessRuns() });
}
export async function getRun(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.getProcessRun(req.params.id as string));
}
export async function scope(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.recomputeScopeFrom((req.query as { from: string }).from));
}
