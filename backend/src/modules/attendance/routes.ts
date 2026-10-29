import { Router } from "express";
import multer from "multer";
import { authenticate } from "../../middleware/authenticate";
import { requireAnyPermission, requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import * as config from "./configController";
import * as processRuns from "./processController";
import * as manual from "./manual/controller";
import * as info from "./info/controller";
import * as overrides from "./override/controller";
import * as swipes from "./swipes/controller";
import * as exceptionsQueue from "./exceptions/controller";
import {
  assignmentChangeSchema,
  assignmentListQuerySchema,
  bulkAssignmentSchema,
  createPolicySchema,
  createShiftSchema,
  createWeekOffPatternSchema,
  cycleChangeSchema,
  defaultsSchema,
  engineStartSchema,
  employeeParamsSchema,
  employeeRowParamsSchema,
  idParamsSchema,
  manualBranchesSchema,
  processRunSchema,
  processScopeQuerySchema,
  finalisationReadinessQuerySchema,
  finalisePeriodSchema,
  unlockPeriodSchema,
  markPresentSchema,
  monthQuerySchema,
  dateParamsSchema,
  employeeDateParamsSchema,
  whoIsInQuerySchema,
  bulkRegularizationPreviewSchema,
  overrideClearSchema,
  overrideConfirmSchema,
  overrideListQuerySchema,
  overridePreviewSchema,
  rosterConfirmSchema,
  swipesQuerySchema,
  exceptionsQuerySchema,
  mapDeviceIdsPreviewSchema,
  mapDeviceIdsSchema,
  assignShiftPreviewSchema,
  assignShiftSchema,
  rosterPreviewSchema,
  shiftOverrideClearSchema,
  shiftOverrideConfirmSchema,
  shiftOverrideListQuerySchema,
  shiftOverridePreviewSchema,
  bulkRegularizationSchema,
  eligibilityQuerySchema,
  raiseRegularizationSchema,
  regularizationQueueQuerySchema,
  regularizationDecisionSchema,
  musterEntriesSchema,
  musterQuerySchema,
  musterTemplateQuerySchema,
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

attendanceRouter.get("/config/engine-start", canRead, config.getEngineStart);
attendanceRouter.put("/config/engine-start", canManage, validate({ body: engineStartSchema }), config.setEngineStart);

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
attendanceRouter.get("/finalisation/readiness", requireAnyPermission("attendance.process", "attendance.finalise"), validate({ query: finalisationReadinessQuerySchema }), processRuns.finalisationReadiness);
// Period Finalisation (attendance.finalise: HR Admin, Payroll Admin; unlock is Super Admin only: a meta permission).
attendanceRouter.get("/finalisation/periods", requirePermission("attendance.finalise"), processRuns.listPeriods);
attendanceRouter.post("/finalisation", requirePermission("attendance.finalise"), validate({ body: finalisePeriodSchema }), processRuns.finalise);
attendanceRouter.post("/finalisation/unlock", requirePermission("attendance.unlock"), validate({ body: unlockPeriodSchema }), processRuns.unlock);

// The Attendance Muster and manual entry (P2-D, docs/plans/PHASE_2.md §5).
// Seen with attendance.view (data scope) or attendance.manual.enter (only
// the branches assigned to the holder — manual/scope.ts, 404 outside);
// changed only with attendance.manual.enter, branch-limited per day.
const canSeeMuster = requireAnyPermission("attendance.view", "attendance.manual.enter");
const canMark = requirePermission("attendance.manual.enter");
// Uploading the workbook is a form of editing the muster, so it needs both (Stage 1: a director switches them separately for HR).
const canUpload = requirePermission("attendance.manual.upload");
const musterUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => (file.originalname.toLowerCase().endsWith(".xlsx") ? cb(null, true) : cb(new Error("Only .xlsx files are accepted."))),
});
attendanceRouter.get("/muster/cycles", canSeeMuster, manual.cycles);
attendanceRouter.get("/muster", canSeeMuster, validate({ query: musterQuerySchema }), manual.getMuster);
attendanceRouter.get("/muster/export", canSeeMuster, validate({ query: musterQuerySchema }), manual.exportMuster);
attendanceRouter.post("/muster/entries", canMark, validate({ body: musterEntriesSchema }), manual.saveEntries);
attendanceRouter.post("/muster/mark-present", canMark, validate({ body: markPresentSchema }), manual.markPresent);
attendanceRouter.get("/muster/template", canMark, canUpload, validate({ query: musterTemplateQuerySchema }), manual.template);
attendanceRouter.post("/muster/upload", canMark, canUpload, musterUpload.single("file"), manual.previewUpload);
attendanceRouter.post("/muster/upload/:id/commit", canMark, canUpload, validate({ params: idParamsSchema }), manual.commitUpload);

