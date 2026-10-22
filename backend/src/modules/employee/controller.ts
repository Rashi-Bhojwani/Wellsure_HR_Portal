import { cancelScheduled } from "./scheduledChanges";
import * as photos from "../people/photos";
import { requireFile } from "../../lib/uploads";
import type { Request, Response } from "express";
import { checkDeviceUserId } from "./deviceCode";
import * as employeeService from "./service";
import * as gridService from "./grid";
import * as changeRequestService from "./changeRequests";
import * as separationService from "./separations";

function actorMeta(req: Request) {
  return { actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null };
}
function viewer(req: Request) {
  return { employeeId: req.user!.employeeId, roleCodes: req.user!.roleCodes, dataScope: req.user!.dataScope, permissions: req.user!.permissions };
}
function scope(req: Request) {
  return req.user!.dataScope;
}

// ── Device code check + create ──────────────────────────────────────────

export async function checkDeviceCode(req: Request, res: Response): Promise<void> {
  const { deviceUserId } = req.query as { deviceUserId: string };
  res.status(200).json(await checkDeviceUserId(deviceUserId));
}

export async function createEmployee(req: Request, res: Response): Promise<void> {
  const result = await employeeService.createEmployee(req.body, actorMeta(req));
  res.status(201).json(result);
}

export async function resendInvite(req: Request, res: Response): Promise<void> {
  res.status(200).json(await employeeService.resendInvite(req.params.id as string, actorMeta(req)));
}

export async function listPendingInvitations(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as { page: number; pageSize: number };
  res.status(200).json(await employeeService.listPendingInvitations(q.page, q.pageSize));
}

export async function sendInvitations(req: Request, res: Response): Promise<void> {
  res.status(200).json(await employeeService.sendInvitations((req.body as { employeeIds: string[] }).employeeIds, actorMeta(req)));
}

// ── Grid + export + saved views ─────────────────────────────────────────

export async function listEmployees(req: Request, res: Response): Promise<void> {
  res.status(200).json(await gridService.listEmployeesGrid(req.query as never, viewer(req), scope(req)));
}

