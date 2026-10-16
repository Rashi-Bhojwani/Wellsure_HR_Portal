import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { requireAnyPermission, requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import * as controller from "./controller";
import * as salary from "./salary/controller";
import * as v from "./salary/validators";
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
