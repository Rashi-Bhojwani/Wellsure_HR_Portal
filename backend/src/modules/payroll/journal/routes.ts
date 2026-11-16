import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authenticate } from "../../../middleware/authenticate";
import { refuseDeveloper } from "../../../middleware/refuseDeveloper";
import { requirePermission } from "../../../middleware/rbac";
import { validate } from "../../../middleware/validate";
import * as j from "./service";

// PY-41: directors only (payroll.salary.view at the router AND a director check in the service); the Developer refused.
export const journalRouter = Router();
journalRouter.use(authenticate, refuseDeveloper, requirePermission("payroll.salary.view"));
const actor = (req: Request) => ({ userId: req.user!.userId, ip: req.ip ?? null });
const runParams = z.object({ runId: z.string().min(1).max(64) }).strict();

journalRouter.put("/mappings", async (req, res) => void res.status(200).json(await j.setMappings(req.body, actor(req))));
journalRouter.get("/runs/:runId", validate({ params: runParams }), async (req, res) => void res.status(200).json(await j.journal(req.params.runId as string, actor(req))));
journalRouter.get("/runs/:runId/export", validate({ params: runParams, query: j.exportQuery }), async (req: Request, res: Response) => {
  const file = await j.exportJournal(req.params.runId as string, req.query, actor(req));
  res.setHeader("Content-Type", file.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`);
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send(file.buffer);
});
