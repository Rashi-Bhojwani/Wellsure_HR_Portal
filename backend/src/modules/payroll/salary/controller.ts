import type { Request, Response } from "express";
import { addAdjustment, cancelAdjustment, listAdjustments, previewAdjustment } from "./adjustments";
import { confirmComponent, getComponent, listComponents, previewComponentConfirm, previewComponentSave, saveComponent } from "./components";
import { getEmployeeSalary, listEmployeeSalaries, searchPeople } from "./employees";
import { applyRevision, createRevision, decideRevision, getRevision, listRevisions, previewRevision, submitRevision, withdrawRevision } from "./revisions";
import { confirmStructure, getStructure, listStructures, previewBreakup, previewStructureConfirm, previewStructureSave, saveStructure } from "./structures";

const actor = (req: Request) => ({ userId: req.user!.userId, ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null });
const code = (req: Request) => req.params.code as string;
const id = (req: Request) => req.params.id as string;

// Components
export const components = async (_req: Request, res: Response): Promise<void> => void res.status(200).json({ components: await listComponents() });
export const component = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await getComponent(code(req)));
export const componentSavePreview = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await previewComponentSave(code(req), (req.body as { value: unknown }).value));
export const componentSave = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await saveComponent(code(req), req.body as { value: unknown; note?: string; fingerprint: string }, actor(req)));
export const componentConfirmPreview = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await previewComponentConfirm(code(req), req.user!.userId));
export const componentConfirm = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await confirmComponent(code(req), req.body as { version: number; note: string; fingerprint: string }, actor(req)));

// Structures
export const structures = async (_req: Request, res: Response): Promise<void> => void res.status(200).json({ structures: await listStructures() });
export const structure = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await getStructure(code(req)));
export const structureSavePreview = async (req: Request, res: Response): Promise<void> => {
  const b = req.body as { value: unknown; sampleAnnualCtc: unknown };
  res.status(200).json(await previewStructureSave(code(req), b.value, b.sampleAnnualCtc));
};
export const structureSave = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await saveStructure(code(req), req.body as { value: unknown; sampleAnnualCtc: unknown; note?: string; fingerprint: string }, actor(req)));
export const structureBreakup = async (req: Request, res: Response): Promise<void> => {
  const b = req.body as { value: unknown; annualCtc: unknown; perPerson?: unknown };
  res.status(200).json(await previewBreakup(b.value, b.annualCtc, b.perPerson));
};
export const structureConfirmPreview = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await previewStructureConfirm(code(req), req.user!.userId));
export const structureConfirm = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await confirmStructure(code(req), req.body as { version: number; note: string; fingerprint: string }, actor(req)));

// People's salaries
export const employeeSalaries = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await listEmployeeSalaries(req.query as never));
export const employeeSalary = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await getEmployeeSalary(req.params.employeeId as string));
export const people = async (req: Request, res: Response): Promise<void> => void res.status(200).json({ people: await searchPeople((req.query as { q: string }).q) });

// Revisions
export const revisions = async (req: Request, res: Response): Promise<void> => {
  const q = req.query as unknown as { page: number; pageSize: number };
  res.status(200).json(await listRevisions(q.page, q.pageSize));
};
export const revision = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await getRevision(id(req), req.user!.userId));
export const revisionPreview = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await previewRevision((req.body as { input: unknown }).input, req.user!.userId));
export const revisionCreate = async (req: Request, res: Response): Promise<void> => {
  const b = req.body as { input: unknown; fingerprint: string };
  res.status(201).json(await createRevision(b.input, b.fingerprint, actor(req)));
};
export const revisionSubmit = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await submitRevision(id(req), (req.body as { fingerprint: string }).fingerprint, actor(req)));
export const revisionWithdraw = async (req: Request, res: Response): Promise<void> => {
  await withdrawRevision(id(req), (req.body as { reason: string }).reason, actor(req));
  res.status(200).json({ ok: true });
};
export const revisionDecision = async (req: Request, res: Response): Promise<void> => {
  const approval = await decideRevision(id(req), req.body as { decision: "APPROVE" | "REJECT"; note?: string; fingerprint: string }, actor(req));
  res.status(200).json({ status: approval.status });
};
export const revisionApply = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await applyRevision(id(req), actor(req)));

// Adjustments
export const adjustments = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await listAdjustments(req.query as never));
export const adjustmentPreview = async (req: Request, res: Response): Promise<void> => void res.status(200).json(await previewAdjustment((req.body as { input: unknown }).input, req.user!.userId));
export const adjustmentAdd = async (req: Request, res: Response): Promise<void> => {
  const b = req.body as { input: unknown; fingerprint: string };
  res.status(201).json(await addAdjustment(b.input, b.fingerprint, actor(req)));
};
export const adjustmentCancel = async (req: Request, res: Response): Promise<void> => {
  await cancelAdjustment(id(req), (req.body as { reason: string }).reason, actor(req));
  res.status(200).json({ ok: true });
};