export async function exportEmployees(req: Request, res: Response): Promise<void> {
  const { includeSensitive, ...query } = req.query as never as { includeSensitive: boolean } & gridService.EmployeeListQuery;
  const buffer = await gridService.exportEmployeesExcel(query, viewer(req), scope(req), includeSensitive, actorMeta(req));
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="employees-${new Date().toISOString().slice(0, 10)}.xlsx"`);
  res.status(200).send(buffer);
}

export async function listSavedViews(req: Request, res: Response): Promise<void> {
  const gridKey = (req.query.gridKey as string | undefined) ?? "employees";
  res.status(200).json({ views: await gridService.listSavedViews(req.user!.userId, gridKey) });
}
export async function createSavedView(req: Request, res: Response): Promise<void> {
  res.status(201).json(await gridService.createSavedView(req.user!.userId, req.body));
}
export async function deleteSavedView(req: Request, res: Response): Promise<void> {
  await gridService.deleteSavedView(req.user!.userId, req.params.id as string);
  res.status(204).send();
}

// ── Profile / reveal / history ──────────────────────────────────────────

export async function getProfile(req: Request, res: Response): Promise<void> {
  res.status(200).json(await employeeService.getEmployeeProfile(req.params.id as string, viewer(req), scope(req)));
}
export async function getMyProfile(req: Request, res: Response): Promise<void> {
  res.status(200).json(await employeeService.getMyProfile(req.user!.employeeId));
}

export async function revealStatutory(req: Request, res: Response): Promise<void> {
  res.status(200).json(await employeeService.revealStatutory(req.params.id as string, req.user!.employeeId, scope(req), actorMeta(req)));
}
export async function revealBank(req: Request, res: Response): Promise<void> {
  res.status(200).json(await employeeService.revealBank(req.params.id as string, req.user!.employeeId, scope(req), actorMeta(req)));
}

export async function getJobHistory(req: Request, res: Response): Promise<void> {
  res.status(200).json({ history: await employeeService.getJobHistory(req.params.id as string, req.user!.employeeId, scope(req)) });
}
export async function getNameHistory(req: Request, res: Response): Promise<void> {
  res.status(200).json({ history: await employeeService.getNameHistory(req.params.id as string, req.user!.employeeId, scope(req)) });
}
export async function getBankHistory(req: Request, res: Response): Promise<void> {
  res
    .status(200)
    .json({ history: await employeeService.getBankHistory(req.params.id as string, req.user!.employeeId, scope(req), req.user!.permissions) });
}

// EF3: cancel a scheduled (not yet in force) change.
const cancelOf = (kind: "job" | "name" | "bank") => async (req: Request, res: Response): Promise<void> => {
  res.status(200).json(await cancelScheduled(kind, req.params.id as string, req.params.rowId as string, { employeeId: req.user!.employeeId, dataScope: scope(req) }, actorMeta(req)));
};
export const cancelScheduledJobChange = cancelOf("job");
export const cancelScheduledNameChange = cancelOf("name");
export const cancelScheduledBankChange = cancelOf("bank");

// ── Effective-dated + direct updates ────────────────────────────────────

export async function updateJob(req: Request, res: Response): Promise<void> {
  res.status(200).json(await employeeService.updateJob(req.params.id as string, req.body, actorMeta(req)));
}
export async function updateBank(req: Request, res: Response): Promise<void> {
  res.status(200).json(await employeeService.updateBank(req.params.id as string, req.body, actorMeta(req)));
}
export async function updateName(req: Request, res: Response): Promise<void> {
  res.status(200).json(await employeeService.updateName(req.params.id as string, req.body, actorMeta(req)));
}
export async function updateStatutory(req: Request, res: Response): Promise<void> {
  res.status(200).json(await employeeService.updateStatutory(req.params.id as string, req.body, actorMeta(req)));
}
export async function updatePersonal(req: Request, res: Response): Promise<void> {
  await employeeService.updatePersonal(req.params.id as string, req.body, actorMeta(req));
  res.status(204).send();
}
export async function updateSelfService(req: Request, res: Response): Promise<void> {
  await employeeService.updateSelfService(req.user!.employeeId, req.body, actorMeta(req));
  res.status(204).send();
}

// ── Change requests ──────────────────────────────────────────────────────

export async function createChangeRequest(req: Request, res: Response): Promise<void> {
  const result = await changeRequestService.createChangeRequest(req.user!.employeeId, req.user!.userId, req.body, actorMeta(req));
  res.status(201).json(result);
}
export async function listChangeRequests(req: Request, res: Response): Promise<void> {
  const canApproveAll = req.user!.permissions.has("profile.changerequest.approve");
  const status = req.query.status as "PENDING" | "APPROVED" | "REJECTED" | undefined;
  res.status(200).json({ requests: await changeRequestService.listChangeRequests({ employeeId: req.user!.employeeId, canApproveAll }, status) });
}
export async function approveChangeRequest(req: Request, res: Response): Promise<void> {
  const { remarks } = req.body as { remarks?: string };
  await changeRequestService.approveChangeRequest(req.params.id as string, remarks, actorMeta(req), req.user!.permissions);
  res.status(204).send();
}
export async function rejectChangeRequest(req: Request, res: Response): Promise<void> {
  const { remarks } = req.body as { remarks?: string };
  await changeRequestService.rejectChangeRequest(req.params.id as string, remarks, actorMeta(req));
  res.status(204).send();
}

// ── Separations ──────────────────────────────────────────────────────────

export async function initiateSeparation(req: Request, res: Response): Promise<void> {
  res.status(201).json(await separationService.initiateSeparation(req.params.id as string, req.body, actorMeta(req)));
}
export async function cancelSeparation(req: Request, res: Response): Promise<void> {
  await separationService.cancelSeparation(req.params.id as string, actorMeta(req));
  res.status(204).send();
}
export async function listSeparations(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ separations: await separationService.listSeparations() });
}

// ── Photos (Phase 5 commit C) — pipeline lives in modules/people/photos.ts ──
export async function uploadMyPhoto(req: Request, res: Response): Promise<void> {
  const result = await photos.setPhoto(req.user!.employeeId, requireFile(req.file), actorMeta(req), "employee.photo.self_updated");
  res.status(200).json(result);
}
export async function removeMyPhoto(req: Request, res: Response): Promise<void> {
  await photos.removePhoto(req.user!.employeeId, actorMeta(req), "employee.photo.self_removed");
  res.status(204).send();
}
export async function uploadPhoto(req: Request, res: Response): Promise<void> {
  const employeeId = req.params.id as string;
  await employeeService.findScopedEmployee(employeeId, req.user!.employeeId, scope(req));
  res.status(200).json(await photos.setPhoto(employeeId, requireFile(req.file), actorMeta(req), "employee.photo.updated"));
}
export async function removePhoto(req: Request, res: Response): Promise<void> {
  const employeeId = req.params.id as string;
  await employeeService.findScopedEmployee(employeeId, req.user!.employeeId, scope(req));
  await photos.removePhoto(employeeId, actorMeta(req), "employee.photo.removed");
  res.status(204).send();
}
