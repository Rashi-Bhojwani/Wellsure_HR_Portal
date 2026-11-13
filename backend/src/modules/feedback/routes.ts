import { Router, type Request } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { refuseDeveloper } from "../../middleware/refuseDeveloper";
import { requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import * as feedback from "./service";

// M session block 2, SS-13. Sending and one's own named feedback: self. Reading, replying and closing: helpdesk.manage (never manager-grantable),
// data scope in the service for named feedback, the Developer role refused.
export const feedbackRouter = Router();
feedbackRouter.use(authenticate);
const meta = (req: Request) => ({ actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null });
const viewer = (req: Request) => ({ userId: req.user!.userId, employeeId: req.user!.employeeId, dataScope: req.user!.dataScope });
const idParams = z.object({ id: z.string().min(1).max(64) }).strict();
const hr = [requirePermission("helpdesk.manage"), refuseDeveloper];

feedbackRouter.get("/options", async (_req, res) => void res.json(await feedback.options()));
feedbackRouter.post("/", validate({ body: feedback.sendBody }), async (req, res) => void res.status(201).json(await feedback.send(req.user!.employeeId, req.body, meta(req))));
feedbackRouter.get("/mine", async (req, res) => void res.json({ feedback: await feedback.mine(req.user!.employeeId) }));
feedbackRouter.get("/", ...hr, validate({ query: feedback.listQuery }), async (req, res) => void res.json({ feedback: await feedback.list(viewer(req), (req.query as { status?: "OPEN" | "CLOSED" }).status ?? "OPEN") }));
feedbackRouter.post("/:id/replies", ...hr, validate({ params: idParams, body: feedback.replyBody }), async (req, res) => void res.status(201).json(await feedback.reply(req.params.id as string, req.body.message, viewer(req), meta(req))));
feedbackRouter.post("/:id/close", ...hr, validate({ params: idParams }), async (req, res) => void res.json(await feedback.close(req.params.id as string, viewer(req), meta(req))));
