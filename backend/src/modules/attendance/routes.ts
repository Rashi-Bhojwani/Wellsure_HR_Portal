import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { requireAnyPermission, requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import * as config from "./configController";
import * as processRuns from "./processController";
import {
  assignmentChangeSchema,
  assignmentListQuerySchema,
  bulkAssignmentSchema,
  createPolicySchema,
  createShiftSchema,
  createWeekOffPatternSchema,
  cycleChangeSchema,
  defaultsSchema,
  employeeParamsSchema,
  employeeRowParamsSchema,
  idParamsSchema,
  manualBranchesSchema,
  processRunSchema,
  processScopeQuerySchema,
  finalisationReadinessQuerySchema,
  updatePolicySchema,
  updateShiftSchema,
  updateWeekOffPatternSchema,
  userParamsSchema,
} from "./configValidators";

// Attendance (Phase 2). P2-A: Attendance Settings under /config — company
// configuration, read by anyone who sees attendance (attendance.view) and
// changed only on attendance.config.manage. Neither is manager-grantable.
export const attendanceRouter = Router();
attendanceRouter.use(authenticate);

const canRead = requireAnyPermission("attendance.config.manage", "attendance.view");
const canManage = requirePermission("attendance.config.manage");

attendanceRouter.get("/config/shifts", canRead, config.listShifts);
attendanceRouter.post("/config/shifts", canManage, validate({ body: createShiftSchema }), config.createShift);
attendanceRouter.patch("/config/shifts/:id", canManage, validate({ params: idParamsSchema, body: updateShiftSchema }), config.updateShift);

attendanceRouter.get("/config/week-off-patterns", canRead, config.listWeekOffPatterns);
attendanceRouter.post("/config/week-off-patterns", canManage, validate({ body: createWeekOffPatternSchema }), config.createWeekOffPattern);
attendanceRouter.patch("/config/week-off-patterns/:id", canManage, validate({ params: idParamsSchema, body: updateWeekOffPatternSchema }), config.updateWeekOffPattern);

attendanceRouter.get("/config/policies", canRead, config.listPolicies);
attendanceRouter.post("/config/policies", canManage, validate({ body: createPolicySchema }), config.createPolicy);
attendanceRouter.patch("/config/policies/:id", canManage, validate({ params: idParamsSchema, body: updatePolicySchema }), config.updatePolicy);

attendanceRouter.get("/config/defaults", canRead, config.getDefaults);
attendanceRouter.put("/config/defaults", canManage, validate({ body: defaultsSchema }), config.setDefaults);

attendanceRouter.get("/config/cycle", canRead, config.getCycle);
attendanceRouter.post("/config/cycle", canManage, validate({ body: cycleChangeSchema }), config.scheduleCycleChange);
attendanceRouter.post("/config/cycle/:id/cancel", canManage, validate({ params: idParamsSchema }), config.cancelCycleChange);

attendanceRouter.get("/config/assignments", canRead, validate({ query: assignmentListQuerySchema }), config.listAssignments);
attendanceRouter.post("/config/assignments/bulk", canManage, validate({ body: bulkAssignmentSchema }), config.bulkChangeAssignment);
attendanceRouter.get("/config/assignments/:employeeId", canRead, validate({ params: employeeParamsSchema }), config.getAssignmentHistory);
attendanceRouter.post("/config/assignments/:employeeId", canManage, validate({ params: employeeParamsSchema, body: assignmentChangeSchema }), config.changeAssignment);
attendanceRouter.post("/config/assignments/:employeeId/:rowId/cancel", canManage, validate({ params: employeeRowParamsSchema }), config.cancelAssignmentChange);

attendanceRouter.get("/config/manual-branches", canManage, config.listManualBranchHolders);
attendanceRouter.put("/config/manual-branches/:userId", canManage, validate({ params: userParamsSchema, body: manualBranchesSchema }), config.setManualBranches);

// Process Attendance (P2-C, docs/plans/PHASE_2.md §3.1): re-run the engine for
// a range before the period is locked. attendance.process — not manager-grantable.
const canProcess = requirePermission("attendance.process");
attendanceRouter.get("/process/scope", canProcess, validate({ query: processScopeQuerySchema }), processRuns.scope);
attendanceRouter.get("/process", canProcess, processRuns.listRuns);
attendanceRouter.post("/process", canProcess, validate({ body: processRunSchema }), processRuns.startRun);
attendanceRouter.get("/process/:id", canProcess, validate({ params: idParamsSchema }), processRuns.getRun);
// What still blocks finalising a period (placeholder rule values, NM/NS/provisional days).
// Finalisation itself is Phase 3; the gate it must pass is built now.
attendanceRouter.get("/finalisation/readiness", canProcess, validate({ query: finalisationReadinessQuerySchema }), processRuns.finalisationReadiness);
