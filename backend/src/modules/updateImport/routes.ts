import { Router, type Request } from "express";
import { z } from "zod";
import { memoryUpload, requireFile } from "../../lib/uploads";
import { authenticate } from "../../middleware/authenticate";
import { refuseDeveloper } from "../../middleware/refuseDeveloper";
import { requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import * as ui from "./service";

// M session block 2, IE-07 / IE-08: employee.edit (never manager-grantable), data scope in the service, the Developer role refused.
export const updateImportRouter = Router();
updateImportRouter.use(authenticate, requirePermission("employee.edit"), refuseDeveloper);
const meta = (req: Request) => ({ actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null });
const viewer = (req: Request) => ({ userId: req.user!.userId, employeeId: req.user!.employeeId, dataScope: req.user!.dataScope });
const idParams = z.object({ id: z.string().min(1).max(64) }).strict();

updateImportRouter.get("/template", async (_req, res) => {
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="update-employees.xlsx"');
  res.send(await ui.template());
});
updateImportRouter.post("/preview", memoryUpload(5), async (req, res) => {
  const file = requireFile(req.file);
  res.status(201).json(await ui.preview(file.buffer, file.originalname.slice(0, 200), viewer(req), meta(req)));
});
updateImportRouter.get("/waiting", async (req, res) => void res.json({ batches: await ui.waitingForDirector(viewer(req)) }));
updateImportRouter.get("/:id", validate({ params: idParams }), async (req, res) => void res.json(await ui.get(req.params.id as string, viewer(req))));
updateImportRouter.post("/:id/apply", validate({ params: idParams }), async (req, res) => void res.json(await ui.apply(req.params.id as string, viewer(req), meta(req))));
