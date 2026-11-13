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
import * as openings from "./openings"; // A-3
import * as form16 from "./form16"; // P7-7
import * as statChallans from "./statutoryChallans"; // ST-03 / ST-06
import * as partA from "./form16PartA"; // ST-25
import { myYtdReport } from "../run/ytd";
import { mySalaryRevisions } from "../salary/mine";
import { refuseDeveloper } from "../../../middleware/refuseDeveloper";
import { requireDirector } from "../../../lib/directorAuthority";

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
// P7-3: the person's own year-to-date report and salary revisions (theirs only: the signed-in person's id, never a parameter).
taxRouter.get("/me/ytd", refuseDeveloper, validate({ query: yearQuery }), async (req, res) => send(res, 200, await myYtdReport(req.user!.employeeId, (req.query as { fy?: string }).fy)));
taxRouter.get("/me/salary-revisions", refuseDeveloper, async (req, res) => send(res, 200, await mySalaryRevisions(req.user!.employeeId)));
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

// A-3: opening figures (directors only, in the service too; the Developer role is refused outright).
const openingYear = z.object({ fy: z.string().min(7).max(7) }).strict();
taxRouter.get("/openings", refuseDeveloper, directors, validate({ query: openingYear }), async (req, res) => send(res, 200, await openings.yearView((req.query as { fy: string }).fy, req.user!.userId)));
taxRouter.post("/openings", refuseDeveloper, directors, validate({ body: openings.enterSchema }), async (req, res) => send(res, 200, await openings.enter(req.body, actor(req))));
taxRouter.get("/openings/template", refuseDeveloper, directors, async (req, res) => {
  await requireDirector(req.user!.userId, "download the opening figures template");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="opening-figures-template.csv"');
  res.status(200).send(openings.importTemplateCsv());
});
taxRouter.post("/openings/import/preview", refuseDeveloper, directors, memoryUpload(5), validate({ body: openingYear }), async (req, res) => {
  if (!req.file) return send(res, 400, { error: { message: "Choose a file.", code: "VALIDATION_ERROR" } });
  send(res, 200, await openings.previewImport((req.body as { fy: string }).fy, req.file, actor(req)));
});
taxRouter.post("/openings/import/apply", refuseDeveloper, directors, memoryUpload(5), async (req, res) => {
  if (!req.file) return send(res, 400, { error: { message: "Choose the same file again.", code: "VALIDATION_ERROR" } });
  const b = req.body as { fy?: string; fingerprint?: string; reason?: string };
  send(res, 200, await openings.applyImport({ year: b.fy, fingerprint: b.fingerprint, reason: b.reason }, req.file, actor(req)));
});
taxRouter.post("/openings/confirm", refuseDeveloper, directors, validate({ body: openings.requestSchema }), async (req, res) => send(res, 200, await openings.requestConfirmation(req.body, actor(req))));
taxRouter.post("/openings/:fy/decision", refuseDeveloper, directors, validate({ params: yearParams, body: openings.decisionSchema }), async (req, res) => send(res, 200, await openings.decideConfirmation((req.params as { fy: string }).fy, req.body, actor(req))));

