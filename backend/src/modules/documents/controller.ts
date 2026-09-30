import type { Request, Response } from "express";
import { requireFile } from "../../lib/uploads";
import * as service from "./service";

function viewer(req: Request): service.DocumentViewer {
  return { userId: req.user!.userId, employeeId: req.user!.employeeId, roleCodes: req.user!.roleCodes, permissions: req.user!.permissions };
}
function actorMeta(req: Request): service.ActorMeta {
  return { actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null };
}
const id = (req: Request) => req.params.id as string;

// Categories
export async function listCategories(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.listCategories(req.query as never));
}
export async function createCategory(req: Request, res: Response): Promise<void> {
  res.status(201).json(await service.createCategory(req.body, actorMeta(req)));
}
export async function updateCategory(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.updateCategory(id(req), req.body, actorMeta(req)));
}

// Company documents
export async function listCompanyDocuments(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.listCompanyDocumentsForEmployee(req.user!.employeeId));
}
export async function listManagedCompanyDocuments(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.listCompanyDocumentsForManagement(req.query as never));
}
export async function uploadCompanyDocument(req: Request, res: Response): Promise<void> {
  res.status(201).json(await service.uploadCompanyDocument(requireFile(req.file), req.body, actorMeta(req)));
}
export async function updateCompanyDocument(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.updateCompanyDocument(id(req), req.body, actorMeta(req)));
}
export async function archiveCompanyDocument(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.setCompanyDocumentArchived(id(req), true, actorMeta(req)));
}
export async function unarchiveCompanyDocument(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.setCompanyDocumentArchived(id(req), false, actorMeta(req)));
}
export async function downloadCompanyDocument(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.downloadCompanyDocument(id(req), viewer(req)));
}
export async function getCompanyDocumentDownloads(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.getCompanyDocumentDownloads(id(req)));
}

// My documents
export async function listMyDocuments(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.listMyDocuments(req.user!.employeeId));
}
export async function downloadMyDocument(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.downloadMyDocument(id(req), req.user!.employeeId));
}

// Employee documents (HR)
export async function listEmployeeDocuments(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.listEmployeeDocuments(req.params.employeeId as string, viewer(req)));
}
export async function uploadEmployeeDocument(req: Request, res: Response): Promise<void> {
  const created = await service.uploadEmployeeDocument(req.params.employeeId as string, requireFile(req.file), req.body, viewer(req), actorMeta(req));
  res.status(201).json(created);
}
export async function updateEmployeeDocument(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.updateEmployeeDocument(id(req), req.body, viewer(req), actorMeta(req)));
}
export async function archiveEmployeeDocument(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.setEmployeeDocumentArchived(id(req), true, viewer(req), actorMeta(req)));
}
export async function unarchiveEmployeeDocument(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.setEmployeeDocumentArchived(id(req), false, viewer(req), actorMeta(req)));
}
export async function downloadEmployeeDocument(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.downloadEmployeeDocument(id(req), viewer(req), actorMeta(req)));
}
