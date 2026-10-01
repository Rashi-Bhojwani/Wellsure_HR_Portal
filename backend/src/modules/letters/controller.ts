import type { Request, Response } from "express";
import { storageService } from "../../integrations/storage";
import { lettersGenerateQueue } from "../../jobs/lettersQueue";
import { prisma } from "../../lib/prisma";
import { requireFile } from "../../lib/uploads";
import { HttpError } from "../../middleware/errorHandler";
import * as service from "./service";

function viewer(req: Request): service.LetterViewer {
  return { userId: req.user!.userId, employeeId: req.user!.employeeId, roleCodes: req.user!.roleCodes, permissions: req.user!.permissions };
}
function actorMeta(req: Request): service.ActorMeta {
  return { actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null };
}
const id = (req: Request) => req.params.id as string;

// jobId = letter id: enqueueing the same letter twice is a no-op.
const enqueue: service.EnqueueLetter = async (letterId) => {
  await lettersGenerateQueue().add("generate", { letterId }, { jobId: letterId, attempts: 3, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: 1000, removeOnFail: 1000 });
};

function sendPdf(res: Response, pdf: Buffer, fileName: string, extraHeaders: Record<string, string> = {}) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${fileName.replace(/"/g, "")}"`);
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  res.status(200).send(pdf);
}

// Templates
export async function listTemplates(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.listTemplates());
}
export async function getTemplate(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.getTemplate(id(req)));
}
export async function createTemplate(req: Request, res: Response): Promise<void> {
  res.status(201).json(await service.createTemplate(req.body, actorMeta(req)));
}
export async function saveNewVersion(req: Request, res: Response): Promise<void> {
  res.status(201).json(await service.saveNewVersion(id(req), req.body, actorMeta(req)));
}
export async function updateTemplate(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.updateTemplateSettings(id(req), req.body, actorMeta(req)));
}
export async function previewTemplate(req: Request, res: Response): Promise<void> {
  sendPdf(res, await service.previewTemplate(req.body, viewer(req)), "preview.pdf");
}

// Letterhead
export async function getLetterhead(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.getLetterhead());
}
export async function updateLetterhead(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.updateLetterhead(req.body, actorMeta(req)));
}
export async function uploadLogo(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.uploadLogo(requireFile(req.file), actorMeta(req)));
}
export async function removeLogo(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.removeLogo(actorMeta(req)));
}
export async function getLogo(_req: Request, res: Response): Promise<void> {
  const company = await prisma.company.findFirst({ orderBy: { createdAt: "asc" } });
  if (!company?.logoStorageKey) throw new HttpError(404, "No logo set.", "NOT_FOUND");
  const obj = await storageService.getObject(company.logoStorageKey);
  res.setHeader("Content-Type", "image/png");
  res.status(200).send(obj.body);
}

// Letters
export async function listEmployeeLetters(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.listEmployeeLetters(req.params.employeeId as string, viewer(req)));
}
export async function issueLetter(req: Request, res: Response): Promise<void> {
  res.status(202).json(await service.issueLetter({ ...req.body, employeeId: req.params.employeeId as string }, viewer(req), actorMeta(req), enqueue));
}
export async function getLetter(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.getLetter(id(req), viewer(req)));
}
export async function reissueLetter(req: Request, res: Response): Promise<void> {
  res.status(202).json(await service.reissueLetter(id(req), req.body, viewer(req), actorMeta(req), enqueue));
}
export async function reproduceLetter(req: Request, res: Response): Promise<void> {
  const r = await service.reproduceLetter(id(req), viewer(req), actorMeta(req));
  sendPdf(res, r.pdf, r.fileName, { "X-Letter-Reproduction": r.matches ? "match" : "mismatch", "Access-Control-Expose-Headers": "X-Letter-Reproduction" });
}
