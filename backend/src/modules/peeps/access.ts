import type { NextFunction, Request, Response } from "express";
import type { PermissionKey } from "@shared/constants/permissions";
import { writeAuditLogs } from "../../lib/audit";
import { SUPER_ADMIN_ROLE_CODE } from "../../lib/permissions";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { tagGate } from "../../middleware/rbac";
import { keysFor, memberStateFor } from "./office";
import { getSetting } from "./settings";
import type { ActorMeta, PeepsActor } from "./types";

// Who may use a Peeps route (owner decisions D-28, D-29, D-30).
//   requireDirector(key)  the two directors only.
//   requireOffice(key)    the directors, or an active Wellsure Office member whose capabilities include the key (and, for a module whose audience is a
//                         setting, while that setting lets the Wellsure Office work it). No role opens it: not HR, not managers, and not a grant made by
//                         hand on the Roles & Permissions screen — the membership itself is checked on every request.
// Both are tagged with their key, so the route inventory test reads them like requirePermission.

declare module "express-serve-static-core" {
  interface Request {
    peeps?: PeepsActor;
  }
}

export const isDirectorUser = (req: Request): boolean => Boolean(req.user?.roleCodes.includes(SUPER_ADMIN_ROLE_CODE));

export async function actorFor(req: Request): Promise<PeepsActor> {
  if (req.peeps) return req.peeps;
  const user = req.user!;
  const member = await memberStateFor(user.employeeId);
  req.peeps = { userId: user.userId, employeeId: user.employeeId, isDirector: isDirectorUser(req), isMember: Boolean(member), capabilities: member?.capabilities ?? [], roleCodes: user.roleCodes };
  return req.peeps;
}

export function metaOf(req: Request): ActorMeta {
  return { actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null };
}

const REFUSED = "Only the directors and the Wellsure Office members they choose can open this.";

export function requireDirector(key: PermissionKey) {
  const fn = (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new HttpError(401, "Authentication required", "UNAUTHENTICATED"));
    if (!isDirectorUser(req)) return next(new HttpError(403, "Only a director can do this.", "FORBIDDEN"));
    next();
  };
  return tagGate(fn, [key]);
}

type AudienceCheck = (actor: PeepsActor) => Promise<boolean>;

/** Office modules whose audience is a director setting. Not set = the Wellsure Office may not work it yet (the directors still can). */
export const officeAudience: Record<"assets", AudienceCheck> = {
  assets: async () => (await getSetting<{ officeManages: boolean }>("audience.assets"))?.officeManages === true,
};

export function requireOffice(key: PermissionKey, audience?: AudienceCheck) {
  const fn = (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new HttpError(401, "Authentication required", "UNAUTHENTICATED"));
    void (async () => {
      const actor = await actorFor(req);
      if (actor.isDirector) return next();
      if (!actor.isMember || !keysFor(actor.capabilities).has(key)) return next(new HttpError(403, REFUSED, "FORBIDDEN"));
      if (audience && !(await audience(actor))) return next(new HttpError(403, "The directors have not opened this to the Wellsure Office.", "FORBIDDEN"));
      next();
    })().catch(next);
  };
  return tagGate(fn, [key]);
}

/**
 * Q-14 (2026-11): a register managed by HR and the directors, which the directors may also open to Wellsure Office members (an audience setting).
 * Lets in: a director; a person whose ROLE holds the key (HR), as the access resolver sees it; or an active member whose capabilities include the key while
 * the audience lets the Wellsure Office work it (they work it company-wide, as the directors' delegates). A key given by hand opens nothing.
 */
export function requireRoleOrOffice(key: PermissionKey, audience: AudienceCheck) {
  const fn = (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new HttpError(401, "Authentication required", "UNAUTHENTICATED"));
    void (async () => {
      if (isDirectorUser(req)) return next();
      if (req.user!.permissions.has(key) && (await roleHolds(req.user!.roleCodes, key))) return next();
      const actor = await actorFor(req);
      if (actor.isMember && keysFor(actor.capabilities).has(key) && (await audience(actor))) return next();
      delete req.peeps; // not let in as a member: the caller keeps their own scope
      next(new HttpError(403, `Missing permission: ${key}`, "FORBIDDEN"));
    })().catch(next);
  };
  return tagGate(fn, [key]);
}

async function roleHolds(roleCodes: readonly string[], key: string): Promise<boolean> {
  if (roleCodes.length === 0) return false;
  return (await prisma.rolePermission.count({ where: { role: { code: { in: [...roleCodes] } }, permission: { key } } })) > 0;
}

/**
 * D-28: a director may open anything, and every time a director opens a private item that is not theirs (an Unmute booking, a private nudge) an audit
 * entry records who, what and when. Never blocks.
 */
export async function auditDirectorOpen(actor: PeepsActor, meta: ActorMeta, entityType: string, entityIds: string[], participant: (id: string) => boolean): Promise<void> {
  if (!actor.isDirector) return;
  const opened = entityIds.filter((id) => !participant(id));
  if (opened.length === 0) return;
  await writeAuditLogs(opened.map((entityId) => ({ ...meta, action: "peeps.director.opened", entityType, entityId })));
}
