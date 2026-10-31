import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { MAX_DOCUMENT_UPLOAD_MB_CEILING } from "@shared/constants/peopleDocuments";
import { memoryUpload } from "../../../lib/uploads";
import { authenticate } from "../../../middleware/authenticate";
import { requirePermission } from "../../../middleware/rbac";
import { validate } from "../../../middleware/validate";
import { itemConfirmSchema, itemSavePreviewSchema } from "../salary/validators";
import * as decl from "./declarations";
import { statementFor } from "./statement";
import * as years from "./years";

// Tax: declarations, proofs, the tax years and the IT statement (docs/plans/STAGE_7_PLAN.md). The person's own routes need only a sign-in and are scoped to the signed-in person; every other
// route needs a pay permission AND is refused by the service unless the caller is a director. HR, managers and the Developer role hold neither, so they see nothing here, not even a count.
export const taxRouter = Router();
taxRouter.use(authenticate);

const directors = requirePermission("payroll.salary.view");
const rulesEdit = requirePermission("payroll.rules.manage");
const rulesConfirm = requirePermission("payroll.rules.confirm");
const actor = (req: Request) => ({ userId: req.user!.userId, ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null });
const self = (req: Request) => ({ userId: req.user!.userId, employeeId: req.user!.employeeId, ip: req.ip ?? null });
const idParams = z.object({ id: z.string().min(1).max(64) }).strict();
const yearParams = z.object({ fy: z.string().min(7).max(7) }).strict();
const yearQuery = z.object({ fy: z.string().min(7).max(7).optional() }).strict();
const requiredYearQuery = z.object({ fy: z.string().min(7).max(7) }).strict();
const uploadBody = z.object({ fy: z.string().min(7).max(7), section: z.string().min(2).max(20) }).strict();
const send = (res: Response, status: number, body: unknown): void => void res.status(status).json(body);

// The person's own
taxRouter.get("/me", validate({ query: yearQuery }), async (req, res) => send(res, 200, await decl.myDeclaration(req.user!.employeeId, (req.query as { fy?: string }).fy)));
taxRouter.put("/me/declaration", validate({ body: decl.saveDeclarationSchema }), async (req, res) => send(res, 200, await decl.saveMyDeclaration(req.body, self(req))));
taxRouter.post("/me/proofs", memoryUpload(MAX_DOCUMENT_UPLOAD_MB_CEILING), validate({ body: uploadBody }), async (req, res) => send(res, 201, await decl.uploadMyProof((req.body as { fy: string }).fy, (req.body as { section: string }).section, req.file, self(req))));
taxRouter.get("/me/proofs/:id/file", validate({ params: idParams }), async (req, res) => send(res, 200, await decl.myProofFile((req.params as { id: string }).id, self(req))));
taxRouter.get("/me/statement", validate({ query: yearQuery }), async (req, res) => send(res, 200, await statementFor(req.user!.employeeId, (req.query as { fy?: string }).fy)));

// Directors: windows, declarations, proofs
taxRouter.get("/windows", directors, validate({ query: requiredYearQuery }), async (req, res) => send(res, 200, await decl.windowsFor((req.query as { fy: string }).fy, actor(req))));
taxRouter.put("/windows", directors, validate({ body: decl.windowSchema }), async (req, res) => send(res, 200, await decl.setWindow(req.body, actor(req))));
taxRouter.get("/declarations", directors, validate({ query: requiredYearQuery }), async (req, res) => send(res, 200, await decl.declarationsList((req.query as { fy: string }).fy, actor(req))));
taxRouter.get("/proofs", directors, validate({ query: requiredYearQuery }), async (req, res) => send(res, 200, await decl.proofQueue((req.query as { fy: string }).fy, actor(req))));
taxRouter.post("/proofs/:id/decision", directors, validate({ params: idParams, body: decl.decisionSchema }), async (req, res) => send(res, 201, await decl.decideProof((req.params as { id: string }).id, req.body, actor(req))));
taxRouter.get("/proofs/:id/file", directors, validate({ params: idParams }), async (req, res) => send(res, 200, await decl.proofFileForDirector((req.params as { id: string }).id, actor(req))));

// Directors: the tax years (governed items: a different director confirms)
taxRouter.get("/years", rulesEdit, async (req, res) => send(res, 200, { years: await years.listTaxYears(actor(req)) }));
taxRouter.get("/years/:fy", rulesEdit, validate({ params: yearParams }), async (req, res) => send(res, 200, await years.getTaxYear((req.params as { fy: string }).fy, actor(req))));
taxRouter.post("/years/:fy/save-preview", rulesEdit, validate({ params: yearParams, body: itemSavePreviewSchema }), async (req, res) => send(res, 200, await years.previewTaxYearSave((req.params as { fy: string }).fy, (req.body as { value: unknown }).value, actor(req))));
taxRouter.put("/years/:fy", rulesEdit, validate({ params: yearParams, body: z.object({ value: z.unknown(), note: z.string().max(500).optional(), fingerprint: z.string().min(1).max(200) }).strict() }), async (req, res) => send(res, 200, await years.saveTaxYear((req.params as { fy: string }).fy, req.body as { value: unknown; note?: string; fingerprint: string }, actor(req))));
taxRouter.post("/years/:fy/confirm-preview", rulesConfirm, validate({ params: yearParams }), async (req, res) => send(res, 200, await years.previewTaxYearConfirm((req.params as { fy: string }).fy, actor(req))));
taxRouter.post("/years/:fy/confirm", rulesConfirm, validate({ params: yearParams, body: itemConfirmSchema }), async (req, res) => send(res, 200, await years.confirmTaxYear((req.params as { fy: string }).fy, req.body as { version: number; note: string; fingerprint: string }, actor(req))));
