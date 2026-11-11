import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { refuseDeveloper } from "../../middleware/refuseDeveloper";
import { requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import * as behaviours from "./service";

// D-37 (docs/plans/D37_DEFAULTS.md): directors only (settings.manage, which HR never holds, AND a director check in the service); the Developer role refused outright.
export const behavioursRouter = Router();
behavioursRouter.use(authenticate, refuseDeveloper, requirePermission("settings.manage"));
const actor = (req: Request) => ({ userId: req.user!.userId, ip: req.ip ?? null });
const send = (res: Response, status: number, body: unknown): void => void res.status(status).json(body);
const keyParams = z.object({ key: z.string().min(1).max(64) }).strict();
const idParams = z.object({ id: z.string().min(1).max(64) }).strict();

behavioursRouter.get("/", async (req, res) => send(res, 200, await behaviours.list(actor(req))));
behavioursRouter.post("/:key/proposals", validate({ params: keyParams }), async (req, res) => send(res, 201, await behaviours.propose(req.params.key as string, req.body, actor(req))));
behavioursRouter.post("/proposals/:id/confirm", validate({ params: idParams }), async (req, res) => send(res, 200, await behaviours.confirm(req.params.id as string, actor(req))));
