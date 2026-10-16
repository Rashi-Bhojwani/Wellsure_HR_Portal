import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { requireAnyPermission, requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import * as controller from "./controller";
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
