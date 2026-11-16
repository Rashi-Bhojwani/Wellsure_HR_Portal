import { Router, type Request } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { refuseDeveloper } from "../../middleware/refuseDeveloper";
import { requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import { findScopedEmployee } from "../employee/service";
import * as le from "./service";

// M session block 2, AD-08. The list and an employee's company: employee.view (and the data scope for one person); changes: directors only
// (settings.manage and a director check in the service). The Developer role refused.
export const legalEntitiesRouter = Router();
legalEntitiesRouter.use(authenticate, refuseDeveloper);
const meta = (req: Request) => ({ actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null });
const idParams = z.object({ id: z.string().min(1).max(64) }).strict();
const empParams = z.object({ employeeId: z.string().min(1).max(64) }).strict();
const director = requirePermission("settings.manage");

legalEntitiesRouter.get("/", requirePermission("employee.view"), async (_req, res) => void res.json(await le.list()));
legalEntitiesRouter.get("/employees/:employeeId", requirePermission("employee.view"), validate({ params: empParams }), async (req, res) => {
  await findScopedEmployee(req.params.employeeId as string, req.user!.employeeId, req.user!.dataScope);
  res.json(await le.ofEmployee(req.params.employeeId as string));
});
legalEntitiesRouter.post("/", director, validate({ body: le.entityBody }), async (req, res) => void res.status(201).json(await le.create(req.body, meta(req))));
legalEntitiesRouter.patch("/:id", director, validate({ params: idParams, body: le.entityBody }), async (req, res) => void res.json(await le.update(req.params.id as string, req.body, meta(req))));
legalEntitiesRouter.put("/assignments", director, validate({ body: le.assignBody }), async (req, res) => void res.json(await le.assign(req.body, meta(req))));
