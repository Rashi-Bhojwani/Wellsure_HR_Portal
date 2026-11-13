import { Router, type Request } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { refuseDeveloper } from "../../middleware/refuseDeveloper";
import { requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import * as probation from "./service";

// M session block 2, ER-26: HR (employee.edit, never manager-grantable), the data scope applied in the service, the Developer role refused; one's
// own probation is self-serve.
export const probationRouter = Router();
probationRouter.use(authenticate);
const meta = (req: Request) => ({ actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null });
const viewer = (req: Request) => ({ userId: req.user!.userId, employeeId: req.user!.employeeId, dataScope: req.user!.dataScope });
const params = z.object({ employeeId: z.string().min(1).max(64) }).strict();
const hr = [requirePermission("employee.edit"), refuseDeveloper];

probationRouter.get("/mine", async (req, res) => void res.json(await probation.mine(req.user!.employeeId)));
probationRouter.get("/", ...hr, validate({ query: probation.listQuery }), async (req, res) => void res.json(await probation.list(viewer(req), (req.query as { show?: "due" | "all" }).show ?? "due")));
probationRouter.post("/:employeeId/confirm", ...hr, validate({ params, body: probation.confirmBody }), async (req, res) => void res.json(await probation.confirm(req.params.employeeId as string, req.body.reason, viewer(req), meta(req))));
probationRouter.post("/:employeeId/extend", ...hr, validate({ params, body: probation.extendBody }), async (req, res) => void res.json(await probation.extend(req.params.employeeId as string, req.body.until, req.body.reason, viewer(req), meta(req))));
