import type { NextFunction, Request, Response } from "express";
import { resolveAccess } from "../../lib/permissions";
import { HttpError } from "../../middleware/errorHandler";
import type { AuthenticatedUser } from "../../middleware/types";

export type ExitActor = AuthenticatedUser;
export type ExitMeta = { actorUserId: string; ipAddress?: string | null; userAgent?: string | null };
export const metaOf = (req: Request): ExitMeta => ({ actorUserId: req.user!.userId, ipAddress: req.ip, userAgent: req.headers["user-agent"] });
export function requireExitUser(req: Request, _res: Response, next: NextFunction) {
  if (req.user!.roleCodes.includes("DEVELOPER")) return next(new HttpError(403, "Exits are unavailable to Developer.", "FORBIDDEN"));
  next();
}
export async function requireExitDirector(userId: string) {
  const access = await resolveAccess(userId);
  if (!access.isSuperAdmin) throw new HttpError(403, "Only a director can do this.", "FORBIDDEN");
}
