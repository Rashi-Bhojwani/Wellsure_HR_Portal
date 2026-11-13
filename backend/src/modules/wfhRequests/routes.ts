import { Router, type Request } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { refuseDeveloper } from "../../middleware/refuseDeveloper";
import { validate } from "../../middleware/validate";
import * as wfh from "./service";

// M session block 2, AT-36. Asking: self. Deciding: directors only (checked in the service), never their own; the Developer role refused.
export const wfhRequestsRouter = Router();
wfhRequestsRouter.use(authenticate, refuseDeveloper);
const meta = (req: Request) => ({ actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null });
const idParams = z.object({ id: z.string().min(1).max(64) }).strict();

wfhRequestsRouter.get("/mine", async (req, res) => void res.json(await wfh.mine(req.user!.employeeId)));
wfhRequestsRouter.post("/mine", validate({ body: wfh.askBody }), async (req, res) => void res.status(201).json(await wfh.ask(req.user!.employeeId, req.body, meta(req))));
wfhRequestsRouter.post("/mine/:id/withdraw", validate({ params: idParams }), async (req, res) => void res.json(await wfh.withdraw(req.params.id as string, req.user!.employeeId, meta(req))));
wfhRequestsRouter.get("/", validate({ query: wfh.listQuery }), async (req, res) => void res.json({ requests: await wfh.list(req.user!.userId, req.user!.employeeId, (req.query as { status?: "PENDING" }).status ?? "PENDING") }));
wfhRequestsRouter.post("/:id/approve", validate({ params: idParams }), async (req, res) => void res.json(await wfh.approve(req.params.id as string, req.user!.userId, req.user!.employeeId, meta(req))));
wfhRequestsRouter.post("/:id/reject", validate({ params: idParams, body: wfh.rejectBody }), async (req, res) => void res.json(await wfh.reject(req.params.id as string, req.body.note, req.user!.userId, req.user!.employeeId, meta(req))));
