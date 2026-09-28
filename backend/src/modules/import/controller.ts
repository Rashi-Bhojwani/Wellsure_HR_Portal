import type { Request, Response } from "express";
import { HttpError } from "../../middleware/errorHandler";
import * as importService from "./service";
import type { ImportDatasetKey } from "./types";

function actorMeta(req: Request) {
  return { actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null };
}

export async function downloadTemplate(req: Request, res: Response): Promise<void> {
  const dataset = req.params.dataset as ImportDatasetKey;
  const buffer = await importService.buildTemplate(dataset);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${dataset}-template.xlsx"`);
  res.status(200).send(buffer);
}

export async function upload(req: Request, res: Response): Promise<void> {
  const dataset = req.params.dataset as ImportDatasetKey;
  const file = req.file;
  if (!file) throw new HttpError(400, "No file uploaded.", "NO_FILE");
  const result = await importService.uploadAndValidate(dataset, file.buffer, file.originalname, actorMeta(req), req.user!.permissions);
  res.status(201).json(result);
}

export async function listBatches(req: Request, res: Response): Promise<void> {
  const dataset = req.query.dataset as ImportDatasetKey | undefined;
  res.status(200).json({ batches: await importService.listBatches(dataset) });
}

export async function getBatch(req: Request, res: Response): Promise<void> {
  res.status(200).json(await importService.getBatch(req.params.id as string));
}

export async function downloadErrorReport(req: Request, res: Response): Promise<void> {
  const { buffer, fileName } = await importService.buildErrorReport(req.params.id as string);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.status(200).send(buffer);
}

export async function commitBatch(req: Request, res: Response): Promise<void> {
  const { confirmText } = req.body as { confirmText?: string };
  const result = await importService.commitBatch(req.params.id as string, actorMeta(req), req.user!.permissions, { confirmText });
  res.status(200).json(result);
}

export async function reconciliationReport(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await importService.reconciliationReport());
}
