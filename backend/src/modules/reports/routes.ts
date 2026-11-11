import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import * as controller from "./controller";
import { keyParamsSchema, reportQuerySchema } from "./validators";
import { z } from "zod";
import { subscribeSchema } from "./subscriptions";

// Core reports (Phase 5 commit F). reports.view is manager-grantable: every
// report is computed over the viewer's data scope (modules/reports/context),
// with an IDOR case per report in managerReach.test.ts. Leave liability
// also needs reports.liability.view (non-grantable), checked in the service.
export const reportsRouter = Router();
reportsRouter.use(authenticate);

const canView = requirePermission("reports.view");
reportsRouter.get("/", canView, controller.catalog);
// RP-13 (M session): "email me this report" — the caller's own schedules only; a report they cannot open cannot be scheduled (service).
reportsRouter.get("/subscriptions/mine", canView, controller.mySubscriptions);
reportsRouter.post("/subscriptions/mine", canView, validate({ body: subscribeSchema }), controller.subscribe);
reportsRouter.delete("/subscriptions/mine/:id", canView, validate({ params: z.object({ id: z.string().min(1).max(60) }) }), controller.unsubscribe);
reportsRouter.get("/:key", canView, validate({ params: keyParamsSchema, query: reportQuerySchema }), controller.run);
reportsRouter.get("/:key/export", canView, validate({ params: keyParamsSchema, query: reportQuerySchema }), controller.exportXlsx);
