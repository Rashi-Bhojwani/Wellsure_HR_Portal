import type { Request, Response } from "express";
import { listAuditLogs } from "../auditLog/service";
import { checkerAvailability } from "./approvals";
import { confirmRule, editRule, getRule, listRules, previewConfirm, previewEdit, revealRule } from "./rules/governed";
import "./rules/governed"; // registers the RULE_CONFIRM maker-checker subject

const actor = (req: Request) => ({ userId: req.user!.userId, ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null });
const key = (req: Request) => req.params.key as string;

export async function rules(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ rules: await listRules() });
}
export async function rule(req: Request, res: Response): Promise<void> {
  res.status(200).json(await getRule(key(req)));
}
export async function editPreview(req: Request, res: Response): Promise<void> {
  res.status(200).json(await previewEdit(key(req), (req.body as { value: unknown }).value));
}
export async function edit(req: Request, res: Response): Promise<void> {
  const b = req.body as { value: unknown; note?: string; fingerprint: string };
  res.status(200).json(await editRule(key(req), b, actor(req)));
}
export async function confirmPreview(req: Request, res: Response): Promise<void> {
  res.status(200).json(await previewConfirm(key(req), req.user!.userId));
}
export async function confirm(req: Request, res: Response): Promise<void> {
  const b = req.body as { version: number; typedValue?: unknown; note: string; fingerprint: string };
  res.status(200).json(await confirmRule(key(req), b, actor(req)));
}
export async function reveal(req: Request, res: Response): Promise<void> {
  res.status(200).json(await revealRule(key(req), actor(req)));
}
export async function checkers(req: Request, res: Response): Promise<void> {
  const { subject } = req.query as { subject: Parameters<typeof checkerAvailability>[0] };
  res.status(200).json(await checkerAvailability(subject, { makerUserId: null }));
}
/** The Payroll audit trail: payroll's own audit rows, behind exactly the permission salary data has (no weaker gate). */
export async function audit(req: Request, res: Response): Promise<void> {
  res.status(200).json(await listAuditLogs(req.query as never, { canSeePayroll: true, onlyPayroll: true }));
}
