import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { validate } from "../../middleware/validate";
import { HttpError } from "../../middleware/errorHandler";
import { memoryUpload } from "../../lib/uploads";
import * as autofill from "./service";
import { enqueueExtraction } from "./queue";

// Document autofill routes. Sign-in, Zod validation and per-field authority in the service (recruiters: resume fields; bank and
// statutory fields need their own permissions; the Developer is refused). Every document is scoped to a subject the viewer may see.
export const autofillRouter = Router();
autofillRouter.use(authenticate, (req, _res, next) => (req.user!.roleCodes.includes("DEVELOPER") ? next(new HttpError(403, "This is unavailable to Developer.", "FORBIDDEN")) : next()));
const empty = z.object({}).strict();
const idSchema = z.object({ id: z.string().min(1).max(100) }).strict();
const id = (p: unknown) => (p as { id: string }).id;
const metaOf = (req: { user?: { userId: string }; ip?: string; headers: Record<string, unknown> }) => ({ actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: (req.headers["user-agent"] as string | undefined) ?? null });
/** Replaced in tests to run the extraction inline; in the API it puts the id on the queue the worker reads. */
export const queueHooks = { enqueue: enqueueExtraction };

autofillRouter.get("/status", validate({ query: empty }), async (req, res) => { res.json(await autofill.status(req.user!)); });
autofillRouter.get("/settings", validate({ query: empty }), async (req, res) => { res.json(await autofill.viewSettings(req.user!)); });
autofillRouter.put("/settings/:key", validate({ params: z.object({ key: autofill.keySchema }).strict(), body: autofill.settingInput }), async (req, res) => { res.json(await autofill.setSetting(req.params.key as autofill.SettingKey, req.body, req.user!, metaOf(req))); });
autofillRouter.get("/documents", validate({ query: autofill.listInput }), async (req, res) => { res.json(await autofill.listDocuments(req.user!, req.query as never)); });
autofillRouter.post("/documents", memoryUpload(25), validate({ body: autofill.uploadFields }), async (req, res) => { res.status(201).json(await autofill.upload(req.user!, req.body, req.file, metaOf(req), (x) => queueHooks.enqueue(x))); });
autofillRouter.get("/documents/:id", validate({ params: idSchema, query: empty }), async (req, res) => { res.setHeader("Cache-Control", "no-store"); res.json(await autofill.getDocument(id(req.params), req.user!)); });
autofillRouter.get("/documents/:id/file", validate({ params: idSchema, query: empty }), async (req, res) => {
  const o = await autofill.file(id(req.params), req.user!, metaOf(req));
  res.setHeader("Content-Type", o.contentType);
  res.setHeader("Content-Disposition", 'inline; filename="source-document"');
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  res.send(o.body);
});
autofillRouter.post("/documents/:id/extract", validate({ params: idSchema, body: autofill.rerunInput }), async (req, res) => { res.json(await autofill.rerun(id(req.params), req.user!, req.body, metaOf(req), (x) => queueHooks.enqueue(x))); });
autofillRouter.post("/documents/:id/fields/:field/review", validate({ params: z.object({ id: z.string().min(1).max(100), field: z.string().regex(/^[a-zA-Z]{1,40}$/) }).strict(), body: autofill.reviewInput }), async (req, res) => { res.setHeader("Cache-Control", "no-store"); res.json(await autofill.review(String(req.params.id), String(req.params.field), req.user!, req.body, metaOf(req))); });
autofillRouter.post("/documents/:id/apply", validate({ params: idSchema, body: autofill.applyInput }), async (req, res) => { res.json(await autofill.apply(id(req.params), req.user!, req.body, metaOf(req))); });
