import { cancelScheduled } from "./scheduledChanges";
import * as photos from "../people/photos";
import { requireFile } from "../../lib/uploads";
import type { Request, Response } from "express";
import { checkDeviceUserId } from "./deviceCode";
import * as employeeService from "./service";
import * as gridService from "./grid";
import * as changeRequestService from "./changeRequests";
import * as separationService from "./separations";
import * as identity from "./identityChanges";
import { exportMyData as buildMyDataExport } from "./selfExport";

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
  // M task 1: HR's bank and statutory details for a new employee wait for a director (when the setting says so); the rest of the record is created now.
  const body = req.body as { statutory?: Record<string, unknown>; bank?: Record<string, unknown> };
  const hasIdentity = !!body.bank || (!!body.statutory && Object.values(body.statutory).some((v) => v !== undefined && v !== null && v !== ""));
  const reason = hasIdentity ? await identity.holdReasonFor(req.user!.userId, null) : null;
  const held: Array<{ row: { id: string; employeeId: string; kind: string; source: string; enteredByUserId: string } }> = [];
  const result = await employeeService.createEmployee(req.body, actorMeta(req), {
    ...(reason && {
      holdIdentity: async (tx, employeeId, bankFrom) => {
        const meta = actorMeta(req);
        if (body.statutory && Object.values(body.statutory).some((v) => v !== undefined && v !== null && v !== "")) {
          held.push({ row: await identity.holdInTx(tx, { employeeId, kind: "STATUTORY", payload: identity.packStatutory(body.statutory), effectiveFrom: null, source: "ADD_EMPLOYEE", enteredByUserId: meta.actorUserId }) });
        }
        if (body.bank) {
          held.push({ row: await identity.holdInTx(tx, { employeeId, kind: "BANK", payload: identity.packBank(body.bank as unknown as Parameters<typeof identity.packBank>[0]), effectiveFrom: bankFrom, source: "ADD_EMPLOYEE", enteredByUserId: meta.actorUserId }) });
        }
      },
    }),
  });
  for (const h of held) await identity.afterHold(h.row, reason!, actorMeta(req));
  if (held.length) (result as Record<string, unknown>).identityPending = held.map((h) => ({ id: h.row.id, kind: h.row.kind }));
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
  res.status(200).json(await employeeService.revealStatutory(req.params.id as string, req.user!.employeeId, scope(req), actorMeta(req), (req.query as { reason: string }).reason));
}
export async function revealBank(req: Request, res: Response): Promise<void> {
  res.status(200).json(await employeeService.revealBank(req.params.id as string, req.user!.employeeId, scope(req), actorMeta(req), (req.query as { reason: string }).reason));
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

export async function exportMyData(req: Request, res: Response): Promise<void> {
  const data = await buildMyDataExport(req.user!.employeeId, actorMeta(req));
  res.setHeader("Content-Disposition", `attachment; filename="my-data-${data.employee.employeeCode}-${data.generatedAt.slice(0, 10)}.json"`);
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json(data);
}

export async function getStatutoryHistory(req: Request, res: Response): Promise<void> {
  res.status(200).json({ history: await employeeService.getStatutoryHistory(req.params.id as string, req.user!.employeeId, scope(req), req.user!.permissions) });
}

export async function updateJob(req: Request, res: Response): Promise<void> {
  res.status(200).json(await employeeService.updateJob(req.params.id as string, req.body, actorMeta(req)));
}
// M task 1: an entry that must wait for a director is held (202, masked) instead of written; otherwise it is written at once, as before.
export async function updateBank(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const reason = await identity.holdReasonFor(req.user!.userId, id);
  if (reason) {
    await employeeService.findScopedEmployee(id, req.user!.employeeId, scope(req));
    const { effectiveFrom } = req.body as { effectiveFrom?: string };
    res.status(202).json(await identity.hold({ employeeId: id, kind: "BANK", payload: identity.packBank(req.body), effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : null, source: reason === "HR_ENTRY" ? "HR_EDIT" : "DIRECTOR_EDIT" }, reason, actorMeta(req)));
    return;
  }
  res.status(200).json(await employeeService.updateBank(id, req.body, actorMeta(req)));
}
export async function updateName(req: Request, res: Response): Promise<void> {
  res.status(200).json(await employeeService.updateName(req.params.id as string, req.body, actorMeta(req)));
}
export async function updateStatutory(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const reason = await identity.holdReasonFor(req.user!.userId, id);
  if (reason) {
    await employeeService.findScopedEmployee(id, req.user!.employeeId, scope(req));
    res.status(202).json(await identity.hold({ employeeId: id, kind: "STATUTORY", payload: identity.packStatutory(req.body), effectiveFrom: null, source: reason === "HR_ENTRY" ? "HR_EDIT" : "DIRECTOR_EDIT" }, reason, actorMeta(req)));
    return;
  }
  res.status(200).json(await employeeService.updateStatutory(id, req.body, actorMeta(req)));
}

// ── Held bank and statutory changes (M task 1) ──────────────────────────

export async function listIdentityChanges(req: Request, res: Response): Promise<void> {
  const q = req.query as { status?: "PENDING" | "CONFIRMED" | "REJECTED" | "WITHDRAWN"; employeeId?: string };
  res.status(200).json({ changes: await identity.list({ userId: req.user!.userId, employeeId: req.user!.employeeId, dataScope: scope(req), permissions: req.user!.permissions }, q) });
}
export async function confirmIdentityChange(req: Request, res: Response): Promise<void> {
  res.status(200).json(await identity.confirm(req.params.id as string, actorMeta(req)));
}
export async function rejectIdentityChange(req: Request, res: Response): Promise<void> {
  res.status(200).json(await identity.reject(req.params.id as string, (req.body as { reason: string }).reason, actorMeta(req)));
}
export async function withdrawIdentityChange(req: Request, res: Response): Promise<void> {
  res.status(200).json(await identity.withdraw(req.params.id as string, actorMeta(req)));
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
