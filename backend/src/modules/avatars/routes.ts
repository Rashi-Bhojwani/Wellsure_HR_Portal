import { Router, type Request, type Response } from "express";
import { authenticate } from "../../middleware/authenticate";
import { requireAuth, requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import { removeOthersPhoto } from "./service";
import { employeeParams, removeSchema } from "./validators";

// Avatars (Peeps). The employee's own photo is the existing /api/employees/me/photo; this router holds the one moderation action: HR and the directors
// (avatars.moderate) remove someone else's photo with a reason, audited. The Developer holds no such key.
export const avatarsRouter = Router();
avatarsRouter.use(authenticate, requireAuth);

avatarsRouter.post("/:employeeId/remove", requirePermission("avatars.moderate"), validate({ params: employeeParams, body: removeSchema }), async (req: Request, res: Response) => {
  const meta = { actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null };
  res.status(200).json(await removeOthersPhoto(req.params.employeeId as string, (req.body as { reason: string }).reason, req.user!, meta));
});
