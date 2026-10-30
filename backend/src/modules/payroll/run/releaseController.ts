import type { Request, Response } from "express";
import { requireFile } from "../../../lib/uploads";
import { attachResponse, batchForRun, downloadBatchFile, getBatch, markPaid } from "./bankBatches";
import { confirmLayout, getLayout, listLayouts, previewLayoutConfirm, previewLayoutSave, saveLayout, showsBankLayout, viewerOf } from "./layouts";
import { writeAuditLog } from "../../../lib/audit";
import { downloadOutput, generateOutput, listOutputs } from "./outputs";
import { anyPayslip, anyPayslipPdf, anyPayslipWhy, myPayslipWhy, draftPreview, draftPreviewPdf, myPayslip, myPayslipPdf, myPayslips, prepareAgain, runPayslips } from "./payslipAccess";
import { generateBankFile, publishPayslips } from "./release";

const actor = (req: Request) => ({ userId: req.user!.userId, ip: req.ip ?? null });
const meta = (req: Request) => ({ userId: req.user!.userId, ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null });
const id = (req: Request) => req.params.id as string;
const send = (res: Response, status: number, body: unknown): void => void res.status(status).json(body);

// The acts (carried out by someone other than the person who decided)
export const publish = async (req: Request, res: Response): Promise<void> => send(res, 201, await publishPayslips(id(req), actor(req)));
export const bankGenerate = async (req: Request, res: Response): Promise<void> => send(res, 201, await generateBankFile(id(req), actor(req)));

// Payslips: HR
export const runSlips = async (req: Request, res: Response): Promise<void> => send(res, 200, await runPayslips(id(req)));
export const slip = async (req: Request, res: Response): Promise<void> => send(res, 200, await anyPayslip(id(req)));
export const slipWhy = async (req: Request, res: Response): Promise<void> => send(res, 200, await anyPayslipWhy(id(req)));
export const slipPdf = async (req: Request, res: Response): Promise<void> => send(res, 200, await anyPayslipPdf(id(req)));
export const slipsPrepareAgain = async (req: Request, res: Response): Promise<void> => send(res, 202, await prepareAgain(id(req)));
export const preview = async (req: Request, res: Response): Promise<void> => send(res, 200, await draftPreview(id(req), req.params.employeeId as string));
export const previewPdf = async (req: Request, res: Response): Promise<void> => {
  const pdf = await draftPreviewPdf(id(req), req.params.employeeId as string);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'inline; filename="draft-payslip-preview.pdf"');
  res.status(200).send(pdf);
};

// Payslips: the employee's own (SELF: the caller's employee id is the only one ever used)
export const mine = async (req: Request, res: Response): Promise<void> => send(res, 200, await myPayslips(req.user!.employeeId));
export const mineOne = async (req: Request, res: Response): Promise<void> => send(res, 200, await myPayslip(req.user!.employeeId, id(req)));
export const mineWhy = async (req: Request, res: Response): Promise<void> => send(res, 200, await myPayslipWhy(req.user!.employeeId, id(req)));
export const minePdf = async (req: Request, res: Response): Promise<void> => send(res, 200, await myPayslipPdf(req.user!.employeeId, id(req)));

// The bank batch
export const batchOfRun = async (req: Request, res: Response): Promise<void> => send(res, 200, await batchForRun(id(req)));
export const batch = async (req: Request, res: Response): Promise<void> => send(res, 200, await getBatch(id(req)));
export const batchDownload = async (req: Request, res: Response): Promise<void> => send(res, 200, await downloadBatchFile(id(req), actor(req)));
export const batchPaid = async (req: Request, res: Response): Promise<void> => send(res, 200, await markPaid(id(req), req.body as { reference: string; paidOn: string; confirm: string }, actor(req)));
export const batchResponse = async (req: Request, res: Response): Promise<void> => {
  const file = requireFile(req.file);
  send(res, 200, await attachResponse(id(req), { buffer: file.buffer, originalName: file.originalname }, actor(req)));
};

// Statutory files and the register
export const outputs = async (req: Request, res: Response): Promise<void> => send(res, 200, await listOutputs(id(req)));
export const outputGenerate = async (req: Request, res: Response): Promise<void> => send(res, 201, await generateOutput(id(req), (req.body as { kind: Parameters<typeof generateOutput>[1] }).kind, actor(req)));
export const outputDownload = async (req: Request, res: Response): Promise<void> => send(res, 200, await downloadOutput(id(req), actor(req)));

// Layouts (the bank file and the four statutory files, as governed items)
// Looking at the bank layout is recorded: one audit row says who and when, never what it said. Everyone else sees only that it exists, its status, and who confirmed it and when.
const noteBankLayoutSeen = async (req: Request): Promise<void> => {
  await writeAuditLog({ actorUserId: req.user!.userId, action: "payroll.layout.revealed", entityType: "PayrollLayout", entityId: "BANK_TEMPLATE", ipAddress: req.ip ?? null, userAgent: req.get("user-agent") ?? null });
};
export const layouts = async (req: Request, res: Response): Promise<void> => {
  const viewer = viewerOf(req.user!.permissions);
  const all = await listLayouts(viewer);
  if (showsBankLayout(viewer, all)) await noteBankLayoutSeen(req);
  send(res, 200, { layouts: all });
};
export const layout = async (req: Request, res: Response): Promise<void> => {
  const viewer = viewerOf(req.user!.permissions);
  const one = await getLayout(req.params.key as string, viewer);
  if (one.layout.key === "BANK_TEMPLATE" && showsBankLayout(viewer, [one.layout])) await noteBankLayoutSeen(req);
  send(res, 200, one);
};
export const layoutSavePreview = async (req: Request, res: Response): Promise<void> => send(res, 200, await previewLayoutSave(req.params.key as string, (req.body as { value: unknown }).value));
export const layoutSave = async (req: Request, res: Response): Promise<void> => send(res, 200, await saveLayout(req.params.key as string, req.body as { value: unknown; note?: string; fingerprint: string }, meta(req)));
export const layoutConfirmPreview = async (req: Request, res: Response): Promise<void> => send(res, 200, await previewLayoutConfirm(req.params.key as string, req.user!.userId));
export const layoutConfirm = async (req: Request, res: Response): Promise<void> => send(res, 200, await confirmLayout(req.params.key as string, req.body as { version: number; note: string; fingerprint: string }, meta(req)));
