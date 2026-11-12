import { Router, type Request } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { refuseDeveloper } from "../../middleware/refuseDeveloper";
import { requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import * as ot from "./service";

// M session block 2, AT-19. One's own overtime: self. Deciding: attendance.regularization.approve at the gate (directors hold it), then a director, or
// the key with the person in the caller's data scope when the setting allows; never one's own. Month totals: directors. The Developer is refused.
export const overtimeRouter = Router();
overtimeRouter.use(authenticate, refuseDeveloper);
const meta = (req: Request) => ({ actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null });
const viewer = (req: Request) => ({ userId: req.user!.userId, employeeId: req.user!.employeeId, dataScope: req.user!.dataScope, permissions: req.user!.permissions });
const idParams = z.object({ id: z.string().min(1).max(64) }).strict();
const approver = requirePermission("attendance.regularization.approve");

overtimeRouter.get("/mine", validate({ query: ot.monthQuery }), async (req, res) => void res.json(await ot.mine(req.user!.employeeId, req.query.month as string)));
overtimeRouter.post("/mine", validate({ body: ot.claimBody }), async (req, res) => void res.status(201).json(await ot.claim(req.user!.employeeId, req.body, meta(req))));
overtimeRouter.post("/mine/:id/withdraw", validate({ params: idParams }), async (req, res) => void res.json(await ot.withdraw(req.params.id as string, req.user!.employeeId, meta(req))));
overtimeRouter.get("/", approver, validate({ query: ot.listQuery }), async (req, res) => void res.json(await ot.list(viewer(req), (req.query as { status?: "PENDING" }).status ?? "PENDING")));
overtimeRouter.post("/:id/approve", approver, validate({ params: idParams, body: ot.decideBody }), async (req, res) => void res.json(await ot.approve(req.params.id as string, req.body.note, viewer(req), meta(req))));
overtimeRouter.post("/:id/reject", approver, validate({ params: idParams, body: ot.rejectBody }), async (req, res) => void res.json(await ot.reject(req.params.id as string, req.body.note, viewer(req), meta(req))));
overtimeRouter.get("/totals", validate({ query: ot.monthQuery }), async (req, res) => void res.json({ people: await ot.monthTotals(req.query.month as string, viewer(req)) }));
