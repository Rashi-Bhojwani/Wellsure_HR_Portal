import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authenticate } from "../../../middleware/authenticate";
import { refuseDeveloper } from "../../../middleware/refuseDeveloper";
import { requirePermission } from "../../../middleware/rbac";
import { validate } from "../../../middleware/validate";
import * as compliance from "./service";

// ST-30: directors only (payroll.salary.view at the router AND a director check in the service); the Developer refused.
export const complianceRouter = Router();
complianceRouter.use(authenticate, refuseDeveloper, requirePermission("payroll.salary.view"));
const actor = (req: Request) => ({ userId: req.user!.userId, ip: req.ip ?? null });
const send = (res: Response, status: number, body: unknown): void => void res.status(status).json(body);
const idParams = z.object({ id: z.string().min(1).max(64) }).strict();

complianceRouter.get("/", async (req, res) => send(res, 200, await compliance.list(actor(req))));
complianceRouter.post("/", async (req, res) => send(res, 201, await compliance.add(req.body, actor(req))));
complianceRouter.post("/:id/retire", validate({ params: idParams }), async (req, res) => send(res, 200, await compliance.retire(req.params.id as string, req.body, actor(req))));
complianceRouter.post("/:id/done", validate({ params: idParams }), async (req, res) => send(res, 200, await compliance.markDone(req.params.id as string, req.body, actor(req))));
