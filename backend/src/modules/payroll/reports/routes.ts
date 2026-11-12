import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authenticate } from "../../../middleware/authenticate";
import { refuseDeveloper } from "../../../middleware/refuseDeveloper";
import { requirePermission } from "../../../middleware/rbac";
import { validate } from "../../../middleware/validate";
import * as reports from "./service";

// Stage 6 (docs/plans/STAGE_6_PAYROLL_REPORTS.md): directors only (payroll.salary.view, which HR never holds, AND a director check in the service); the Developer
// role refused outright.
export const payrollReportsRouter = Router();
payrollReportsRouter.use(authenticate, refuseDeveloper, requirePermission("payroll.salary.view"));
const actor = (req: Request) => ({ userId: req.user!.userId, ip: req.ip ?? null });
const send = (res: Response, status: number, body: unknown): void => void res.status(status).json(body);
const keyParams = z.object({ key: z.string().min(1).max(40) }).strict();

payrollReportsRouter.get("/", async (req, res) => send(res, 200, await reports.catalog(actor(req))));
payrollReportsRouter.get("/:key", validate({ params: keyParams }), async (req, res) => send(res, 200, await reports.run(req.params.key as string, req.query, actor(req))));
payrollReportsRouter.put("/:key/layout", validate({ params: keyParams }), async (req, res) => send(res, 200, await reports.saveLayout(req.params.key as string, req.body, actor(req))));
payrollReportsRouter.get("/:key/export", validate({ params: keyParams }), async (req, res) => {
  const file = await reports.exportReport(req.params.key as string, req.query as Record<string, unknown>, actor(req));
  res.setHeader("Content-Type", file.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`);
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send(file.buffer);
});
