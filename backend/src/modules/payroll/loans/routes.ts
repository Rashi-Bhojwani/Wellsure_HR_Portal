import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authenticate } from "../../../middleware/authenticate";
import { refuseDeveloper } from "../../../middleware/refuseDeveloper";
import { requirePermission } from "../../../middleware/rbac";
import { validate } from "../../../middleware/validate";
import * as loans from "./service";

// P7-4 (docs/plans/P7_4_LOANS.md). The person's own routes take no person id: only the signed-in person's loans. Every other route needs a pay key AND a director
// (in the service). The Developer role is refused outright; HR and managers hold no pay key, so they reach nothing here.
export const loansRouter = Router();
loansRouter.use(authenticate, refuseDeveloper);

const actor = (req: Request) => ({ userId: req.user!.userId, ip: req.ip ?? null });
const send = (res: Response, status: number, body: unknown): void => void res.status(status).json(body);
const idParams = z.object({ id: z.string().min(1).max(64) }).strict();
const changeParams = z.object({ id: z.string().min(1).max(64), changeId: z.string().min(1).max(64) }).strict();
const directors = requirePermission("payroll.salary.view");

loansRouter.get("/mine", async (req, res) => send(res, 200, await loans.listOwn(req.user!.employeeId)));
loansRouter.get("/mine/:id", validate({ params: idParams }), async (req, res) => send(res, 200, await loans.ownLoan(req.params.id as string, req.user!.employeeId)));
loansRouter.post("/mine", async (req, res) => send(res, 201, await loans.requestOwn(req.body, { ...actor(req), employeeId: req.user!.employeeId })));

loansRouter.get("/types", directors, async (req, res) => send(res, 200, await loans.listTypes(actor(req))));
loansRouter.put("/types", directors, async (req, res) => send(res, 200, await loans.saveType(req.body, actor(req))));
loansRouter.get("/", directors, async (req, res) => send(res, 200, await loans.listAll(actor(req))));
loansRouter.post("/", directors, async (req, res) => send(res, 201, await loans.createForPerson(req.body, actor(req))));
loansRouter.get("/:id", directors, validate({ params: idParams }), async (req, res) => send(res, 200, await loans.directorsLoan(req.params.id as string, actor(req))));
loansRouter.post("/:id/sanction", directors, validate({ params: idParams }), async (req, res) => send(res, 200, await loans.requestSanction(req.params.id as string, req.body, actor(req))));
loansRouter.post("/:id/sanction/decision", directors, validate({ params: idParams }), async (req, res) => send(res, 200, await loans.decideSanction(req.params.id as string, req.body, actor(req))));
loansRouter.post("/:id/changes", directors, validate({ params: idParams }), async (req, res) => send(res, 201, await loans.requestChange(req.params.id as string, req.body, actor(req))));
loansRouter.post("/:id/changes/:changeId/decision", directors, validate({ params: changeParams }), async (req, res) => send(res, 200, await loans.decideChange(req.params.id as string, req.params.changeId as string, req.body, actor(req))));
