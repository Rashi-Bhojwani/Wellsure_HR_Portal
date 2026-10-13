import type { Request, Response } from "express";
import type { Meta } from "../processService";
import type { Viewer } from "../manual/scope";
import * as bulk from "../regularization/bulk";
import * as reg from "../regularization/service";
import * as info from "./info";

const viewer = (req: Request): Viewer => ({ userId: req.user!.userId, employeeId: req.user!.employeeId, permissions: req.user!.permissions, dataScope: req.user!.dataScope });
const meta = (req: Request): Meta => ({ actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.get("user-agent") ?? null });
const month = (req: Request) => (req.query as { month: string }).month;

// Own attendance (self)
export async function myMonth(req: Request, res: Response): Promise<void> {
  res.status(200).json(await info.monthView(req.user!.employeeId, month(req)));
}
export async function myDay(req: Request, res: Response): Promise<void> {
  res.status(200).json(await info.dayDetail(req.user!.employeeId, req.params.date as string, { self: true }));
}
// Anyone's, in attendance.view scope
export async function employeeMonth(req: Request, res: Response): Promise<void> {
  await info.assertCanView(viewer(req), req.params.employeeId as string);
  res.status(200).json(await info.monthView(req.params.employeeId as string, month(req)));
}
export async function employeeDay(req: Request, res: Response): Promise<void> {
  await info.assertCanView(viewer(req), req.params.employeeId as string);
  res.status(200).json(await info.dayDetail(req.params.employeeId as string, req.params.date as string, { self: false }));
}
export async function whoIsIn(req: Request, res: Response): Promise<void> {
  res.status(200).json(await info.whoIsIn(viewer(req), req.query as { locationId?: string; departmentId?: string }));
}
// The forgot-to-punch request
export async function raise(req: Request, res: Response): Promise<void> {
  res.status(201).json(await reg.raiseRequest(viewer(req), req.body as reg.RaiseInput, meta(req)));
}
export async function cancel(req: Request, res: Response): Promise<void> {
  res.status(200).json(await reg.cancelRequest(viewer(req), req.params.id as string, meta(req)));
}
export async function mine(req: Request, res: Response): Promise<void> {
  res.status(200).json({ requests: await reg.myRequests(req.user!.employeeId) });
}
export async function eligibility(req: Request, res: Response): Promise<void> {
  res.status(200).json(await reg.requestEligibility(req.user!.employeeId, (req.query as { date: string }).date));
}
export async function queue(req: Request, res: Response): Promise<void> {
  res.status(200).json({ requests: await reg.listQueue(viewer(req), req.query as Parameters<typeof reg.listQueue>[1]) });
}
export async function bulkPreview(req: Request, res: Response): Promise<void> {
  res.status(200).json(await bulk.previewBulk(viewer(req), req.body as bulk.BulkInput));
}
export async function bulkConfirm(req: Request, res: Response): Promise<void> {
  res.status(200).json(await bulk.confirmBulk(viewer(req), req.body as bulk.BulkInput & { fingerprint: string }, meta(req)));
}
export async function approve(req: Request, res: Response): Promise<void> {
  res.status(200).json(await reg.decideRequest(viewer(req), req.params.id as string, { approve: true, note: (req.body as { note?: string }).note }, meta(req)));
}
export async function reject(req: Request, res: Response): Promise<void> {
  res.status(200).json(await reg.decideRequest(viewer(req), req.params.id as string, { approve: false, note: (req.body as { note?: string }).note }, meta(req)));
}
