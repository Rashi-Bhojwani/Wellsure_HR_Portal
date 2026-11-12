import { Router, type Request } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { refuseDeveloper } from "../../middleware/refuseDeveloper";
import { requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import * as cf from "./service";

// M session block 2, ER-28. Definitions: read by HR (employee.view) for its forms, changed by directors (settings.manage + a director check).
// Values: read with employee.view, written with employee.edit (never manager-grantable), the data scope in the service; the Developer role refused
// everywhere except one's own values.
export const customFieldsRouter = Router();
customFieldsRouter.use(authenticate);
const meta = (req: Request) => ({ actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null });
const viewer = (req: Request) => ({ userId: req.user!.userId, employeeId: req.user!.employeeId, dataScope: req.user!.dataScope });
const idParams = z.object({ id: z.string().min(1).max(64) }).strict();
const empParams = z.object({ employeeId: z.string().min(1).max(64) }).strict();
const revealParams = z.object({ employeeId: z.string().min(1).max(64), fieldId: z.string().min(1).max(64) }).strict();
const defsQuery = z.object({ includeInactive: z.enum(["true", "false"]).optional() }).strict();

customFieldsRouter.get("/mine", async (req, res) => void res.json({ fields: await cf.mine(req.user!.employeeId) }));
customFieldsRouter.get("/definitions", requirePermission("employee.view"), refuseDeveloper, validate({ query: defsQuery }), async (req, res) => void res.json({ fields: await cf.definitions(req.query.includeInactive === "true") }));
customFieldsRouter.post("/definitions", requirePermission("settings.manage"), refuseDeveloper, validate({ body: cf.createBody }), async (req, res) => void res.status(201).json(await cf.createDefinition(req.body, meta(req))));
customFieldsRouter.patch("/definitions/:id", requirePermission("settings.manage"), refuseDeveloper, validate({ params: idParams, body: cf.updateBody }), async (req, res) => void res.json(await cf.updateDefinition(req.params.id as string, req.body, meta(req))));
customFieldsRouter.get("/employees/:employeeId", requirePermission("employee.view"), refuseDeveloper, validate({ params: empParams }), async (req, res) => void res.json({ fields: await cf.valuesOf(req.params.employeeId as string, viewer(req)) }));
customFieldsRouter.put("/employees/:employeeId", requirePermission("employee.edit"), refuseDeveloper, validate({ params: empParams, body: cf.valuesBody }), async (req, res) => void res.json(await cf.setValues(req.params.employeeId as string, req.body.values, viewer(req), meta(req))));
customFieldsRouter.post("/employees/:employeeId/:fieldId/reveal", requirePermission("employee.view"), refuseDeveloper, validate({ params: revealParams }), async (req, res) => void res.json(await cf.reveal(req.params.employeeId as string, req.params.fieldId as string, viewer(req), meta(req))));
