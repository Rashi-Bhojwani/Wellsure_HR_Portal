import type { Request, Response } from "express";
import * as service from "./service";

const meta = (req: Request): service.Meta => ({ actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.get("user-agent") ?? null });

// ── A manager's own (and what the caller is covering) ──
export async function listMine(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.listMine(req.user!.userId));
}
export async function myDelegateOptions(req: Request, res: Response): Promise<void> {
  res.status(200).json({ options: await service.delegateOptions(req.user!.userId) });
}
export async function createMine(req: Request, res: Response): Promise<void> {
  res.status(201).json(await service.createDelegation({ ...req.body, delegatorUserId: req.user!.userId }, meta(req)));
}
export async function revokeMine(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.revokeDelegation(req.params.id as string, req.body ?? {}, meta(req), { mustBeDelegator: true }));
}

// ── HR (delegation.manage): anyone's ──
export async function listAll(req: Request, res: Response): Promise<void> {
  res.status(200).json({ delegations: await service.listAll(req.query.status as service.DelegationStatus | undefined) });
}
export async function delegatorOptions(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ options: await service.delegatorOptions() });
}
export async function delegateOptionsFor(req: Request, res: Response): Promise<void> {
  res.status(200).json({ options: await service.delegateOptions(req.params.delegatorUserId as string) });
}
export async function create(req: Request, res: Response): Promise<void> {
  res.status(201).json(await service.createDelegation(req.body, meta(req)));
}
export async function revoke(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.revokeDelegation(req.params.id as string, req.body ?? {}, meta(req), { mustBeDelegator: false }));
}
