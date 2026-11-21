import { HttpError } from "../../middleware/errorHandler";
import * as directorChanges from "./directorChanges";
import type { Request, Response } from "express";
import * as service from "./service";

function actor(req: Request): service.AccessActor {
  const u = req.user!;
  return { userId: u.userId, employeeId: u.employeeId, roleCodes: u.roleCodes, permissions: u.permissions, dataScope: u.dataScope };
}
function actorMeta(req: Request): service.ActorMeta {
  return { actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null };
}
const emp = (req: Request) => req.params.employeeId as string;

export async function listRoles(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ roles: await service.listRoles() });
}
export async function updateRole(req: Request, res: Response): Promise<void> {
  res.status(200).json({ role: await service.updateRole(req.params.code as string, req.body, actor(req), actorMeta(req)) });
}
export async function getEmployeeAccess(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.getEmployeeAccess(emp(req), actor(req)));
}
// FIX-C2: a change about a director (or making one) is a proposal: 202 until the other director confirms it.
const sendMaybePending = (res: Response, body: unknown) => res.status((body as { pendingConfirmation?: boolean }).pendingConfirmation ? 202 : 200).json(body);
export async function assignRole(req: Request, res: Response): Promise<void> {
  sendMaybePending(res, await service.assignRole(emp(req), req.body.code, actor(req), actorMeta(req), { reason: req.body.reason, thirdDirector: req.body.thirdDirector }));
}
export async function removeRole(req: Request, res: Response): Promise<void> {
  sendMaybePending(res, await service.removeRole(emp(req), req.params.code as string, actor(req), actorMeta(req), { reason: (req.body as { reason?: string } | undefined)?.reason }));
}
export async function listDirectorChanges(req: Request, res: Response): Promise<void> {
  res.json(await directorChanges.listDirectorChanges({ userId: req.user!.userId, employeeId: req.user!.employeeId }));
}
export async function confirmDirectorChange(req: Request, res: Response): Promise<void> {
  res.json(await directorChanges.confirmDirectorChange(String(req.params.id), { userId: req.user!.userId, employeeId: req.user!.employeeId }, { ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null }));
}
export async function rejectDirectorChange(req: Request, res: Response): Promise<void> {
  res.json(await directorChanges.rejectDirectorChange(String(req.params.id), String(req.body.note), { userId: req.user!.userId, employeeId: req.user!.employeeId }, { ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null }));
}
export async function setOverride(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.setOverride(emp(req), req.params.key as string, req.body, actor(req), actorMeta(req)));
}
export async function clearOverride(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.clearOverride(emp(req), req.params.key as string, req.body, actor(req), actorMeta(req)));
}
export async function resetTwoFactor(req: Request, res: Response): Promise<void> {
  sendMaybePending(res, await service.resetTwoFactor(emp(req), req.body.reason, actor(req), actorMeta(req)));
}
export async function unlockAccount(req: Request, res: Response): Promise<void> {
  sendMaybePending(res, await service.unlockAccount(emp(req), req.body.reason, actor(req), actorMeta(req)));
}
export async function sendPasswordReset(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.sendPasswordReset(emp(req), req.body.reason, actor(req), actorMeta(req)));
}

export async function listSecurityEvents(req: Request, res: Response): Promise<void> {
  res.status(200).json({ events: await service.listSecurityEvents(actor(req), (req.query.status as "open" | "all" | undefined) ?? "open") });
}
export async function acknowledgeSecurityEvent(req: Request, res: Response): Promise<void> {
  await service.acknowledgeSecurityEvent(req.params.id as string, req.body.note, actor(req), actorMeta(req));
  res.status(204).send();
}

// A-9 G7 (docs/plans/GREYTHR_PARITY_EMPLOYEE_ADMIN.md) — begin
export async function setPortalAccess(req: Request, res: Response): Promise<void> {
  sendMaybePending(res, await service.setPortalAccess(emp(req), req.body.enabled, req.body.reason, actor(req), actorMeta(req)));
}
// A-9 — end

// FIX-H2 (independent audit 2026-11-20): addresses blocked for failed sign-ins. A director or an HR Admin sees and clears them; each clearing is audited.
const mayClearIpBlocks = (req: Request) => req.user!.roleCodes.includes("SUPER_ADMIN") || req.user!.roleCodes.includes("HR_ADMIN");
export async function listLoginBlocks(req: Request, res: Response): Promise<void> {
  if (!mayClearIpBlocks(req)) throw new HttpError(403, "Only a director or an HR Admin can see blocked sign-in addresses.", "FORBIDDEN");
  const { listLoginIpBlocks, loginIpLimit } = await import("../auth/service");
  res.json({ blocks: await listLoginIpBlocks(), limit: await loginIpLimit() });
}
export async function clearLoginBlock(req: Request, res: Response): Promise<void> {
  if (!mayClearIpBlocks(req)) throw new HttpError(403, "Only a director or an HR Admin can clear a blocked sign-in address.", "FORBIDDEN");
  const { clearLoginIpBlock } = await import("../auth/service");
  const ip = String(req.params.ip);
  const cleared = await clearLoginIpBlock(ip);
  const { writeAuditLog } = await import("../../lib/audit");
  await writeAuditLog({ ...actorMeta(req), action: "auth.ip_block.cleared", entityType: "LoginAddress", entityId: ip, after: { reason: (req.body as { reason?: string }).reason ?? null, cleared } });
  res.json({ cleared });
}
