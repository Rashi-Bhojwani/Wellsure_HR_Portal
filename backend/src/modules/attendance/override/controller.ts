import type { Request, Response } from "express";
import type { Viewer } from "../manual/scope";
import type { Meta } from "../processService";
import * as manual from "./manualOverride";
import * as roster from "../roster/roster";
import * as shift from "./shiftOverride";

const viewer = (req: Request): Viewer => ({ userId: req.user!.userId, employeeId: req.user!.employeeId, permissions: req.user!.permissions, dataScope: req.user!.dataScope });
const meta = (req: Request): Meta => ({ actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.get("user-agent") ?? null });

export async function overridePreview(req: Request, res: Response): Promise<void> {
  res.status(200).json(await manual.previewOverride(viewer(req), req.body as manual.OverrideInput));
}
export async function overrideConfirm(req: Request, res: Response): Promise<void> {
  res.status(200).json(await manual.confirmOverride(viewer(req), req.body as manual.OverrideInput & { fingerprint: string }, meta(req)));
}
export async function overrideClear(req: Request, res: Response): Promise<void> {
  res.status(200).json(await manual.clearOverride(viewer(req), req.body as { employeeId: string; date: string; note: string }, meta(req)));
}
export async function overrideList(req: Request, res: Response): Promise<void> {
  res.status(200).json(await manual.listOverrides(req.query as unknown as Parameters<typeof manual.listOverrides>[0]));
}

export async function shiftPreview(req: Request, res: Response): Promise<void> {
  res.status(200).json(await shift.previewShiftOverride(viewer(req), req.body as shift.ShiftOverrideInput));
}
export async function shiftConfirm(req: Request, res: Response): Promise<void> {
  res.status(200).json(await shift.confirmShiftOverride(viewer(req), req.body as shift.ShiftOverrideInput & { fingerprint: string }, meta(req)));
}
export async function shiftClear(req: Request, res: Response): Promise<void> {
  res.status(200).json(await shift.clearShiftOverride(viewer(req), req.body as { employeeId: string; date: string; note: string }, meta(req)));
}
export async function shiftList(req: Request, res: Response): Promise<void> {
  res.status(200).json(await shift.listShiftOverrides(req.query as unknown as Parameters<typeof shift.listShiftOverrides>[0]));
}

export async function rosterPreview(req: Request, res: Response): Promise<void> {
  res.status(200).json(await roster.previewRoster(viewer(req), req.body as roster.RosterInput));
}
export async function rosterConfirm(req: Request, res: Response): Promise<void> {
  res.status(200).json(await roster.confirmRoster(viewer(req), req.body as roster.RosterInput & { fingerprint: string }, meta(req)));
}
