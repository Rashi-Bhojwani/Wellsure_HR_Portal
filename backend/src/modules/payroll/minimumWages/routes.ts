import { Router, type Request, type Response } from "express";
import { authenticate } from "../../../middleware/authenticate";
import { refuseDeveloper } from "../../../middleware/refuseDeveloper";
import { requirePermission } from "../../../middleware/rbac";
import { validate } from "../../../middleware/validate";
import * as mw from "./service";

// ST-29: directors only (payroll.salary.view at the router AND a director check in the service); the Developer refused.
export const minimumWagesRouter = Router();
minimumWagesRouter.use(authenticate, refuseDeveloper, requirePermission("payroll.salary.view"));
const actor = (req: Request) => ({ userId: req.user!.userId, ip: req.ip ?? null });
const send = (res: Response, status: number, body: unknown): void => void res.status(status).json(body);

minimumWagesRouter.get("/", async (req, res) => send(res, 200, await mw.setup(actor(req))));
minimumWagesRouter.post("/rates", async (req, res) => send(res, 201, await mw.addRate(req.body, actor(req))));
minimumWagesRouter.post("/categories", async (req, res) => send(res, 201, await mw.setCategory(req.body, actor(req))));
minimumWagesRouter.post("/basis", async (req, res) => send(res, 201, await mw.setBasis(req.body, actor(req))));
minimumWagesRouter.get("/check", validate({ query: mw.checkQuery }), async (req, res) => send(res, 200, await mw.check(req.query, actor(req))));
