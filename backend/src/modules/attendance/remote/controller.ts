import type { Request, Response } from "express";
import { z } from "zod";
import * as svc from "./service";

const actor = (req: Request) => ({ userId: req.user!.userId, ip: req.ip ?? null });
export const idParamsSchema = z.object({ id: z.string().min(1).max(64) });
export const myRecordsQuerySchema = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() }).strict();

export const today = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await svc.myToday(req.user!.userId));
export const checkIn = async (req: Request, res: Response): Promise<void> => void res.status(201).json(await svc.checkIn(req.user!.userId));
export const checkOut = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await svc.checkOut(req.user!.userId));
export const mine = async (req: Request, res: Response): Promise<void> => void res.status(200).json({ records: await svc.myRecords(req.user!.userId, req.query as { from?: string; to?: string }) });
export const raise = async (req: Request, res: Response): Promise<void> => void res.status(201).json(await svc.requestChange(req.user!.userId, (req.params as { id: string }).id, req.body));

export const missed = async (req: Request, res: Response): Promise<void> => void res.status(201).json(await svc.requestMissedDay(req.user!.userId, req.body));
export const marks = async (req: Request, res: Response): Promise<void> => {
  await svc.getSettings(actor(req)); // a director check, and nothing else, before listing
  res.status(200).json({ people: await svc.listRemote() });
};
export const mark = async (req: Request, res: Response): Promise<void> => void res.status(201).json(await svc.markRemote(req.body, actor(req)));
export const records = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await svc.listRecords(req.query as never, actor(req)));
export const decision = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await svc.decide((req.params as { id: string }).id, req.body, actor(req)));
export const reopen = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await svc.reopen((req.params as { id: string }).id, req.body, actor(req)));
export const bulkApprove = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await svc.bulkApprove(req.body, actor(req)));
export const bulkReject = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await svc.bulkReject(req.body, actor(req)));
export const requests = async (req: Request, res: Response): Promise<void> => void res.status(200).json({ requests: await svc.openRequests(actor(req)) });
export const resolve = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await svc.resolveRequest((req.params as { id: string }).id, req.body, actor(req)));
export const report = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await svc.report(req.query as never, actor(req)));
export const settings = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await svc.getSettings(actor(req)));
export const putSettings = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await svc.putSettings(req.body, actor(req)));
