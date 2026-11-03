import { Router, type Request, type Response } from "express";
import { authenticate } from "../../middleware/authenticate";
import { requireAuth, requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import { actorFor } from "../peeps/access";
import { avatarMap, catalogueView, chooseOwn, currentFor, surprise } from "./choices";
import { myProfile } from "./profile";
import { removeOthersPhoto } from "./service";
import { chooseSchema, employeeParams, removeSchema, surpriseSchema } from "./validators";

// Avatars (Peeps, D-35). The employee's own photo is the existing /api/employees/me/photo. Here: the catalogue, the caller's own choice (photo,
// initials, a character or a fun pick — only ever their own), "Surprise me", the map every screen uses to draw avatars, and the one moderation action:
// HR and the directors (avatars.moderate) remove someone else's photo with a reason, audited. The Developer holds no such key.
export const avatarsRouter = Router();
avatarsRouter.use(authenticate, requireAuth);

avatarsRouter.post("/:employeeId/remove", requirePermission("avatars.moderate"), validate({ params: employeeParams, body: removeSchema }), async (req: Request, res: Response) => {
  const meta = { actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null };
  res.status(200).json(await removeOthersPhoto(req.params.employeeId as string, (req.body as { reason: string }).reason, req.user!, meta));
});

const meta = (req: Request) => ({ actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null });
const self = (req: Request) => ({ userId: req.user!.userId, employeeId: req.user!.employeeId });
avatarsRouter.get("/catalogue", (_req: Request, res: Response) => {
  res.status(200).json(catalogueView());
});
avatarsRouter.get("/map", async (_req: Request, res: Response) => {
  res.status(200).json(await avatarMap());
});
avatarsRouter.get("/me", async (req: Request, res: Response) => {
  res.status(200).json(await currentFor(req.user!.employeeId));
});
avatarsRouter.put("/me", validate({ body: chooseSchema }), async (req: Request, res: Response) => {
  res.status(200).json(await chooseOwn(self(req), req.body, meta(req)));
});
avatarsRouter.post("/me/surprise", validate({ body: surpriseSchema }), async (req: Request, res: Response) => {
  res.status(200).json(await surprise(self(req), (req.body as { idempotencyKey: string }).idempotencyKey, meta(req)));
});

// My profile (D-35): self only.
export const profileRouter = Router();
profileRouter.use(authenticate, requireAuth);
profileRouter.get("/me", async (req: Request, res: Response) => {
  res.status(200).json(await myProfile({ ...(await actorFor(req)), dataScope: req.user!.dataScope, permissions: req.user!.permissions }));
});
