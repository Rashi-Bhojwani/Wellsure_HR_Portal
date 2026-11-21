import { refuseDeveloper } from "../../middleware/refuseDeveloper";
import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { validate } from "../../middleware/validate";
import * as rel from "./run/releaseController";
import * as rv from "./run/validators";

// An employee's own payslips (docs/plans/PHASE_6.md §9). No permission key: everyone reads their own and only their own, because the only employee id the service ever
// uses is the signed-in one. A stranger's payslip id answers 404, exactly like one that does not exist.
export const payslipRouter = Router();
payslipRouter.use(authenticate);
// FIX-L7 (independent audit 2026-11-20): the Developer is refused consistently (403) on every one of their own payroll pages, as on loans and reimbursements.
payslipRouter.use("/mine", refuseDeveloper);
import { openLinkRoute } from "./run/payslipLinkController";
import { queryRoute } from "./run/payslipQueryController";
import { querySchema } from "./run/payslipQuery";
payslipRouter.post("/mine/links/open", openLinkRoute);
payslipRouter.get("/mine", rel.mine);
payslipRouter.get("/mine/:id", validate({ params: rv.slipIdParamsSchema }), rel.mineOne);
payslipRouter.get("/mine/:id/why", validate({ params: rv.slipIdParamsSchema }), rel.mineWhy);
payslipRouter.post("/mine/:id/query", validate({ params: rv.slipIdParamsSchema, body: querySchema }), queryRoute);
payslipRouter.get("/mine/:id/pdf", validate({ params: rv.slipIdParamsSchema }), rel.minePdf);
