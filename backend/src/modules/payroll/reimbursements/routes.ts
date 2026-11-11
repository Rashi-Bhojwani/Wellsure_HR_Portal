import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { MAX_DOCUMENT_UPLOAD_MB_CEILING } from "@shared/constants/peopleDocuments";
import { memoryUploadMany } from "../../../lib/uploads";
import { authenticate } from "../../../middleware/authenticate";
import { refuseDeveloper } from "../../../middleware/refuseDeveloper";
import { requirePermission } from "../../../middleware/rbac";
import { validate } from "../../../middleware/validate";
import * as claims from "./service";

// P7-5 (docs/plans/P7_5_REIMBURSEMENTS.md). Own routes take no person id; directors' routes need a pay key AND a director (in the service). Developer refused.
export const reimbursementsRouter = Router();
reimbursementsRouter.use(authenticate, refuseDeveloper);

const actor = (req: Request) => ({ userId: req.user!.userId, ip: req.ip ?? null });
const self = (req: Request) => ({ ...actor(req), employeeId: req.user!.employeeId });
const send = (res: Response, status: number, body: unknown): void => void res.status(status).json(body);
const idParams = z.object({ id: z.string().min(1).max(64) }).strict();
const directors = requirePermission("payroll.salary.view");

reimbursementsRouter.get("/mine", async (req, res) => send(res, 200, await claims.myClaims(req.user!.employeeId)));
reimbursementsRouter.post("/mine", memoryUploadMany(MAX_DOCUMENT_UPLOAD_MB_CEILING, 5), async (req, res) => send(res, 201, await claims.createClaim(req.body, (req.files as Express.Multer.File[] | undefined) ?? [], self(req))));
reimbursementsRouter.post("/mine/:id/withdraw", validate({ params: idParams }), async (req, res) => send(res, 200, await claims.withdraw(req.params.id as string, self(req))));
reimbursementsRouter.get("/types", directors, async (req, res) => send(res, 200, await claims.listTypes(actor(req))));
reimbursementsRouter.put("/types", directors, async (req, res) => send(res, 200, await claims.saveType(req.body, actor(req))));
reimbursementsRouter.get("/", directors, validate({ query: z.object({ status: z.enum(["SUBMITTED", "ALL"]).optional() }).strict() }), async (req, res) => send(res, 200, await claims.queue(actor(req), (req.query as { status?: "SUBMITTED" | "ALL" }).status)));
reimbursementsRouter.post("/:id/decision", directors, validate({ params: idParams }), async (req, res) => send(res, 200, await claims.decide(req.params.id as string, req.body, actor(req))));
