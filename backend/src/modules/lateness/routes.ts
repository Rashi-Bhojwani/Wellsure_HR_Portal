import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { refuseDeveloper } from "../../middleware/refuseDeveloper";
import { validate } from "../../middleware/validate";
import * as penalties from "./penalties";
import * as service from "./service";
import * as settings from "./settings";

// Lateness rule (docs/plans/LATE_CHECKLIST.md §6). The Developer role is refused on every route. Own view: self. Team view and asking for a waiver: the person's
// reporting manager (checked in the service). Waiver decisions: HR with Manual Override, never the requester or the employee (service and database).
// Settings and penalties: directors only (service), never their own pay.
export const latenessRouter = Router();
latenessRouter.use(authenticate, refuseDeveloper);
const actor = (req: Request) => ({ userId: req.user!.userId, employeeId: req.user!.employeeId, ip: req.ip ?? null });
const send = (res: Response, status: number, body: unknown): void => void res.status(status).json(body);
const idParams = z.object({ id: z.string().min(1).max(64) }).strict();
const keyParams = z.object({ key: z.string().regex(/^late\.[A-Za-z]{1,30}$/) }).strict();
const monthQuery = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).strict();

latenessRouter.get("/mine", validate({ query: service.monthParam }), async (req, res) => send(res, 200, await service.mine(actor(req), (req.query as { month?: string }).month)));
latenessRouter.get("/team", validate({ query: service.monthParam }), async (req, res) => send(res, 200, await service.team(actor(req), (req.query as { month?: string }).month)));
latenessRouter.post("/waivers", validate({ body: service.waiverBody }), async (req, res) => send(res, 201, await service.requestWaiver(actor(req), req.body)));
latenessRouter.post("/waivers/:id/withdraw", validate({ params: idParams }), async (req, res) => send(res, 200, await service.withdrawWaiver(actor(req), req.params.id as string)));
latenessRouter.get("/waivers", validate({ query: service.listQuery }), async (req, res) => send(res, 200, { waivers: await service.listWaivers(actor(req), ((req.query as { status?: "PENDING" }).status ?? "PENDING")) }));
latenessRouter.post("/waivers/:id/approve", validate({ params: idParams }), async (req, res) => send(res, 200, await service.approveWaiver(actor(req), req.params.id as string)));
latenessRouter.post("/waivers/:id/reject", validate({ params: idParams, body: service.rejectBody }), async (req, res) => send(res, 200, await service.rejectWaiver(actor(req), req.params.id as string, req.body.note)));
// FIX-M8 (independent audit 2026-11-20): a director confirms or turns down a waiver HR approved (checked in the service).
latenessRouter.post("/waivers/:id/confirm", validate({ params: idParams }), async (req, res) => send(res, 200, await service.confirmWaiver(actor(req), req.params.id as string, true, null)));
latenessRouter.post("/waivers/:id/director-reject", validate({ params: idParams, body: service.rejectBody }), async (req, res) => send(res, 200, await service.confirmWaiver(actor(req), req.params.id as string, false, req.body.note)));
latenessRouter.get("/settings", async (req, res) => send(res, 200, await settings.list(actor(req))));
latenessRouter.post("/settings/:key/proposals", validate({ params: keyParams, body: settings.proposeBody }), async (req, res) => send(res, 201, await settings.propose(req.params.key as string, req.body, actor(req))));
latenessRouter.post("/settings/proposals/:id/confirm", validate({ params: idParams }), async (req, res) => send(res, 200, await settings.confirm(req.params.id as string, actor(req))));
latenessRouter.get("/penalties", validate({ query: monthQuery }), async (req, res) => send(res, 200, await penalties.penaltyPlan(req.user!.userId, (req.query as { month: string }).month)));
latenessRouter.post("/penalties/post", validate({ body: penalties.postBody }), async (req, res) => send(res, 200, await penalties.postPenalties(actor(req), req.body)));
