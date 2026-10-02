import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import * as controller from "./controller";
import {
  applyLeaveSchema,
  balancesQuerySchema,
  bulkApproveSchema,
  calendarQuerySchema,
  cancelRequestSchema,
  commitYearEndSchema,
  compOffQuerySchema,
  createHolidaySchema,
  createLeaveTypeSchema,
  dashboardQuerySchema,
  holidaysQuerySchema,
  idParamsSchema,
  listLeaveRequestsQuerySchema,
  manualCompOffGrantSchema,
  manualGrantSchema,
  previewYearEndSchema,
  recalculateCommitSchema,
  recalculatePreviewSchema,
  approveRequestSchema,
  rejectRequestSchema,
  updateHolidaySchema,
  updateLeaveTypeSchema,
  upsertLeavePolicySchema,
  yearEndListQuerySchema,
} from "./validators";

// Leave (Phase 4, spec §5). Permission/scope narrowing happens inside the
// service layer (see requests.ts/balances.ts/calendar.ts) rather than at
// the route level, since most of these endpoints are legitimately callable
// by *every* authenticated employee for their own data — unlike org
// masters or the admin-only Phase 4 endpoints (types/policies/holiday
// mutations/granter/recalculator/year-end), which arrive in commits C/D
// gated by requirePermission the same way org.manage/import.manage are.
export const leaveRouter = Router();
leaveRouter.use(authenticate);

const policyManage = requirePermission("leave.policy.manage");
const grant = requirePermission("leave.grant");

leaveRouter.get("/types", controller.listLeaveTypes);
leaveRouter.get("/types/all", policyManage, controller.listAllLeaveTypes);
leaveRouter.post("/types", policyManage, validate({ body: createLeaveTypeSchema }), controller.createLeaveType);
leaveRouter.patch("/types/:id", policyManage, validate({ params: idParamsSchema, body: updateLeaveTypeSchema }), controller.updateLeaveType);
leaveRouter.put("/types/:id/policy", policyManage, validate({ params: idParamsSchema, body: upsertLeavePolicySchema }), controller.upsertLeavePolicy);

leaveRouter.post("/requests", validate({ body: applyLeaveSchema }), controller.applyForLeave);
leaveRouter.get("/requests", validate({ query: listLeaveRequestsQuerySchema }), controller.listLeaveRequests);
leaveRouter.get("/requests/:id", validate({ params: idParamsSchema }), controller.getLeaveRequest);
leaveRouter.post("/requests/:id/approve", validate({ params: idParamsSchema, body: approveRequestSchema }), controller.approveLeaveRequest);
leaveRouter.post("/requests/:id/reject", validate({ params: idParamsSchema, body: rejectRequestSchema }), controller.rejectLeaveRequest);
leaveRouter.post("/requests/bulk-approve", validate({ body: bulkApproveSchema }), controller.bulkApproveLeaveRequests);
leaveRouter.post("/requests/:id/cancel", validate({ params: idParamsSchema, body: cancelRequestSchema }), controller.cancelLeaveRequest);

leaveRouter.get("/balances", validate({ query: balancesQuerySchema }), controller.getLeaveBalances);
leaveRouter.get("/calendar", validate({ query: calendarQuerySchema }), controller.getLeaveCalendar);

// Admin: manual grant/debit + comp-off grant (leave.grant) — Leave
// Granter's two write actions, plus reading one employee's comp-off lots.
leaveRouter.post("/grants", grant, validate({ body: manualGrantSchema }), controller.manualGrant);
leaveRouter.post("/comp-off/grant", grant, validate({ body: manualCompOffGrantSchema }), controller.manualCompOffGrant);
leaveRouter.get("/comp-off", validate({ query: compOffQuerySchema }), controller.listCompOffCredits);

// Admin: Year End Process (leave.yearend.manage) — preview -> discard/
// re-preview -> commit; see modules/leave/yearEnd.ts for the full lifecycle.
const yearEndManage = requirePermission("leave.yearend.manage");
leaveRouter.get("/year-end", yearEndManage, validate({ query: yearEndListQuerySchema }), controller.listYearEndRuns);
leaveRouter.post("/year-end/preview", yearEndManage, validate({ body: previewYearEndSchema }), controller.previewYearEnd);
leaveRouter.get("/year-end/:id", yearEndManage, validate({ params: idParamsSchema }), controller.getYearEndRun);
leaveRouter.get("/year-end/:id/report", yearEndManage, validate({ params: idParamsSchema }), controller.downloadYearEndReport);
leaveRouter.post("/year-end/:id/discard", yearEndManage, validate({ params: idParamsSchema }), controller.discardYearEndRun);
leaveRouter.post("/year-end/:id/commit", yearEndManage, validate({ params: idParamsSchema, body: commitYearEndSchema }), controller.commitYearEndRun);

// Admin: Leave Recalculator (leave.recalculate)
const recalculate = requirePermission("leave.recalculate");
leaveRouter.post("/recalculate/preview", recalculate, validate({ body: recalculatePreviewSchema }), controller.previewRecalculation);
leaveRouter.post("/recalculate/commit", recalculate, validate({ body: recalculateCommitSchema }), controller.commitRecalculation);

// Admin: Workforce Overview dashboard (leave.view) — aggregates over the viewer's data scope (E1.1)
const dashboardView = requirePermission("leave.view");
leaveRouter.get("/dashboard", dashboardView, validate({ query: dashboardQuerySchema }), controller.getWorkforceDashboard);

// Holidays/restricted holidays — read-only routes above; the mutating
// admin routes below (leave.policy.manage) share the same two resources.
export const holidaysRouter = Router();
holidaysRouter.use(authenticate);
holidaysRouter.get("/holidays", validate({ query: holidaysQuerySchema }), controller.listHolidays);
holidaysRouter.get("/restricted-holidays", validate({ query: holidaysQuerySchema }), controller.listRestrictedHolidays);

const holidayManage = requirePermission("leave.policy.manage");
holidaysRouter.post("/holidays", holidayManage, validate({ body: createHolidaySchema }), controller.createHoliday);
holidaysRouter.patch("/holidays/:id", holidayManage, validate({ params: idParamsSchema, body: updateHolidaySchema }), controller.updateHoliday);
holidaysRouter.delete("/holidays/:id", holidayManage, validate({ params: idParamsSchema }), controller.deleteHoliday);
holidaysRouter.post("/restricted-holidays", holidayManage, validate({ body: createHolidaySchema }), controller.createRestrictedHoliday);
holidaysRouter.patch("/restricted-holidays/:id", holidayManage, validate({ params: idParamsSchema, body: updateHolidaySchema }), controller.updateRestrictedHoliday);
holidaysRouter.delete("/restricted-holidays/:id", holidayManage, validate({ params: idParamsSchema }), controller.deleteRestrictedHoliday);
