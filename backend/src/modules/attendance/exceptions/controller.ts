import type { Request, Response } from "express";
import type { Viewer } from "../manual/scope";
import type { Meta } from "../processService";
import * as bulk from "./bulk";
import * as exceptions from "./exceptions";

const viewer = (req: Request): Viewer => ({ userId: req.user!.userId, employeeId: req.user!.employeeId, permissions: req.user!.permissions, dataScope: req.user!.dataScope });
const meta = (req: Request): Meta => ({ actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.get("user-agent") ?? null });

export async function list(req: Request, res: Response): Promise<void> {
  res.status(200).json(await exceptions.listExceptions(viewer(req), req.query as unknown as exceptions.ExceptionQuery));
}
export async function previewMap(req: Request, res: Response): Promise<void> {
  res.status(200).json(await bulk.previewMapDeviceIds(viewer(req), req.body as bulk.MapSelection));
}
export async function confirmMap(req: Request, res: Response): Promise<void> {
  const b = req.body as bulk.MapSelection & { fingerprint: string };
  res.status(200).json(await bulk.confirmMapDeviceIds(viewer(req), b, { fingerprint: b.fingerprint }, meta(req)));
}
export async function previewAssign(req: Request, res: Response): Promise<void> {
  const b = req.body as bulk.AssignSelection & { shiftId: string };
  res.status(200).json(await bulk.previewAssignShift(viewer(req), b, { shiftId: b.shiftId }));
}
export async function confirmAssign(req: Request, res: Response): Promise<void> {
  const b = req.body as bulk.AssignSelection & bulk.AssignInput & { fingerprint: string };
  res.status(200).json(await bulk.confirmAssignShift(viewer(req), b, b, meta(req)));
}
