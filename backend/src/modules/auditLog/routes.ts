import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import * as controller from "./controller";
import { listAuditLogQuerySchema } from "./validators";

// Audit log viewer (spec §7.8/§9) — GET only, deliberately. audit_logs is
// append-only end to end: writeAuditLog() (lib/audit.ts) is the only
// inserter, and there is no PATCH or DELETE route here or anywhere else in
// the app — don't add one.
export const auditLogRouter = Router();
auditLogRouter.use(authenticate);

auditLogRouter.get("/", requirePermission("audit.view"), validate({ query: listAuditLogQuerySchema }), controller.listAuditLogs);
