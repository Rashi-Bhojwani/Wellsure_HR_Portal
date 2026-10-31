import type { NextFunction, Request, Response } from "express";
import { writeAuditLog } from "../../lib/audit";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { notifyEmployee } from "../notifications/notifyEmployee";
import { removePhoto } from "../people/photos";
import type { ActorMeta } from "../peeps/types";

// Avatars (Peeps: avatars and directory). Every employee has one: their photo, or their initials when there is none (frontend EmployeeAvatar). The photo
// itself is the existing People photo (modules/people/photos.ts: decoded, re-encoded to WebP, metadata dropped; size from System Settings → People &
// Documents). Owner decisions:
//   - only the employee adds, changes or removes their own photo (PUT/DELETE /api/employees/me/photo);
//   - HR and the directors may REMOVE someone else's inappropriate photo, with a reason, audited (POST /api/avatars/:employeeId/remove); they never
//     put a photo of their own choosing on someone else's profile, so the by-id upload and the reason-less by-id removal refuse anyone but the owner.

const OWNER_ONLY = "A profile photo is added or changed only by its owner. HR and the directors can remove an inappropriate one, with a reason.";

/** In front of /api/employees/:id/photo (both methods): only the owner's own record (or "me"). */
export function ownPhotoOnly(req: Request, _res: Response, next: NextFunction): void {
  const id = req.params.id;
  if (!req.user) return next(new HttpError(401, "Authentication required", "UNAUTHENTICATED"));
  if (id === "me" || id === req.user.employeeId) return next();
  next(new HttpError(403, OWNER_ONLY, "PHOTO_OWNER_ONLY"));
}

/** HR or a director removes someone else's photo. The reason is in the audit entry; the person is told, in general words, that it was removed. */
export async function removeOthersPhoto(employeeId: string, reason: string, actor: { employeeId: string }, meta: ActorMeta): Promise<{ removed: boolean }> {
  if (employeeId === actor.employeeId) throw new HttpError(409, "To remove your own photo, use your profile.", "OWN_PHOTO");
  const personal = await prisma.employeePersonal.findUnique({ where: { employeeId }, select: { photoVersion: true } });
  if (!personal) throw new HttpError(404, "Employee not found.", "NOT_FOUND");
  if (!personal.photoVersion) return { removed: false };
  await removePhoto(employeeId, meta, "peeps.avatar.removed_by_moderator");
  await writeAuditLog({ ...meta, action: "peeps.avatar.removal_reason", entityType: "Employee", entityId: employeeId, after: { reason, removedVersion: personal.photoVersion } });
  await notifyEmployee(employeeId, { type: "peeps.avatar.removed", title: "Your profile photo was removed", body: "HR removed it. You can add a different photo on your profile.", link: "/app/profile" });
  return { removed: true };
}
