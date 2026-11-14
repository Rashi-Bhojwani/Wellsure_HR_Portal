import { Router, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { authenticate } from "../../../middleware/authenticate";
import { refuseDeveloper } from "../../../middleware/refuseDeveloper";
import { requirePermission } from "../../../middleware/rbac";
import { validate } from "../../../middleware/validate";
import { HttpError } from "../../../middleware/errorHandler";
import { BANK_FILE_MAX_BYTES, checkBankFile } from "./bankCheck";
import * as kit from "./parallel";
import { STATEMENT_MAX_BYTES } from "./statement";

// Stage 8 (docs/plans/STAGE_8_PLAN.md): greytHR's salary statement (the parallel-run kit) and bank transfer file. Directors only: payroll.salary.view (HR never
// holds it) AND a director check in every service function; the Developer role refused outright. Uploads stay in memory and are dropped after the request.
export const payrollGreythrRouter = Router();
payrollGreythrRouter.use(authenticate, refuseDeveloper, requirePermission("payroll.salary.view"));
const actor = (req: Request) => ({ userId: req.user!.userId, ip: req.ip ?? null });
const send = (res: Response, status: number, body: unknown): void => void res.status(status).json(body);
const upload = (max: number) => multer({ storage: multer.memoryStorage(), limits: { fileSize: max, files: 1 } }).single("file");
const fileOf = (req: Request) => {
  if (!req.file) throw new HttpError(400, "Attach the file.", "VALIDATION_ERROR");
  return req.file;
};
const idParams = z.object({ id: z.string().min(1).max(40) }).strict();
const exportQuery = z.object({ format: z.enum(["xlsx", "csv"]) }).strict();

payrollGreythrRouter.post("/bank-check", upload(BANK_FILE_MAX_BYTES), async (req, res) => send(res, 200, await checkBankFile(fileOf(req), actor(req))));
payrollGreythrRouter.get("/parallel/runs", async (req, res) => send(res, 200, await kit.comparableRuns(actor(req))));
payrollGreythrRouter.get("/parallel", async (req, res) => send(res, 200, await kit.listComparisons(actor(req))));
payrollGreythrRouter.post("/parallel", upload(STATEMENT_MAX_BYTES), async (req, res) => send(res, 201, await kit.compareUpload(fileOf(req), req.body, actor(req))));
payrollGreythrRouter.get("/parallel/:id", validate({ params: idParams }), async (req, res) => send(res, 200, await kit.getComparison(req.params.id as string, actor(req))));
payrollGreythrRouter.post("/parallel/:id/recompare", validate({ params: idParams, body: kit.recompareSchema }), async (req, res) => send(res, 200, await kit.recompare(req.params.id as string, req.body, actor(req))));
payrollGreythrRouter.delete("/parallel/:id", validate({ params: idParams }), async (req, res) => {
  await kit.deleteComparison(req.params.id as string, actor(req));
  res.status(204).end();
});
payrollGreythrRouter.get("/parallel/:id/export", validate({ params: idParams, query: exportQuery }), async (req, res) => {
  const file = await kit.exportComparison(req.params.id as string, req.query.format as "xlsx" | "csv", actor(req));
  res.setHeader("Content-Type", file.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`);
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send(file.buffer);
});
