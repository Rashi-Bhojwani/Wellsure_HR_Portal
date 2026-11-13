import { Router, type Request } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { refuseDeveloper } from "../../middleware/refuseDeveloper";
import { requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import * as onboarding from "./service";

// M session block 2, OE-04. HR's list and start: employee.edit (never manager-grantable) with the data scope in the service, the Developer refused.
// One's own steps, and the steps assigned to a reporting manager for their direct report, are reached through the service's own checks.
export const onboardingRouter = Router();
onboardingRouter.use(authenticate, refuseDeveloper);
const meta = (req: Request) => ({ actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null });
const viewer = (req: Request) => ({ userId: req.user!.userId, employeeId: req.user!.employeeId, dataScope: req.user!.dataScope, permissions: req.user!.permissions });
const employeeParams = z.object({ employeeId: z.string().min(1).max(64) }).strict();
const taskParams = z.object({ taskId: z.string().min(1).max(64) }).strict();
const hr = requirePermission("employee.edit");

onboardingRouter.get("/mine", async (req, res) => void res.json(await onboarding.mine(viewer(req))));
onboardingRouter.get("/", hr, validate({ query: onboarding.listQuery }), async (req, res) => void res.json({ people: await onboarding.list(viewer(req), (req.query as { show?: "open" | "all" }).show ?? "open") }));
onboardingRouter.post("/:employeeId/start", hr, validate({ params: employeeParams }), async (req, res) => void res.status(201).json(await onboarding.start(req.params.employeeId as string, viewer(req), meta(req))));
onboardingRouter.get("/:employeeId/steps", validate({ params: employeeParams }), async (req, res) => void res.json(await onboarding.steps(req.params.employeeId as string, viewer(req))));
onboardingRouter.put("/tasks/:taskId/done", validate({ params: taskParams, body: onboarding.doneBody }), async (req, res) => void res.json(await onboarding.setDone(req.params.taskId as string, req.body.done, viewer(req), meta(req))));
