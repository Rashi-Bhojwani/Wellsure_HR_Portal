import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import * as controller from "./controller";
import { exportAuditLogQuerySchema, listAuditLogQuerySchema } from "./validators";
import { refuseDeveloper } from "../../middleware/refuseDeveloper";

// Audit log viewer (spec §7.8/§9) — GET only, deliberately. audit_logs is
// append-only end to end: writeAuditLog() (lib/audit.ts) is the only
// inserter, and there is no PATCH or DELETE route here or anywhere else in
// the app — don't add one.
export const auditLogRouter = Router();
auditLogRouter.use(authenticate);

auditLogRouter.get("/", requirePermission("audit.view"), validate({ query: listAuditLogQuerySchema }), controller.listAuditLogs);
// AU-04 (M session): the filtered list as Excel. Directors: the Developer role (which holds audit.view to read the screen) is refused a file of
// other people's before/after values. Audited.
auditLogRouter.get("/export", requirePermission("audit.view"), refuseDeveloper, validate({ query: exportAuditLogQuerySchema }), controller.exportAuditLogs);