// Attendance Info, Who Is In? and the forgot-to-punch request (P2-E).
// Own attendance needs no key (always SELF). Anyone else's needs
// attendance.view, narrowed to data scope in the service (404 outside).
// Regularization: the two manager-grantable keys, TEAM scope, never one's own.
attendanceRouter.get("/me/month", validate({ query: monthQuerySchema }), info.myMonth);
attendanceRouter.get("/me/day/:date", validate({ params: dateParamsSchema }), info.myDay);
attendanceRouter.get("/me/regularizations", info.mine);
attendanceRouter.get("/me/regularizations/eligibility", validate({ query: eligibilityQuerySchema }), info.eligibility);
attendanceRouter.post("/me/regularizations", validate({ body: raiseRegularizationSchema }), info.raise);
attendanceRouter.post("/me/regularizations/:id/cancel", validate({ params: idParamsSchema }), info.cancel);
const canViewAttendance = requirePermission("attendance.view");
attendanceRouter.get("/employees/:employeeId/month", canViewAttendance, validate({ params: employeeParamsSchema, query: monthQuerySchema }), info.employeeMonth);
attendanceRouter.get("/employees/:employeeId/day/:date", canViewAttendance, validate({ params: employeeDateParamsSchema }), info.employeeDay);
attendanceRouter.get("/who-is-in", canViewAttendance, validate({ query: whoIsInQuerySchema }), info.whoIsIn);
const canSeeRegularizations = requireAnyPermission("attendance.regularization.view", "attendance.regularization.approve");
const canDecideRegularizations = requirePermission("attendance.regularization.approve");
attendanceRouter.get("/regularizations", canSeeRegularizations, validate({ query: regularizationQueueQuerySchema }), info.queue);
// Bulk correction by HR (attendance.regularization.bulk: never manager-grantable): preview, then confirm the exact set.
const canBulkCorrect = requirePermission("attendance.regularization.bulk");
attendanceRouter.post("/regularizations/bulk/preview", canBulkCorrect, validate({ body: bulkRegularizationPreviewSchema }), info.bulkPreview);
attendanceRouter.post("/regularizations/bulk", canBulkCorrect, validate({ body: bulkRegularizationSchema }), info.bulkConfirm);
// Manual Override (attendance.override.manage: HR only, never manager-grantable): preview, confirm the exact set, clear, history.
const canOverride = requirePermission("attendance.override.manage");
attendanceRouter.post("/overrides/preview", canOverride, validate({ body: overridePreviewSchema }), overrides.overridePreview);
attendanceRouter.post("/overrides/clear", canOverride, validate({ body: overrideClearSchema }), overrides.overrideClear);
attendanceRouter.post("/overrides", canOverride, validate({ body: overrideConfirmSchema }), overrides.overrideConfirm);
attendanceRouter.get("/overrides", canOverride, validate({ query: overrideListQuerySchema }), overrides.overrideList);
// Shift Roster: forward-only, through the same writers as the assignment change. Its own key since Stage 1, so a director can switch it for HR alone.
const canRoster = requirePermission("attendance.roster.manage");
attendanceRouter.post("/roster/preview", canRoster, validate({ body: rosterPreviewSchema }), overrides.rosterPreview);
attendanceRouter.post("/roster", canRoster, validate({ body: rosterConfirmSchema }), overrides.rosterConfirm);
attendanceRouter.post("/shift-overrides/preview", canOverride, validate({ body: shiftOverridePreviewSchema }), overrides.shiftPreview);
attendanceRouter.post("/shift-overrides/clear", canOverride, validate({ body: shiftOverrideClearSchema }), overrides.shiftClear);
attendanceRouter.post("/shift-overrides", canOverride, validate({ body: shiftOverrideConfirmSchema }), overrides.shiftConfirm);
attendanceRouter.get("/shift-overrides", canOverride, validate({ query: shiftOverrideListQuerySchema }), overrides.shiftList);
// Exceptions queue: days that need a person to look (attendance.view, data-scoped; the unmapped device IDs are for company-wide
// scope). Bulk resolve is preview then confirm: mapping device IDs needs attendance.devices.manage, assigning a shift
// attendance.config.manage (both checked again in the service, with the actor's own items left out).
attendanceRouter.get("/exceptions", requirePermission("attendance.view"), requirePermission("attendance.exceptions.view"), validate({ query: exceptionsQuerySchema }), exceptionsQueue.list);
attendanceRouter.post("/exceptions/map-device-ids/preview", requirePermission("attendance.exceptions.view"), requirePermission("attendance.devices.manage"), validate({ body: mapDeviceIdsPreviewSchema }), exceptionsQueue.previewMap);
attendanceRouter.post("/exceptions/map-device-ids", requirePermission("attendance.exceptions.view"), requirePermission("attendance.devices.manage"), validate({ body: mapDeviceIdsSchema }), exceptionsQueue.confirmMap);
attendanceRouter.post("/exceptions/assign-shift/preview", requirePermission("attendance.exceptions.view"), requirePermission("attendance.config.manage"), validate({ body: assignShiftPreviewSchema }), exceptionsQueue.previewAssign);
attendanceRouter.post("/exceptions/assign-shift", requirePermission("attendance.exceptions.view"), requirePermission("attendance.config.manage"), validate({ body: assignShiftSchema }), exceptionsQueue.confirmAssign);

// Employee Swipes: the raw punch log (attendance.swipes.view: HR; a manager by grant, their team only).
const canSeeSwipes = requirePermission("attendance.swipes.view");
attendanceRouter.get("/swipes", canSeeSwipes, validate({ query: swipesQuerySchema }), swipes.list);
attendanceRouter.get("/swipes/options", canSeeSwipes, swipes.options);
attendanceRouter.get("/swipes/export", canSeeSwipes, validate({ query: swipesQuerySchema }), swipes.exportXlsx);
attendanceRouter.post("/regularizations/:id/approve", canDecideRegularizations, validate({ params: idParamsSchema, body: regularizationDecisionSchema }), info.approve);
attendanceRouter.post("/regularizations/:id/reject", canDecideRegularizations, validate({ params: idParamsSchema, body: regularizationDecisionSchema }), info.reject);
