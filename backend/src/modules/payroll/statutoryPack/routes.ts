import { Router, type Request, type Response } from "express";
import { authenticate } from "../../../middleware/authenticate";
import { refuseDeveloper } from "../../../middleware/refuseDeveloper";
import { requirePermission } from "../../../middleware/rbac";
import * as pack from "./service";

// The Standard statutory defaults pack (docs/plans/STATUTORY_DEFAULTS_PLAN.md). Directors only: payroll.rules.view (HR, managers and employees do not hold it) and a
// director check in the service; the Developer role is refused outright. The acknowledgement and a review take no data, only the click, and are audited.
export const statutoryPackRouter = Router();
statutoryPackRouter.use(authenticate, refuseDeveloper, requirePermission("payroll.rules.view"));
const actor = (req: Request) => ({ userId: req.user!.userId, ip: req.ip ?? null });
const send = (res: Response, status: number, body: unknown): void => void res.status(status).json(body);

statutoryPackRouter.get("/", async (req, res) => send(res, 200, await pack.packStatus(actor(req))));
statutoryPackRouter.post("/acknowledge", async (req, res) => send(res, 201, await pack.acknowledge(actor(req))));
statutoryPackRouter.post("/review", async (req, res) => send(res, 201, await pack.markReviewed(actor(req))));
