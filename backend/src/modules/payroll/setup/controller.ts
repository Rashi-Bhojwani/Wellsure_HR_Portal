import type { Request, Response } from "express";
import type { PayrollSetupArea } from "@prisma/client";
import { buildAccessReport } from "./access";
import { giveSignoff, previewSignoff } from "./signoffs";
import { buildSetupReport, readinessOf } from "./status";

const area = (req: Request) => req.params.area as PayrollSetupArea;

export async function checklist(_req: Request, res: Response): Promise<void> {
  const report = await buildSetupReport();
  res.status(200).json({ ...report, readiness: readinessOf(report) });
}
export async function ready(_req: Request, res: Response): Promise<void> {
  res.status(200).json(readinessOf(await buildSetupReport()));
}
export async function access(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await buildAccessReport());
}
export async function signoffPreview(req: Request, res: Response): Promise<void> {
  res.status(200).json(await previewSignoff(area(req), req.user!.userId, req.user!.permissions));
}
export async function signoff(req: Request, res: Response): Promise<void> {
  const b = req.body as { fingerprint: string; note: string };
  const row = await giveSignoff(area(req), b, { userId: req.user!.userId, permissions: req.user!.permissions, ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null });
  res.status(201).json({ id: row.id, area: row.area, signedAt: row.signedAt.toISOString() });
}
