import type { Request, Response } from "express";
import { buildRunWorkbook } from "./export";
import { createRun, getItem, getRun, listItems, listRuns, previewCalculation, readiness, requestCalculation, voidRun, itemListSchema } from "./service";
import { varianceJson } from "./variance";

const actor = (req: Request) => ({ userId: req.user!.userId, ip: req.ip ?? null });
const id = (req: Request) => req.params.id as string;

export const runs = async (req: Request, res: Response): Promise<void> => {
  const q = req.query as unknown as { page: number; pageSize: number };
  res.status(200).json(await listRuns(q.page, q.pageSize));
};
export const runReadiness = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await readiness((req.query as { cycleStart: string }).cycleStart));
export const runCreate = async (req: Request, res: Response): Promise<void> => void res.status(201).json(await createRun((req.body as { cycleStart: string }).cycleStart, actor(req)));
export const run = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await getRun(id(req)));
export const runItems = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await listItems(id(req), itemListSchema.parse(req.query), req.user!.userId));
export const runItem = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await getItem(id(req), req.params.employeeId as string, req.user!.userId));
export const runVariance = async (req: Request, res: Response): Promise<void> => {
  const q = req.query as unknown as { page: number; pageSize: number; changedOnly: string; flaggedOnly: string };
  res.status(200).json(await varianceJson(id(req), { page: q.page, pageSize: q.pageSize, changedOnly: q.changedOnly === "true", flaggedOnly: q.flaggedOnly === "true" }));
};
export const runExport = async (req: Request, res: Response): Promise<void> => {
  const { buffer, fileName } = await buildRunWorkbook(id(req));
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition"); // the screen names the saved file from it, and a TEST register must keep saying so
  res.status(200).send(buffer);
};
export const runCalculatePreview = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await previewCalculation(id(req)));
export const runCalculate = async (req: Request, res: Response): Promise<void> => void res.status(202).json(await requestCalculation(id(req), (req.body as { fingerprint: string }).fingerprint, actor(req)));
export const runVoid = async (req: Request, res: Response): Promise<void> => {
  await voidRun(id(req), (req.body as { reason: string }).reason, actor(req));
  res.status(200).json({ ok: true });
};