// P7-7 (docs/plans/P7_7_FORM16.md): the challan register, quarterly data, Form 16 Part B data. Directors only (a pay key AND a director in the service), except a
// person's own Form 16 (their own only). The Developer role is refused.
const quarterQuery = z.object({ fy: z.string().min(7).max(7), quarter: z.coerce.number().int().min(1).max(4) }).strict();
taxRouter.get("/me/form16", refuseDeveloper, validate({ query: requiredYearQuery }), async (req, res) => send(res, 200, await form16.myForm16(req.user!.employeeId, (req.query as { fy: string }).fy)));
const pdfOut = (res: Response, out: { pdf: Buffer; fileName: string }) => {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${out.fileName}"`);
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send(out.pdf);
};
const personYearParams = z.object({ fy: z.string().min(7).max(7), employeeId: z.string().min(1).max(64) }).strict();
taxRouter.get("/me/form16/part-a", refuseDeveloper, validate({ query: requiredYearQuery }), async (req, res) => pdfOut(res, await partA.myPartA(req.user!.employeeId, (req.query as { fy: string }).fy, actor(req)))); // ST-25
taxRouter.get("/form16/:fy/part-a", refuseDeveloper, directors, validate({ params: yearParams }), async (req, res) => send(res, 200, await partA.listYear((req.params as { fy: string }).fy, actor(req))));
taxRouter.post("/form16/:fy/people/:employeeId/part-a", refuseDeveloper, directors, memoryUpload(6), validate({ params: personYearParams }), async (req, res) => send(res, 201, await partA.upload((req.params as { fy: string }).fy, (req.params as { employeeId: string }).employeeId, req.file, actor(req))));
taxRouter.get("/form16/:fy/people/:employeeId/part-a", refuseDeveloper, directors, validate({ params: personYearParams }), async (req, res) => pdfOut(res, await partA.directorPartA((req.params as { fy: string }).fy, (req.params as { employeeId: string }).employeeId, actor(req))));
taxRouter.get("/me/form16/pdf", refuseDeveloper, validate({ query: requiredYearQuery }), async (req, res) => pdfOut(res, await form16.myForm16Pdf(req.user!.employeeId, (req.query as { fy: string }).fy, actor(req)))); // ST-24 / SS-05
taxRouter.get("/form16/:fy/people/:employeeId/pdf", refuseDeveloper, directors, validate({ params: personYearParams }), async (req, res) => pdfOut(res, await form16.directorForm16Pdf((req.params as { fy: string }).fy, (req.params as { employeeId: string }).employeeId, actor(req)))); // ST-24
taxRouter.get("/statutory-challans", refuseDeveloper, directors, validate({ query: statChallans.registerQuery }), async (req, res) => send(res, 200, await statChallans.register(req.query, actor(req)))); // ST-03 / ST-06
taxRouter.post("/statutory-challans", refuseDeveloper, directors, validate({ body: statChallans.entrySchema }), async (req, res) => send(res, 201, await statChallans.enter(req.body, actor(req))));
taxRouter.post("/statutory-challans/:id/confirm", refuseDeveloper, directors, validate({ params: idParams, body: statChallans.confirmSchema }), async (req, res) => send(res, 200, await statChallans.confirm((req.params as { id: string }).id, req.body, actor(req))));
taxRouter.get("/challans", refuseDeveloper, directors, validate({ query: requiredYearQuery }), async (req, res) => send(res, 200, await form16.register((req.query as { fy: string }).fy, actor(req))));
taxRouter.post("/challans", refuseDeveloper, directors, validate({ body: form16.challanSchema }), async (req, res) => send(res, 201, await form16.enterChallan(req.body, actor(req))));
taxRouter.post("/challans/:id/confirm", refuseDeveloper, directors, validate({ params: idParams, body: form16.confirmChallanSchema }), async (req, res) => send(res, 200, await form16.confirmChallan((req.params as { id: string }).id, req.body, actor(req))));
taxRouter.get("/quarterly", refuseDeveloper, directors, validate({ query: quarterQuery }), async (req, res) => send(res, 200, await form16.quarterly((req.query as { fy: string }).fy, Number((req.query as { quarter: string }).quarter), actor(req)))); // allow-number: a quarter 1 to 4
taxRouter.get("/quarterly/export", refuseDeveloper, directors, validate({ query: form16.quarterlyExportSchema }), async (req, res) => { // ST-21
  const file = await form16.exportQuarterly(req.query, actor(req));
  res.setHeader("Content-Type", file.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`);
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send(file.buffer);
});
taxRouter.get("/form16", refuseDeveloper, directors, validate({ query: requiredYearQuery }), async (req, res) => send(res, 200, await form16.yearForm16((req.query as { fy: string }).fy, actor(req))));
taxRouter.post("/form16/:fy/confirm", refuseDeveloper, directors, validate({ params: yearParams, body: form16.confirmSchema }), async (req, res) => send(res, 200, await form16.requestConfirmation((req.params as { fy: string }).fy, req.body, actor(req))));
taxRouter.post("/form16/:fy/decision", refuseDeveloper, directors, validate({ params: yearParams, body: form16.decisionSchema }), async (req, res) => send(res, 200, await form16.decideConfirmation((req.params as { fy: string }).fy, req.body, actor(req))));
