import { Router, type Request } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { refuseDeveloper } from "../../middleware/refuseDeveloper";
import { requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import * as retention from "./service";

// M session block 2, AD-07: directors only (settings.manage, which HR never holds, AND a director check in the service); the Developer refused.
export const retentionRouter = Router();
retentionRouter.use(authenticate, refuseDeveloper, requirePermission("settings.manage"));
const meta = (req: Request) => ({ actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null });
const idParams = z.object({ id: z.string().min(1).max(64) }).strict();

retentionRouter.get("/due", async (req, res) => void res.json(await retention.due(req.user!.userId)));
retentionRouter.post("/erasures", validate({ body: retention.proposeBody }), async (req, res) => void res.status(201).json(await retention.propose(req.body, meta(req))));
retentionRouter.post("/erasures/:id/confirm", validate({ params: idParams }), async (req, res) => void res.json(await retention.confirm(req.params.id as string, meta(req))));
