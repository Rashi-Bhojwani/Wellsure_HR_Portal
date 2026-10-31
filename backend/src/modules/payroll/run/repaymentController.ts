import type { Request, Response } from "express";
import { z } from "zod";
import * as svc from "./repayments";
import { markSentToBank } from "./sentMarks";

const actor = (req: Request) => ({ userId: req.user!.userId, ip: req.ip ?? null });
const id = (req: Request) => (req.params as { id: string }).id;
export const idSchema = z.object({ id: z.string().min(1).max(64) });

export const rejections = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await svc.listRejections(id(req), actor(req)));
export const recordRejections = async (req: Request, res: Response): Promise<void> => void res.status(201).json(await svc.recordRejections(id(req), req.body, actor(req)));
export const createPlan = async (req: Request, res: Response): Promise<void> => void res.status(201).json(await svc.createPlan(id(req), req.body, actor(req)));
export const plan = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await svc.getPlan(id(req), actor(req)));
export const request = async (req: Request, res: Response): Promise<void> => {
  const a = await svc.requestRepayment(id(req), req.body, actor(req));
  res.status(201).json({ status: a.status, authority: a.authority });
};
export const decision = async (req: Request, res: Response): Promise<void> => void res.status(200).json({ status: (await svc.decideRepayment(id(req), req.body, actor(req))).status });
export const generate = async (req: Request, res: Response): Promise<void> => void res.status(201).json(await svc.generateRepayment(id(req), actor(req)));
export const download = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await svc.downloadRepayment(id(req), actor(req)));
export const sentBatch = async (req: Request, res: Response): Promise<void> => void res.status(201).json(await markSentToBank("batch", id(req), req.body, actor(req)));
export const sentRepayment = async (req: Request, res: Response): Promise<void> => void res.status(201).json(await markSentToBank("repayment", id(req), req.body, actor(req)));
