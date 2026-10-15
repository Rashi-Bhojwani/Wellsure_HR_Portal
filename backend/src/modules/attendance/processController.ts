import type { Request, Response } from "express";
import * as service from "./processService";
import * as finalisation from "./finalisation";

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
export async function finalisationReadiness(req: Request, res: Response): Promise<void> {
  const q = req.query as { from: string; to: string };
  res.status(200).json(await finalisation.finalisationReadiness(q.from, q.to));
}
export async function listPeriods(req: Request, res: Response): Promise<void> {
  const asOf = typeof req.query.asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.asOf) ? req.query.asOf : undefined;
  res.status(200).json({ periods: await finalisation.listPeriods(asOf) });
}
export async function finalise(req: Request, res: Response): Promise<void> {
  const b = req.body as { from: string; to: string; note?: string };
  res.status(200).json(await finalisation.finaliseCycle(b.from, b.to, meta(req), b.note ?? ""));
}
export async function unlock(req: Request, res: Response): Promise<void> {
  const b = req.body as { from: string; to: string; reason: string; confirmPayrollConsumed: boolean };
  res.status(200).json(await finalisation.unlockCycle(b.from, b.to, { reason: b.reason, confirmPayrollConsumed: b.confirmPayrollConsumed }, { roleCodes: req.user!.roleCodes }, meta(req)));
}
