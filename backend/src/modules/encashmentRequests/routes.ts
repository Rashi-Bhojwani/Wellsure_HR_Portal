import { Router, type Request } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { refuseDeveloper } from "../../middleware/refuseDeveloper";
import { validate } from "../../middleware/validate";
import * as enc from "./service";

// M session block 2, LV-23. Asking: self. Deciding: directors only (checked in the service), never their own; the Developer role refused.
export const encashmentRequestsRouter = Router();
encashmentRequestsRouter.use(authenticate, refuseDeveloper);
const meta = (req: Request) => ({ actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null });
const idParams = z.object({ id: z.string().min(1).max(64) }).strict();

encashmentRequestsRouter.get("/mine", async (req, res) => void res.json(await enc.mine(req.user!.employeeId)));
encashmentRequestsRouter.post("/mine", validate({ body: enc.askBody }), async (req, res) => void res.status(201).json(await enc.ask(req.user!.employeeId, req.body, meta(req))));
encashmentRequestsRouter.post("/mine/:id/withdraw", validate({ params: idParams }), async (req, res) => void res.json(await enc.withdraw(req.params.id as string, req.user!.employeeId, meta(req))));
encashmentRequestsRouter.get("/", validate({ query: enc.listQuery }), async (req, res) => void res.json({ requests: await enc.list(req.user!.userId, req.user!.employeeId, (req.query as { status?: "PENDING" }).status ?? "PENDING") }));
encashmentRequestsRouter.post("/:id/approve", validate({ params: idParams, body: z.object({}).strict() }), async (req, res) => void res.json(await enc.decide(req.params.id as string, true, null, req.user!.userId, req.user!.employeeId, meta(req))));
encashmentRequestsRouter.post("/:id/reject", validate({ params: idParams, body: enc.rejectBody }), async (req, res) => void res.json(await enc.decide(req.params.id as string, false, req.body.note, req.user!.userId, req.user!.employeeId, meta(req))));
