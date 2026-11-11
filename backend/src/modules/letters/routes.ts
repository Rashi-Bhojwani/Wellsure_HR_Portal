import { Router } from "express";
import { memoryUpload } from "../../lib/uploads";
import { authenticate } from "../../middleware/authenticate";
import { requireAnyPermission, requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import { z } from "zod";
import * as controller from "./controller";
// A-9 — begin
import { refuseDeveloper } from "../../middleware/refuseDeveloper";
import * as workflow from "./workflowController";
// A-9 — end
import {
  createTemplateSchema,
  employeeIdParamsSchema,
  grantSchema,
  idParamsSchema,
  prepareSchema,
  requestListQuerySchema,
  serialSchema,
  signSchema,
  starterParamsSchema,
  updateRequestSchema,
  voidSchema,
  issueSchema,
  letterheadSchema,
  newVersionSchema,
  previewSchema,
  reissueSchema,
  updateTemplateSchema,
} from "./validators";

// Letters (spec §7.2, Phase 5 commit D2). Templates and the letterhead need
// letters.template.manage; issuing, reissuing and reproducing need
// letters.generate AND the employee in the caller's data scope (checked in
// the service — out of scope reads as 404).
export const lettersRouter = Router();
lettersRouter.use(authenticate);

const manage = requirePermission("letters.template.manage");
const generate = requirePermission("letters.generate");
// Issuing a letter needs Issue letters (any letter) or Issue letters without pay figures (only a template proven pay-free: the service checks that, whichever route reaches it).
const issueAny = requireAnyPermission("letters.generate", "letters.issue.nopay");

lettersRouter.get("/templates", requireAnyPermission("letters.template.manage", "letters.generate", "letters.issue.nopay"), controller.listTemplates);
lettersRouter.post("/templates", manage, validate({ body: createTemplateSchema }), controller.createTemplate);
lettersRouter.post("/templates/preview", manage, validate({ body: previewSchema }), controller.previewTemplate);
lettersRouter.get("/templates/:id", manage, validate({ params: idParamsSchema }), controller.getTemplate);
lettersRouter.patch("/templates/:id", manage, validate({ params: idParamsSchema, body: updateTemplateSchema }), controller.updateTemplate);
lettersRouter.post("/templates/:id/versions", manage, validate({ params: idParamsSchema, body: newVersionSchema }), controller.saveNewVersion);

lettersRouter.get("/letterhead", manage, controller.getLetterhead);
lettersRouter.put("/letterhead", manage, validate({ body: letterheadSchema }), controller.updateLetterhead);
lettersRouter.get("/letterhead/logo", manage, controller.getLogo);
lettersRouter.post("/letterhead/logo", manage, memoryUpload(2), controller.uploadLogo);
lettersRouter.delete("/letterhead/logo", manage, controller.removeLogo);

// ── A-9 G3 (docs/plans/GREYTHR_PARITY_EMPLOYEE_ADMIN.md) — begin. Before "/:id" so the literal paths win. Starters, grants and the serial are the directors'
// (checked in the service); preparing and issuing need the template's own permission (assertMayAct). Every route refuses the Developer role. The gate is
// letters.issue.nopay (the directors hold every key; HR holds it through its switch; a manager never can), so switching HR off closes all of it at once. ──
const nopayGate = requirePermission("letters.issue.nopay");
lettersRouter.get("/starters", refuseDeveloper, workflow.listStartersRoute);
lettersRouter.post("/starters/:code/load", refuseDeveloper, validate({ params: starterParamsSchema }), workflow.loadStarterRoute);
lettersRouter.get("/grants", refuseDeveloper, workflow.listGrantsRoute);
lettersRouter.post("/grants", refuseDeveloper, validate({ body: grantSchema }), workflow.createGrantRoute);
lettersRouter.post("/grants/:id/revoke", refuseDeveloper, validate({ params: idParamsSchema }), workflow.revokeGrantRoute);
lettersRouter.get("/serial", refuseDeveloper, workflow.getSerialRoute);
lettersRouter.put("/serial", refuseDeveloper, validate({ body: serialSchema }), workflow.setSerialRoute);
lettersRouter.get("/requests/templates", refuseDeveloper, nopayGate, workflow.preparableTemplatesRoute);
lettersRouter.get("/requests/to-sign", refuseDeveloper, workflow.toSignRoute);
lettersRouter.get("/requests", refuseDeveloper, nopayGate, validate({ query: requestListQuerySchema }), workflow.listRequestsRoute);
lettersRouter.post("/requests", refuseDeveloper, nopayGate, validate({ body: prepareSchema }), workflow.prepareRoute);
lettersRouter.get("/requests/:id", refuseDeveloper, nopayGate, validate({ params: idParamsSchema }), workflow.getRequestRoute);
lettersRouter.patch("/requests/:id", refuseDeveloper, nopayGate, validate({ params: idParamsSchema, body: updateRequestSchema }), workflow.updateRequestRoute);
lettersRouter.post("/requests/:id/sign", refuseDeveloper, validate({ params: idParamsSchema, body: signSchema }), workflow.signRoute);
lettersRouter.post("/requests/:id/issue", refuseDeveloper, nopayGate, validate({ params: idParamsSchema }), workflow.issueRoute);
lettersRouter.post("/requests/:id/void", refuseDeveloper, nopayGate, validate({ params: idParamsSchema, body: voidSchema }), workflow.voidRoute);
lettersRouter.get("/requests/:id/preview", refuseDeveloper, nopayGate, validate({ params: idParamsSchema }), workflow.previewRoute);
// ── A-9 — end ──

// ── LT-08 (M session): an employee asks for a letter. The self routes are the caller's own (any signed-in person); the preparer routes need
// letters.issue.nopay plus the template's own PREPARE right (assertMayAct) and the employee in scope, checked in the service. ──
const askBody = z.object({ templateCode: z.string().trim().min(1).max(60), purpose: z.string().trim().min(3).max(300) }).strict();
const askStatus = z.object({ status: z.enum(["ASKED", "DONE", "DECLINED", "WITHDRAWN"]).default("ASKED") }).strict();
lettersRouter.get("/asks/options", controller.askOptions);
lettersRouter.get("/asks/mine", controller.myAsks);
lettersRouter.post("/asks/mine", validate({ body: askBody }), controller.ask);
lettersRouter.post("/asks/mine/:id/withdraw", validate({ params: idParamsSchema, body: z.object({}).strict() }), controller.withdrawAsk);
lettersRouter.get("/asks", refuseDeveloper, nopayGate, validate({ query: askStatus }), controller.listAsks);
lettersRouter.post("/asks/:id/done", refuseDeveloper, nopayGate, validate({ params: idParamsSchema, body: z.object({ letterRequestId: z.string().min(1).max(60) }).strict() }), controller.markAskDone);
lettersRouter.post("/asks/:id/decline", refuseDeveloper, nopayGate, validate({ params: idParamsSchema, body: z.object({ reason: z.string().trim().min(3).max(300) }).strict() }), controller.declineAsk);

lettersRouter.get("/employees/:employeeId", issueAny, validate({ params: employeeIdParamsSchema }), controller.listEmployeeLetters);
lettersRouter.post("/employees/:employeeId", issueAny, validate({ params: employeeIdParamsSchema, body: issueSchema }), controller.issueLetter);
lettersRouter.get("/:id", issueAny, validate({ params: idParamsSchema }), controller.getLetter);
lettersRouter.post("/:id/reissue", generate, validate({ params: idParamsSchema, body: reissueSchema }), controller.reissueLetter);
lettersRouter.post("/:id/reproduce", generate, validate({ params: idParamsSchema }), controller.reproduceLetter);
