import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { requireAnyPermission, requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import * as controller from "./controller";
import * as salary from "./salary/controller";
import * as v from "./salary/validators";
import * as runs from "./run/controller";
import * as rv from "./run/validators";
import * as rel from "./run/releaseController";
import { memoryUpload } from "../../lib/uploads";
import { employeeSalaryQuerySchema } from "./salary/employees";
import { checkersQuerySchema, payrollAuditQuerySchema, ruleConfirmSchema, ruleEditPreviewSchema, ruleEditSchema, ruleKeyParamsSchema } from "./validators";

// Payroll. Every route here is gated on keys a manager can never hold (a test fails if any becomes manager-grantable) and none has a TEAM scope:
// payroll data is ALL or nothing. Nothing here moves money.
export const payrollRouter = Router();
payrollRouter.use(authenticate);

// Rules and setup (P6-1)
payrollRouter.get("/rules", requirePermission("payroll.rules.view"), controller.rules);
payrollRouter.get("/rules/:key", requirePermission("payroll.rules.view"), validate({ params: ruleKeyParamsSchema }), controller.rule);
payrollRouter.post("/rules/:key/edit-preview", requirePermission("payroll.rules.manage"), validate({ params: ruleKeyParamsSchema, body: ruleEditPreviewSchema }), controller.editPreview);
payrollRouter.put("/rules/:key", requirePermission("payroll.rules.manage"), validate({ params: ruleKeyParamsSchema, body: ruleEditSchema }), controller.edit);
payrollRouter.post("/rules/:key/confirm-preview", requirePermission("payroll.rules.confirm"), validate({ params: ruleKeyParamsSchema }), controller.confirmPreview);
payrollRouter.post("/rules/:key/confirm", requirePermission("payroll.rules.confirm"), validate({ params: ruleKeyParamsSchema, body: ruleConfirmSchema }), controller.confirm);

// Who could decide an action (made visible rather than silently blocking)
payrollRouter.get("/approvals/checkers", requireAnyPermission("payroll.rules.view", "payroll.run", "payroll.approve", "payroll.rules.confirm"), validate({ query: checkersQuerySchema }), controller.checkers);

// The Payroll audit trail. It has no permission of its own on purpose: it is payroll.salary.view, the same key as salary, so it cannot be more open.
payrollRouter.get("/audit", requirePermission("payroll.salary.view"), validate({ query: payrollAuditQuerySchema }), controller.audit);

// Salary (P6-2). Viewing needs payroll.salary.view; preparing anything needs payroll.salary.edit; confirming a component or structure is the same
// permission as confirming a rule; deciding a revision needs payroll.approve. A revision is the only way a salary row is written.
const view = requirePermission("payroll.salary.view");
const edit = requirePermission("payroll.salary.edit");
const confirmItem = requirePermission("payroll.rules.confirm");
const approve = requirePermission("payroll.approve");

payrollRouter.get("/components", view, salary.components);
payrollRouter.get("/components/:code", view, validate({ params: v.codeParamsSchema }), salary.component);
payrollRouter.post("/components/:code/save-preview", edit, validate({ params: v.codeParamsSchema, body: v.itemSavePreviewSchema }), salary.componentSavePreview);
payrollRouter.put("/components/:code", edit, validate({ params: v.codeParamsSchema, body: v.componentSaveSchema }), salary.componentSave);
payrollRouter.post("/components/:code/confirm-preview", confirmItem, validate({ params: v.codeParamsSchema }), salary.componentConfirmPreview);
payrollRouter.post("/components/:code/confirm", confirmItem, validate({ params: v.codeParamsSchema, body: v.itemConfirmSchema }), salary.componentConfirm);

payrollRouter.get("/structures", view, salary.structures);
payrollRouter.post("/structures/breakup-preview", edit, validate({ body: v.structureBreakupSchema }), salary.structureBreakup);
payrollRouter.get("/structures/:code", view, validate({ params: v.codeParamsSchema }), salary.structure);
payrollRouter.post("/structures/:code/save-preview", edit, validate({ params: v.codeParamsSchema, body: v.structureSavePreviewSchema }), salary.structureSavePreview);
payrollRouter.put("/structures/:code", edit, validate({ params: v.codeParamsSchema, body: v.structureSaveSchema }), salary.structureSave);
payrollRouter.post("/structures/:code/confirm-preview", confirmItem, validate({ params: v.codeParamsSchema }), salary.structureConfirmPreview);
payrollRouter.post("/structures/:code/confirm", confirmItem, validate({ params: v.codeParamsSchema, body: v.itemConfirmSchema }), salary.structureConfirm);

payrollRouter.get("/salary/people", view, validate({ query: v.peopleSearchSchema }), salary.people);
payrollRouter.get("/salary/employees", view, validate({ query: employeeSalaryQuerySchema }), salary.employeeSalaries);
payrollRouter.get("/salary/employees/:employeeId", view, validate({ params: v.employeeParamsSchema }), salary.employeeSalary);

payrollRouter.get("/salary/revisions", view, validate({ query: v.revisionListSchema }), salary.revisions);
payrollRouter.post("/salary/revisions/cancel-preview", edit, validate({ body: v.cancelPreviewSchema }), salary.cancelPreview);
payrollRouter.post("/salary/revisions/cancel", edit, validate({ body: v.cancelCreateSchema }), salary.cancelCreate);
payrollRouter.post("/salary/revisions/preview", edit, validate({ body: v.revisionPreviewSchema }), salary.revisionPreview);
payrollRouter.post("/salary/revisions", edit, validate({ body: v.revisionCreateSchema }), salary.revisionCreate);
payrollRouter.get("/salary/revisions/:id", view, validate({ params: v.idParamsSchema }), salary.revision);
payrollRouter.post("/salary/revisions/:id/submit", edit, validate({ params: v.idParamsSchema, body: v.revisionSubmitSchema }), salary.revisionSubmit);
payrollRouter.post("/salary/revisions/:id/withdraw", edit, validate({ params: v.idParamsSchema, body: v.revisionWithdrawSchema }), salary.revisionWithdraw);
payrollRouter.post("/salary/revisions/:id/decision", approve, validate({ params: v.idParamsSchema, body: v.revisionDecisionSchema }), salary.revisionDecision);
payrollRouter.post("/salary/revisions/:id/apply", edit, validate({ params: v.idParamsSchema }), salary.revisionApply);

payrollRouter.get("/adjustments", view, validate({ query: v.adjustmentListSchema }), salary.adjustments);
payrollRouter.post("/adjustments/preview", edit, validate({ body: v.adjustmentPreviewSchema }), salary.adjustmentPreview);
payrollRouter.post("/adjustments", edit, validate({ body: v.adjustmentAddSchema }), salary.adjustmentAdd);
payrollRouter.post("/adjustments/:id/cancel", edit, validate({ params: v.idParamsSchema, body: v.adjustmentCancelSchema }), salary.adjustmentCancel);

// Payroll runs (P6-3): readiness, making a run, previewing and requesting a calculation, reading the result. Viewing needs payroll.salary.view (a run is salary
// data); making, calculating and discarding need payroll.run. Nothing here can make a run real: that is P6-4's finaliser.
const make = requirePermission("payroll.run");
payrollRouter.get("/runs", view, validate({ query: rv.runListQuerySchema }), runs.runs);
payrollRouter.get("/runs/readiness", view, validate({ query: rv.readinessQuerySchema }), runs.runReadiness);
payrollRouter.post("/runs", make, validate({ body: rv.runCreateSchema }), runs.runCreate);
payrollRouter.get("/runs/:id", view, validate({ params: rv.runIdParamsSchema }), runs.run);
payrollRouter.get("/runs/:id/items", view, validate({ params: rv.runIdParamsSchema }), runs.runItems);
payrollRouter.get("/runs/:id/items/:employeeId", view, validate({ params: rv.runItemParamsSchema }), runs.runItem);
payrollRouter.get("/runs/:id/variance", view, validate({ params: rv.runIdParamsSchema, query: rv.varianceQuerySchema }), runs.runVariance);
payrollRouter.get("/runs/:id/export", view, validate({ params: rv.runIdParamsSchema }), runs.runExport);
payrollRouter.post("/runs/:id/calculate-preview", make, validate({ params: rv.runIdParamsSchema }), runs.runCalculatePreview);
payrollRouter.post("/runs/:id/calculate", make, validate({ params: rv.runIdParamsSchema, body: rv.runCalculateSchema }), runs.runCalculate);
payrollRouter.post("/runs/:id/void", make, validate({ params: rv.runIdParamsSchema, body: rv.runVoidSchema }), runs.runVoid);

// Submit, approve, finalise, unlock, publish, bank file (P6-4). The slug says which: run | finalise | unlock | publish | bank-file. Who may make a request is decided
// in the service by the subject (unlocking needs payroll.unlock, the rest payroll.run) and again by the maker-checker core; deciding is payroll.approve for all of them.
// A checker may also read the preview: they are shown exactly what the maker saw before they decide.
payrollRouter.get("/runs/:id/approvals", view, validate({ params: rv.runIdParamsSchema }), runs.runApprovals);
payrollRouter.post("/runs/:id/approvals/:slug/preview", requireAnyPermission("payroll.run", "payroll.unlock", "payroll.approve"), validate({ params: rv.stepParamsSchema }), runs.stepPreview);
payrollRouter.post("/runs/:id/approvals/:slug/request", requireAnyPermission("payroll.run", "payroll.unlock"), validate({ params: rv.stepParamsSchema, body: rv.stepRequestSchema }), runs.stepRequest);
payrollRouter.post("/runs/:id/approvals/:slug/decision", approve, validate({ params: rv.stepParamsSchema, body: rv.stepDecisionSchema }), runs.stepDecision);
payrollRouter.post("/runs/:id/approvals/:slug/withdraw-preview", requireAnyPermission("payroll.run", "payroll.unlock"), validate({ params: rv.stepParamsSchema }), runs.stepWithdrawPreview);
payrollRouter.post("/runs/:id/approvals/:slug/withdraw", requireAnyPermission("payroll.run", "payroll.unlock"), validate({ params: rv.stepParamsSchema, body: rv.stepWithdrawSchema }), runs.stepWithdraw);
payrollRouter.post("/runs/:id/finalise", make, validate({ params: rv.runIdParamsSchema }), runs.runFinalise);
payrollRouter.post("/runs/:id/unlock", requirePermission("payroll.unlock"), validate({ params: rv.runIdParamsSchema }), runs.runUnlock);

// ── P6-5: payslips, the bank file, statutory files, layouts ──
// The acts are carried out by somebody other than the person who decided (checked in the service); the permission here is the maker's.
payrollRouter.post("/runs/:id/payslips/publish", make, validate({ params: rv.runIdParamsSchema }), rel.publish);
payrollRouter.post("/runs/:id/bank-file/generate", make, validate({ params: rv.runIdParamsSchema }), rel.bankGenerate);
// Payslips as HR reads them (payroll.payslip.view), and the draft preview (payroll.salary.view: it shows a person's pay before it is real).
const readSlips = requirePermission("payroll.payslip.view");
payrollRouter.get("/runs/:id/payslips", readSlips, validate({ params: rv.runIdParamsSchema }), rel.runSlips);
payrollRouter.post("/runs/:id/payslips/prepare-again", make, validate({ params: rv.runIdParamsSchema }), rel.slipsPrepareAgain);
payrollRouter.get("/payslips/:id", readSlips, validate({ params: rv.slipIdParamsSchema }), rel.slip);
payrollRouter.get("/payslips/:id/pdf", readSlips, validate({ params: rv.slipIdParamsSchema }), rel.slipPdf);
payrollRouter.get("/runs/:id/items/:employeeId/payslip-preview", view, validate({ params: rv.previewParamsSchema }), rel.preview);
payrollRouter.get("/runs/:id/items/:employeeId/payslip-preview.pdf", view, validate({ params: rv.previewParamsSchema }), rel.previewPdf);
// The bank batch (payroll.bank.view) and what HR does after uploading the file to the bank.
const bankView = requirePermission("payroll.bank.view");
payrollRouter.get("/runs/:id/bank-batch", bankView, validate({ params: rv.runIdParamsSchema }), rel.batchOfRun);
payrollRouter.get("/bank-batches/:id", bankView, validate({ params: rv.slipIdParamsSchema }), rel.batch);
payrollRouter.get("/bank-batches/:id/file", bankView, validate({ params: rv.slipIdParamsSchema }), rel.batchDownload);
payrollRouter.post("/bank-batches/:id/mark-paid", make, validate({ params: rv.slipIdParamsSchema, body: rv.markPaidSchema }), rel.batchPaid);
payrollRouter.post("/bank-batches/:id/response", make, validate({ params: rv.slipIdParamsSchema }), memoryUpload(5), rel.batchResponse);
// Statutory files and the register: made by payroll.run, read by reports.salary.view.
const reportView = requirePermission("reports.salary.view");
payrollRouter.get("/runs/:id/outputs", reportView, validate({ params: rv.runIdParamsSchema }), rel.outputs);
payrollRouter.post("/runs/:id/outputs", make, validate({ params: rv.runIdParamsSchema, body: rv.outputGenerateSchema }), rel.outputGenerate);
payrollRouter.get("/outputs/:id/file", reportView, validate({ params: rv.slipIdParamsSchema }), rel.outputDownload);
// Layouts: saved by payroll.rules.manage, confirmed by a different person with payroll.rules.confirm, read by payroll.rules.view.
payrollRouter.get("/layouts", requirePermission("payroll.rules.view"), rel.layouts);
payrollRouter.get("/layouts/:key", requirePermission("payroll.rules.view"), validate({ params: rv.layoutKeyParamsSchema }), rel.layout);
payrollRouter.post("/layouts/:key/save-preview", requirePermission("payroll.rules.manage"), validate({ params: rv.layoutKeyParamsSchema, body: rv.layoutSavePreviewSchema }), rel.layoutSavePreview);
payrollRouter.put("/layouts/:key", requirePermission("payroll.rules.manage"), validate({ params: rv.layoutKeyParamsSchema, body: rv.layoutSaveSchema }), rel.layoutSave);
payrollRouter.post("/layouts/:key/confirm-preview", confirmItem, validate({ params: rv.layoutKeyParamsSchema }), rel.layoutConfirmPreview);
payrollRouter.post("/layouts/:key/confirm", confirmItem, validate({ params: rv.layoutKeyParamsSchema, body: rv.layoutConfirmSchema }), rel.layoutConfirm);
