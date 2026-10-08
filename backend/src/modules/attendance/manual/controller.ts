import type { Request, Response } from "express";
import type { Meta } from "../processService";
import * as muster from "./muster";
import type { Viewer } from "./scope";
import * as upload from "./upload";

const viewer = (req: Request): Viewer => ({ userId: req.user!.userId, employeeId: req.user!.employeeId, permissions: req.user!.permissions, dataScope: req.user!.dataScope });
const meta = (req: Request): Meta => ({ actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.get("user-agent") ?? null });
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function cycles(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await muster.musterCycles());
}
export async function getMuster(req: Request, res: Response): Promise<void> {
  res.status(200).json(await muster.getMuster(viewer(req), req.query as muster.MusterQuery));
}
export async function exportMuster(req: Request, res: Response): Promise<void> {
  const { buffer, fileName } = await muster.exportMuster(viewer(req), req.query as muster.MusterQuery);
  res.setHeader("Content-Type", XLSX);
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.status(200).send(buffer);
}
export async function saveEntries(req: Request, res: Response): Promise<void> {
  res.status(200).json(await muster.saveEntries(viewer(req), (req.body as { entries: muster.CellEdit[] }).entries, meta(req)));
}
export async function markPresent(req: Request, res: Response): Promise<void> {
  res.status(200).json(await muster.markAllPresent(viewer(req), req.body as { date: string; locationId: string }, meta(req)));
}
export async function template(req: Request, res: Response): Promise<void> {
  const { buffer, fileName } = await upload.musterTemplate(viewer(req), req.query as { locationId: string; cycleStart?: string });
  res.setHeader("Content-Type", XLSX);
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.status(200).send(buffer);
}
export async function previewUpload(req: Request, res: Response): Promise<void> {
  if (!req.file) {
    res.status(400).json({ error: { message: "Choose the filled-in muster file to upload.", code: "INVALID_UPLOAD" } });
    return;
  }
  res.status(200).json(await upload.previewUpload(viewer(req), req.file));
}
export async function commitUpload(req: Request, res: Response): Promise<void> {
  res.status(200).json(await upload.commitUpload(viewer(req), req.params.id as string, meta(req)));
}
