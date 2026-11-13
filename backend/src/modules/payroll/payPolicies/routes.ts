import { Router, type Request, type Response } from "express";
import { authenticate } from "../../../middleware/authenticate";
import { refuseDeveloper } from "../../../middleware/refuseDeveloper";
import { requirePermission } from "../../../middleware/rbac";
import { validate } from "../../../middleware/validate";
import * as pay from "./service";

// Part 3 A2/A3: directors only (payroll.salary.view at the router AND a director check in the service); the Developer refused.
export const payPoliciesRouter = Router();
payPoliciesRouter.use(authenticate, refuseDeveloper, requirePermission("payroll.salary.view"));
const actor = (req: Request) => ({ userId: req.user!.userId, ip: req.ip ?? null });
const send = (res: Response, status: number, body: unknown): void => void res.status(status).json(body);

payPoliciesRouter.get("/overtime", validate({ query: pay.monthQuery }), async (req, res) => send(res, 200, await pay.overtimePreview(req.query, actor(req))));
payPoliciesRouter.post("/overtime/post", async (req, res) => send(res, 200, await pay.overtimePost(req.body, actor(req))));
payPoliciesRouter.get("/encashment", async (req, res) => send(res, 200, await pay.encashmentList(actor(req))));
payPoliciesRouter.post("/encashment/pay", async (req, res) => send(res, 200, await pay.encashmentPay(req.body, actor(req))));
