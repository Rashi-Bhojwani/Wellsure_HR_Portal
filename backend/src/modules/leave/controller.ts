import type { Request, Response } from "express";
import { businessToday } from "../../lib/businessDate";
import * as balancesService from "./balances";
import * as calendarService from "./calendar";
import * as dashboardService from "./dashboard";
import * as grantsService from "./grants";
import * as holidaysService from "./holidays";
import * as leaveTypesService from "./leaveTypes";
import * as recalculatorService from "./recalculator";
import * as requestsService from "./requests";
import type { ActorMeta, LeaveViewer } from "./types";
import * as yearEndService from "./yearEnd";

function actorMeta(req: Request): ActorMeta {
  return { actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null };
}
function viewer(req: Request): LeaveViewer {
  return { employeeId: req.user!.employeeId, roleCodes: req.user!.roleCodes, dataScope: req.user!.dataScope, permissions: req.user!.permissions };
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

// ── Holidays (company-wide; read-only in commit B) ──────────────────────

export async function listHolidays(req: Request, res: Response): Promise<void> {
  const { year } = req.query as { year?: number };
  res.status(200).json({ holidays: await holidaysService.listHolidays(year) });
}

export async function listRestrictedHolidays(req: Request, res: Response): Promise<void> {
  const { year } = req.query as { year?: number };
  res.status(200).json({ holidays: await holidaysService.listRestrictedHolidays(year) });
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

// ── Admin: Year End Process (leave.yearend.manage) ──────────────────────

export async function listYearEndRuns(req: Request, res: Response): Promise<void> {
  const { year } = req.query as { year?: number };
  res.status(200).json({ runs: await yearEndService.listYearEndRuns(year) });
}

export async function getYearEndRun(req: Request, res: Response): Promise<void> {
  res.status(200).json(await yearEndService.getYearEndRun(req.params.id as string));
}

export async function previewYearEnd(req: Request, res: Response): Promise<void> {
  const { leaveYear } = req.body as { leaveYear: number };
  res.status(201).json(await yearEndService.previewYearEnd(leaveYear, actorMeta(req)));
}

export async function discardYearEndRun(req: Request, res: Response): Promise<void> {
  await yearEndService.discardYearEndRun(req.params.id as string, actorMeta(req));
  res.status(204).send();
}

export async function commitYearEndRun(req: Request, res: Response): Promise<void> {
  const { confirmText } = req.body as { confirmText?: string };
  res.status(200).json(await yearEndService.commitYearEndRun(req.params.id as string, actorMeta(req), { confirmText }));
}

export async function downloadYearEndReport(req: Request, res: Response): Promise<void> {
  const { buffer, fileName } = await yearEndService.buildYearEndReport(req.params.id as string);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.status(200).send(buffer);
}

// ── Admin: Leave Recalculator (leave.recalculate) ────────────────────────

export async function previewRecalculation(req: Request, res: Response): Promise<void> {
  const { employeeIds, fromDate } = req.body as { employeeIds: string[]; fromDate: string };
  res.status(200).json(await recalculatorService.previewRecalculation(employeeIds, fromDate, actorMeta(req)));
}

export async function commitRecalculation(req: Request, res: Response): Promise<void> {
  const { employeeIds, fromDate, confirmText } = req.body as { employeeIds: string[]; fromDate: string; confirmText?: string };
  res.status(200).json(await recalculatorService.commitRecalculation(employeeIds, fromDate, actorMeta(req), { confirmText }));
}

// ── Admin: Workforce Overview dashboard (leave.view) ──────────────────────

export async function getWorkforceDashboard(req: Request, res: Response): Promise<void> {
  const { year } = req.query as never as { year: number };
  res.status(200).json(await dashboardService.getWorkforceDashboard(year));
}
