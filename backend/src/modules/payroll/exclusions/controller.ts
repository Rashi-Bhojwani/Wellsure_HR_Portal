import type { Request, Response } from "express";
import * as svc from "./service";

const actor = (req: Request) => ({ userId: req.user!.userId, ip: req.ip ?? null });
export const list = async (req: Request, res: Response): Promise<void> => void res.status(200).json({ exclusions: await svc.list(actor(req)) });
export const add = async (req: Request, res: Response): Promise<void> => void res.status(201).json(await svc.add(req.body, actor(req)));
export const confirm = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await svc.confirm((req.params as { id: string }).id, actor(req)));
