import { Router, type Request } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { refuseDeveloper } from "../../middleware/refuseDeveloper";
import { requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import * as divisions from "./service";

// M session block 2, ER-27. The list is a catalogue like the other org masters (every signed-in person, for filters and the profile); changes need
// org.manage, and the Developer role is refused them.
export const divisionsRouter = Router();
divisionsRouter.use(authenticate);
const meta = (req: Request) => ({ actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null });
const idParams = z.object({ id: z.string().min(1).max(64) }).strict();
const manage = [requirePermission("org.manage"), refuseDeveloper];

divisionsRouter.get("/", async (_req, res) => void res.json({ divisions: await divisions.list() }));
divisionsRouter.post("/", ...manage, validate({ body: divisions.divisionBody }), async (req, res) => void res.status(201).json(await divisions.create(req.body, meta(req))));
divisionsRouter.patch("/:id", ...manage, validate({ params: idParams, body: divisions.divisionBody }), async (req, res) => void res.json(await divisions.update(req.params.id as string, req.body, meta(req))));
divisionsRouter.delete("/:id", ...manage, validate({ params: idParams }), async (req, res) => {
  await divisions.remove(req.params.id as string, meta(req));
  res.status(204).send();
});
divisionsRouter.put("/:id/departments", ...manage, validate({ params: idParams, body: divisions.departmentsBody }), async (req, res) => void res.json(await divisions.setDepartments(req.params.id as string, req.body.departmentIds, meta(req))));
