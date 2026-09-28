import type { Request, Response } from "express";
import * as balancesService from "./balances";
import * as calendarService from "./calendar";
import * as holidaysService from "./holidays";
import * as leaveTypesService from "./leaveTypes";
import * as requestsService from "./requests";
import type { ActorMeta, LeaveViewer } from "./types";

function actorMeta(req: Request): ActorMeta {
  return { actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null };
}
function viewer(req: Request): LeaveViewer {
  return { employeeId: req.user!.employeeId, roleCodes: req.user!.roleCodes, permissions: req.user!.permissions };
}

// ── Leave types (read-only here) ────────────────────────────────────────

export async function listLeaveTypes(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ leaveTypes: await leaveTypesService.listActiveLeaveTypes() });
}

// ── Requests ─────────────────────────────────────────────────────────────

export async function applyForLeave(req: Request, res: Response): Promise<void> {
  const result = await requestsService.applyForLeave(req.body, viewer(req), actorMeta(req));
  res.status(201).json(result);
}

export async function listLeaveRequests(req: Request, res: Response): Promise<void> {
  res.status(200).json(await requestsService.listLeaveRequests(req.query as never, viewer(req)));
}

export async function getLeaveRequest(req: Request, res: Response): Promise<void> {
  res.status(200).json(await requestsService.getLeaveRequestById(req.params.id as string, viewer(req)));
}

export async function approveLeaveRequest(req: Request, res: Response): Promise<void> {
  const { comments } = req.body as { comments?: string };
  res.status(200).json(await requestsService.approveLeaveRequest(req.params.id as string, viewer(req), comments, actorMeta(req)));
}

export async function rejectLeaveRequest(req: Request, res: Response): Promise<void> {
  const { comments } = req.body as { comments: string };
  res.status(200).json(await requestsService.rejectLeaveRequest(req.params.id as string, viewer(req), comments, actorMeta(req)));
}

export async function bulkApproveLeaveRequests(req: Request, res: Response): Promise<void> {
  const { ids, comments } = req.body as { ids: string[]; comments?: string };
  res.status(200).json({ results: await requestsService.bulkApproveLeaveRequests(ids, viewer(req), comments, actorMeta(req)) });
}

export async function cancelLeaveRequest(req: Request, res: Response): Promise<void> {
  const { reason } = req.body as { reason?: string };
  res.status(200).json(await requestsService.cancelLeaveRequest(req.params.id as string, viewer(req), reason, actorMeta(req)));
}

// ── Balances ─────────────────────────────────────────────────────────────

export async function getLeaveBalances(req: Request, res: Response): Promise<void> {
  const { employeeId, asOfDate } = req.query as { employeeId?: string; asOfDate?: string };
  const balances = await balancesService.getLeaveBalancesForDisplay(employeeId, viewer(req), asOfDate ? new Date(asOfDate) : new Date());
  res.status(200).json({ balances });
}

// ── Calendar ─────────────────────────────────────────────────────────────

export async function getLeaveCalendar(req: Request, res: Response): Promise<void> {
  const entries = await calendarService.getLeaveCalendar(req.query as never, viewer(req));
  res.status(200).json({ entries });
}

// ── Holidays (read-only in commit B) ────────────────────────────────────

export async function listHolidays(req: Request, res: Response): Promise<void> {
  const { locationId, year } = req.query as { locationId?: string; year?: number };
  const resolvedLocationId = locationId ?? (await holidaysService.getEmployeeCurrentLocationId(viewer(req).employeeId));
  const holidays = resolvedLocationId ? await holidaysService.listHolidays(resolvedLocationId, year) : [];
  res.status(200).json({ holidays, locationId: resolvedLocationId });
}

export async function listRestrictedHolidays(req: Request, res: Response): Promise<void> {
  const { locationId, year } = req.query as { locationId?: string; year?: number };
  const resolvedLocationId = locationId ?? (await holidaysService.getEmployeeCurrentLocationId(viewer(req).employeeId));
  const holidays = resolvedLocationId ? await holidaysService.listRestrictedHolidays(resolvedLocationId, year) : [];
  res.status(200).json({ holidays, locationId: resolvedLocationId });
}
