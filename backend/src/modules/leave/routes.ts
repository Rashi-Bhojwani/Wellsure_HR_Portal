import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { validate } from "../../middleware/validate";
import * as controller from "./controller";
import {
  applyLeaveSchema,
  balancesQuerySchema,
  bulkApproveSchema,
  calendarQuerySchema,
  cancelRequestSchema,
  holidaysQuerySchema,
  idParamsSchema,
  listLeaveRequestsQuerySchema,
  approveRequestSchema,
  rejectRequestSchema,
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

leaveRouter.get("/types", controller.listLeaveTypes);

leaveRouter.post("/requests", validate({ body: applyLeaveSchema }), controller.applyForLeave);
leaveRouter.get("/requests", validate({ query: listLeaveRequestsQuerySchema }), controller.listLeaveRequests);
leaveRouter.get("/requests/:id", validate({ params: idParamsSchema }), controller.getLeaveRequest);
leaveRouter.post("/requests/:id/approve", validate({ params: idParamsSchema, body: approveRequestSchema }), controller.approveLeaveRequest);
leaveRouter.post("/requests/:id/reject", validate({ params: idParamsSchema, body: rejectRequestSchema }), controller.rejectLeaveRequest);
leaveRouter.post("/requests/bulk-approve", validate({ body: bulkApproveSchema }), controller.bulkApproveLeaveRequests);
leaveRouter.post("/requests/:id/cancel", validate({ params: idParamsSchema, body: cancelRequestSchema }), controller.cancelLeaveRequest);

leaveRouter.get("/balances", validate({ query: balancesQuerySchema }), controller.getLeaveBalances);
leaveRouter.get("/calendar", validate({ query: calendarQuerySchema }), controller.getLeaveCalendar);

// Holidays/restricted holidays — read-only here; commit C adds the
// mutating admin routes (leave.policy.manage) to this same router.
export const holidaysRouter = Router();
holidaysRouter.use(authenticate);
holidaysRouter.get("/holidays", validate({ query: holidaysQuerySchema }), controller.listHolidays);
holidaysRouter.get("/restricted-holidays", validate({ query: holidaysQuerySchema }), controller.listRestrictedHolidays);
