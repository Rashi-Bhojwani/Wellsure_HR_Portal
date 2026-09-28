import type { Request, Response } from "express";
import { businessToday } from "../../lib/businessDate";
import * as balancesService from "./balances";
import * as calendarService from "./calendar";
import * as grantsService from "./grants";
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
  const balances = await balancesService.getLeaveBalancesForDisplay(employeeId, viewer(req), asOfDate ? new Date(asOfDate) : businessToday());
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

// ── Admin: leave types & policies (leave.policy.manage) ─────────────────

export async function listAllLeaveTypes(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ leaveTypes: await leaveTypesService.listAllLeaveTypesWithPolicy() });
}

export async function createLeaveType(req: Request, res: Response): Promise<void> {
  res.status(201).json(await leaveTypesService.createLeaveType(req.body, actorMeta(req)));
}

export async function updateLeaveType(req: Request, res: Response): Promise<void> {
  res.status(200).json(await leaveTypesService.updateLeaveType(req.params.id as string, req.body, actorMeta(req)));
}

export async function upsertLeavePolicy(req: Request, res: Response): Promise<void> {
  res.status(200).json(await leaveTypesService.upsertLeavePolicy(req.params.id as string, req.body, actorMeta(req)));
}

// ── Admin: holidays / restricted holidays mutations (leave.policy.manage) ─

export async function createHoliday(req: Request, res: Response): Promise<void> {
  res.status(201).json(await holidaysService.createHoliday(req.body, actorMeta(req)));
}
export async function updateHoliday(req: Request, res: Response): Promise<void> {
  res.status(200).json(await holidaysService.updateHoliday(req.params.id as string, req.body, actorMeta(req)));
}
export async function deleteHoliday(req: Request, res: Response): Promise<void> {
  await holidaysService.deleteHoliday(req.params.id as string, actorMeta(req));
  res.status(204).send();
}
export async function bulkCreateHolidays(req: Request, res: Response): Promise<void> {
  res.status(200).json({ results: await holidaysService.bulkCreateHolidays(req.body, actorMeta(req)) });
}

export async function createRestrictedHoliday(req: Request, res: Response): Promise<void> {
  res.status(201).json(await holidaysService.createRestrictedHoliday(req.body, actorMeta(req)));
}
export async function updateRestrictedHoliday(req: Request, res: Response): Promise<void> {
  res.status(200).json(await holidaysService.updateRestrictedHoliday(req.params.id as string, req.body, actorMeta(req)));
}
export async function deleteRestrictedHoliday(req: Request, res: Response): Promise<void> {
  await holidaysService.deleteRestrictedHoliday(req.params.id as string, actorMeta(req));
  res.status(204).send();
}
export async function bulkCreateRestrictedHolidays(req: Request, res: Response): Promise<void> {
  res.status(200).json({ results: await holidaysService.bulkCreateRestrictedHolidays(req.body, actorMeta(req)) });
}

// ── Admin: manual grant/debit + comp-off grant (leave.grant) ────────────

export async function manualGrant(req: Request, res: Response): Promise<void> {
  res.status(201).json(await grantsService.manualGrantOrDebit(req.body, actorMeta(req)));
}

export async function manualCompOffGrant(req: Request, res: Response): Promise<void> {
  res.status(201).json(await grantsService.manualCompOffGrant(req.body, actorMeta(req)));
}

export async function listCompOffCredits(req: Request, res: Response): Promise<void> {
  const { employeeId } = req.query as { employeeId: string };
  res.status(200).json({ credits: await grantsService.listCompOffCredits(employeeId, viewer(req)) });
}
