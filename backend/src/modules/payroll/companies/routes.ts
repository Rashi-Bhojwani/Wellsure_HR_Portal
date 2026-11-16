import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authenticate } from "../../../middleware/authenticate";
import { refuseDeveloper } from "../../../middleware/refuseDeveloper";
import { requirePermission } from "../../../middleware/rbac";
import { validate } from "../../../middleware/validate";
import * as cs from "./service";

// Part 3 B2a: directors only (payroll.salary.view at the router AND a director check in the service); the Developer refused.
export const companySettingsRouter = Router();
companySettingsRouter.use(authenticate, refuseDeveloper, requirePermission("payroll.salary.view"));
const actor = (req: Request) => ({ userId: req.user!.userId, ip: req.ip ?? null });
const send = (res: Response, status: number, body: unknown): void => void res.status(status).json(body);

companySettingsRouter.get("/", async (req, res) => send(res, 200, await cs.list(actor(req))));
companySettingsRouter.post("/", async (req, res) => send(res, 201, await cs.enter(req.body, actor(req))));
companySettingsRouter.post("/:id/confirm", validate({ params: z.object({ id: z.string().min(1).max(64) }).strict() }), async (req, res) => send(res, 200, await cs.confirm(req.params.id as string, actor(req))));
