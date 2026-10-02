import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { requireAnyPermission, requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import * as controller from "./controller";
import { appointSchema, assignTeamSchema, employeeParamsSchema, memberParamsSchema, removeManagerSchema, removeMemberSchema } from "./validators";

// Manager Management (Phase 5 commit E2). HR/Admin tools: none of these keys
// is manager-grantable, so a manager can never reach them.
export const managersRouter = Router();
managersRouter.use(authenticate);

const canSee = requireAnyPermission("manager.appoint", "manager.team.assign", "manager.permissions.manage");
const canAppoint = requirePermission("manager.appoint");
const canAssign = requirePermission("manager.team.assign");

managersRouter.get("/", canSee, controller.listManagers);
managersRouter.get("/unassigned", canSee, controller.listUnassigned);
// Reporting-manager pickers (Add Employee, Change job details).
managersRouter.get("/options", requireAnyPermission("employee.create", "employee.edit", "manager.appoint", "manager.team.assign"), controller.managerOptions);
managersRouter.post("/", canAppoint, validate({ body: appointSchema }), controller.appointManager);
managersRouter.get("/:employeeId/team", canSee, validate({ params: employeeParamsSchema }), controller.getTeam);
managersRouter.delete("/:employeeId", canAppoint, validate({ params: employeeParamsSchema, body: removeManagerSchema }), controller.removeManager);
managersRouter.post("/:employeeId/team", canAssign, validate({ params: employeeParamsSchema, body: assignTeamSchema }), controller.assignTeamMembers);
managersRouter.delete("/:employeeId/team/:memberId", canAssign, validate({ params: memberParamsSchema, body: removeMemberSchema }), controller.removeTeamMember);
