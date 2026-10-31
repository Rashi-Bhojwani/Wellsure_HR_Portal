import type { Request, Response } from "express";
import * as links from "./payslipLinks";

const actor = (req: Request) => ({ userId: req.user!.userId, ip: req.ip ?? null });
export const openLinkRoute = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await links.openLink(req.user!.employeeId, req.body));
export const settings = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await links.getLinkSettings(actor(req)));
export const putSettings = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await links.putLinkSettings(req.body, actor(req)));
export const revoke = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await links.revokeRunLinks((req.params as { id: string }).id, actor(req)));
