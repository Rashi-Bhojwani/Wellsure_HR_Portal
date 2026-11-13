import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { refuseDeveloper } from "../../middleware/refuseDeveloper";
import { requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import * as policies from "./service";

// M session, block 2: directors only (settings.manage, which HR never holds, AND a director check in the service); the Developer role refused.
export const policySettingsRouter = Router();
policySettingsRouter.use(authenticate, refuseDeveloper, requirePermission("settings.manage"));
const actor = (req: Request) => ({ userId: req.user!.userId, ip: req.ip ?? null });
const send = (res: Response, status: number, body: unknown): void => void res.status(status).json(body);
const keyParams = z.object({ key: z.string().regex(/^policy\.[A-Za-z]{1,40}$/) }).strict();
const idParams = z.object({ id: z.string().min(1).max(64) }).strict();

policySettingsRouter.get("/", async (req, res) => send(res, 200, await policies.list(actor(req))));
policySettingsRouter.post("/:key/proposals", validate({ params: keyParams, body: policies.proposeSchema }), async (req, res) => send(res, 201, await policies.propose(req.params.key as string, req.body, actor(req))));
policySettingsRouter.post("/proposals/:id/confirm", validate({ params: idParams }), async (req, res) => send(res, 200, await policies.confirm(req.params.id as string, actor(req))));
