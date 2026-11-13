import { Router, type Request } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { refuseDeveloper } from "../../middleware/refuseDeveloper";
import { requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import * as acks from "./acknowledgements";

// M session block 2, ER-18: policy acknowledgement. One's own list and acknowledgement are self-serve (audience checked in the service); setting the
// requirement and reading who acknowledged need documents.manage (never manager-grantable), data scope applied, the Developer role refused.
export const documentAcksRouter = Router();
documentAcksRouter.use(authenticate);
const meta = (req: Request) => ({ actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null });
const viewer = (req: Request) => ({ userId: req.user!.userId, employeeId: req.user!.employeeId, dataScope: req.user!.dataScope });
const idParams = z.object({ id: z.string().min(1).max(64) }).strict();
const manage = [requirePermission("documents.manage"), refuseDeveloper];

documentAcksRouter.get("/mine", async (req, res) => void res.json({ documents: await acks.mine(req.user!.employeeId) }));
documentAcksRouter.post("/:id/acknowledge", validate({ params: idParams }), async (req, res) => void res.json(await acks.acknowledge(req.params.id as string, viewer(req), meta(req))));
documentAcksRouter.get("/required", ...manage, async (_req, res) => void res.json({ documentIds: await acks.requiredSet() }));
documentAcksRouter.put("/:id/required", ...manage, validate({ params: idParams, body: z.object({ required: z.boolean() }).strict() }), async (req, res) => void res.json(await acks.setRequired(req.params.id as string, req.body.required, meta(req))));
documentAcksRouter.get("/:id/status", ...manage, validate({ params: idParams }), async (req, res) => void res.json(await acks.status(req.params.id as string, viewer(req))));
