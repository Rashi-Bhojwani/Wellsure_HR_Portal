import { Router, type NextFunction, type Request, type Response } from "express";
import { authenticate } from "../../middleware/authenticate";
import { HttpError } from "../../middleware/errorHandler";
import { validate } from "../../middleware/validate";
import * as controller from "./controller";
import {
  assignRoleSchema,
  employeeKeyParamsSchema,
  employeeParamsSchema,
  employeeRoleParamsSchema,
  reasonSchema,
  roleCodeParamsSchema,
  setOverrideSchema,
  updateRoleSchema,
  securityEventsQuerySchema,
  idParamsSchema,
  acknowledgeSchema,
} from "./validators";

// Roles & permissions (Phase 5 commit E1). The gates here only decide who
// may SEE these screens; every change re-checks rules 1–8 in service.ts
// (most changes are Super-Admin-only there, whatever the route allows).
export const accessRouter = Router();
accessRouter.use(authenticate);

const isSuperAdmin = (req: Request) => req.user!.roleCodes.includes("SUPER_ADMIN");
const canView = (...keys: string[]) => (req: Request, _res: Response, next: NextFunction) =>
  isSuperAdmin(req) || keys.some((k) => req.user!.permissions.has(k)) ? next() : next(new HttpError(403, "You can't view roles and permissions.", "FORBIDDEN"));

accessRouter.get("/roles", canView("role.view"), controller.listRoles);
accessRouter.put("/roles/:code", validate({ params: roleCodeParamsSchema, body: updateRoleSchema }), controller.updateRole);

const viewPerson = canView("role.view", "user.security.manage");
accessRouter.get("/employees/:employeeId", viewPerson, validate({ params: employeeParamsSchema }), controller.getEmployeeAccess);
accessRouter.post("/employees/:employeeId/roles", validate({ params: employeeParamsSchema, body: assignRoleSchema }), controller.assignRole);
accessRouter.delete("/employees/:employeeId/roles/:code", validate({ params: employeeRoleParamsSchema }), controller.removeRole);
accessRouter.put("/employees/:employeeId/overrides/:key", validate({ params: employeeKeyParamsSchema, body: setOverrideSchema }), controller.setOverride);
accessRouter.delete("/employees/:employeeId/overrides/:key", validate({ params: employeeKeyParamsSchema, body: reasonSchema }), controller.clearOverride);
accessRouter.post("/employees/:employeeId/reset-2fa", validate({ params: employeeParamsSchema, body: reasonSchema }), controller.resetTwoFactor);
accessRouter.post("/employees/:employeeId/unlock", validate({ params: employeeParamsSchema, body: reasonSchema }), controller.unlockAccount);
accessRouter.post("/employees/:employeeId/password-reset", validate({ params: employeeParamsSchema, body: reasonSchema }), controller.sendPasswordReset);

// Security events (E1.1) — Super Admin only (checked in the service).
accessRouter.get("/security-events", validate({ query: securityEventsQuerySchema }), controller.listSecurityEvents);
accessRouter.post("/security-events/:id/acknowledge", validate({ params: idParamsSchema, body: acknowledgeSchema }), controller.acknowledgeSecurityEvent);
