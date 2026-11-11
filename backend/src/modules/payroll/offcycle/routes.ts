import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authenticate } from "../../../middleware/authenticate";
import { refuseDeveloper } from "../../../middleware/refuseDeveloper";
import { requirePermission } from "../../../middleware/rbac";
import { validate } from "../../../middleware/validate";
import { markSentToBank } from "../run/sentMarks";
import * as offCycle from "./service";

// P7-6b (docs/plans/P7_6_SETTLEMENTS.md): off-cycle runs. Directors only (a pay key AND a director in the service); the Developer role refused outright.
export const offCycleRouter = Router();
offCycleRouter.use(authenticate, refuseDeveloper, requirePermission("payroll.salary.view"));
const actor = (req: Request) => ({ userId: req.user!.userId, ip: req.ip ?? null });
const send = (res: Response, status: number, body: unknown): void => void res.status(status).json(body);
const idParams = z.object({ id: z.string().min(1).max(64) }).strict();

offCycleRouter.get("/", async (req, res) => send(res, 200, await offCycle.list(actor(req))));
offCycleRouter.get("/candidates", async (req, res) => send(res, 200, await offCycle.candidates(actor(req))));
offCycleRouter.post("/", async (req, res) => send(res, 201, await offCycle.prepare(req.body, actor(req))));
offCycleRouter.post("/:id/approval", validate({ params: idParams }), async (req, res) => send(res, 200, await offCycle.requestApproval(req.params.id as string, req.body, actor(req))));
offCycleRouter.post("/:id/decision", validate({ params: idParams }), async (req, res) => send(res, 200, await offCycle.decideApproval(req.params.id as string, req.body, actor(req))));
offCycleRouter.post("/:id/finalise", validate({ params: idParams }), async (req, res) => send(res, 200, await offCycle.finalise(req.params.id as string, actor(req))));
offCycleRouter.post("/:id/bank/approval", validate({ params: idParams }), async (req, res) => send(res, 200, await offCycle.requestBank(req.params.id as string, req.body, actor(req))));
offCycleRouter.post("/:id/bank/decision", validate({ params: idParams }), async (req, res) => send(res, 200, await offCycle.decideBank(req.params.id as string, req.body, actor(req))));
offCycleRouter.post("/:id/bank/file", validate({ params: idParams }), async (req, res) => send(res, 201, await offCycle.generateBank(req.params.id as string, actor(req))));
offCycleRouter.get("/bank/:id/download", validate({ params: idParams }), async (req, res) => send(res, 200, await offCycle.downloadBank(req.params.id as string, actor(req))));
offCycleRouter.post("/bank/:id/sent", validate({ params: idParams }), async (req, res) => send(res, 200, await markSentToBank("offcycle", req.params.id as string, req.body, actor(req))));
