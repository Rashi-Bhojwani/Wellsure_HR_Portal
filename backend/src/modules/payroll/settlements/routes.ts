import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authenticate } from "../../../middleware/authenticate";
import { refuseDeveloper } from "../../../middleware/refuseDeveloper";
import { requirePermission } from "../../../middleware/rbac";
import { validate } from "../../../middleware/validate";
import * as fnf from "./service";

// P7-6 (docs/plans/P7_6_SETTLEMENTS.md): directors only (a pay key AND a director in the service); the Developer role refused outright.
export const settlementsRouter = Router();
settlementsRouter.use(authenticate, refuseDeveloper, requirePermission("payroll.salary.view"));
const actor = (req: Request) => ({ userId: req.user!.userId, ip: req.ip ?? null });
const send = (res: Response, status: number, body: unknown): void => void res.status(status).json(body);
const idParams = z.object({ id: z.string().min(1).max(64) }).strict();

settlementsRouter.get("/", async (req, res) => send(res, 200, await fnf.list(actor(req))));
settlementsRouter.post("/", async (req, res) => send(res, 201, await fnf.prepare(req.body, actor(req))));
settlementsRouter.post("/:id/confirm", validate({ params: idParams }), async (req, res) => send(res, 200, await fnf.requestConfirmation(req.params.id as string, req.body, actor(req))));
settlementsRouter.post("/:id/decision", validate({ params: idParams }), async (req, res) => send(res, 200, await fnf.decideConfirmation(req.params.id as string, req.body, actor(req))));
