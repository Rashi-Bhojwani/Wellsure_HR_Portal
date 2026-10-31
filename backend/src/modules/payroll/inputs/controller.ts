import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { recentCycles, loadCycleRules } from "../../../lib/attendanceCycle";
import { businessToday } from "../../../lib/businessDate";
import { requireDirector } from "../../../lib/directorAuthority";
import { HttpError } from "../../../middleware/errorHandler";
import { requireFile } from "../../../lib/uploads";
import { iso } from "../run/days";
import * as imp from "./importService";
import * as svc from "./service";

// Monthly Inputs routes. Directors only: the permission on each route keeps everyone who cannot see salary out, and this check keeps out anyone who can but is not a
// director (a Super Admin is the only one who holds those permissions today, so it also holds if a role is ever granted them by mistake).

const actor = (req: Request) => ({ userId: req.user!.userId, ip: req.ip ?? null });
export const directorsOnly = (req: Request, _res: Response, next: NextFunction): void => {
  requireDirector(req.user!.userId, "use Monthly Inputs").then(() => next(), next);
};

export const idParamsSchema = z.object({ id: z.string().min(1).max(64) });
export const cycleParamsSchema = z.object({ cycleStart: z.iso.date() });
export const templateQuerySchema = z.object({ format: z.enum(["xlsx", "csv"]).default("xlsx") });
export const monthQuerySchema = z.object({ cycleStart: z.iso.date() });

export const months = async (_req: Request, res: Response): Promise<void> => {
  const cycles = recentCycles(await loadCycleRules(), businessToday(), 12);
  res.status(200).json({ months: cycles.map((c) => ({ cycleStart: iso(c.start), cycleEnd: iso(c.end), label: c.label })) });
};
export const month = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await svc.monthView((req.query as { cycleStart: string }).cycleStart));
export const gridRoute = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await svc.grid(req.query as never));
export const historyRoute = async (req: Request, res: Response): Promise<void> => void res.status(200).json({ entries: await svc.history(req.query as never) });
export const enterRoute = async (req: Request, res: Response): Promise<void> => void res.status(201).json(await svc.enter(req.body, actor(req)));
export const fillBlanksRoute = async (req: Request, res: Response): Promise<void> => void res.status(201).json(await svc.fillBlanks(req.body, actor(req)));
export const confirmPreview = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await svc.previewConfirmation((req.body as { cycleStart: string }).cycleStart, req.user!.userId));
export const confirmRequest = async (req: Request, res: Response): Promise<void> => {
  const a = await svc.requestConfirmation(req.body, actor(req));
  res.status(201).json({ status: a.status, authority: a.authority });
};
export const decisionRoute = async (req: Request, res: Response): Promise<void> => {
  const a = await svc.decideConfirmation((req.params as { cycleStart: string }).cycleStart, req.body, actor(req));
  res.status(200).json({ status: a.status });
};

export const importTemplate = async (req: Request, res: Response): Promise<void> => {
  const t = await imp.template((req.query as { format: "xlsx" | "csv" }).format);
  res.setHeader("Content-Type", t.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${t.fileName}"`);
  res.status(200).send(t.buffer);
};
export const importUpload = async (req: Request, res: Response): Promise<void> => {
  const file = requireFile(req.file);
  const name = file.originalname.toLowerCase();
  if (!name.endsWith(".xlsx") && !name.endsWith(".csv")) throw new HttpError(400, "Upload an Excel (.xlsx) or CSV (.csv) file.", "INVALID_FILE");
  res.status(201).json(await imp.upload({ buffer: file.buffer, originalname: file.originalname }, actor(req)));
};
export const importList = async (_req: Request, res: Response): Promise<void> => void res.status(200).json({ batches: await imp.listBatches() });
export const importGet = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await imp.getBatch((req.params as { id: string }).id));
export const importApply = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await imp.apply((req.params as { id: string }).id, req.body, actor(req)));
export const importDiscard = async (req: Request, res: Response): Promise<void> => {
  await imp.discard((req.params as { id: string }).id, actor(req));
  res.status(200).json({ ok: true });
};
