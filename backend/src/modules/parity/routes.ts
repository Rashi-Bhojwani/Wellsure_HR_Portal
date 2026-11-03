import { Router, type Request, type Response } from "express";
import { authenticate } from "../../middleware/authenticate";
import { refuseDeveloper } from "../../middleware/refuseDeveloper";
import { requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import { revealContact } from "./contact";
import { getGridColumns, saveGridColumns } from "./gridColumns";
import { openPay } from "./pay";
import * as segments from "./segments";
import type { ParityMeta, ParityViewer } from "./types";
import { createSegmentSchema, gridColumnsSchema, gridKeyParamsSchema, idParamsSchema, membersQuerySchema, reasonQuerySchema, updateSegmentSchema } from "./validators";

// A-9 (docs/plans/GREYTHR_PARITY_EMPLOYEE_ADMIN.md). Every router: signed in, never the Developer role, a permission per action, the employee in the caller's
// scope (in the service), validated input, an audit row for every change and every reveal.
export const viewerOf = (req: Request): ParityViewer => ({ userId: req.user!.userId, employeeId: req.user!.employeeId, roleCodes: req.user!.roleCodes, dataScope: req.user!.dataScope, permissions: req.user!.permissions });
export const metaOf = (req: Request): ParityMeta => ({ actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null });
const p = (req: Request) => req.params.id as string;

// ── /api/employee-segments ──
export const segmentsRouter = Router();
segmentsRouter.use(authenticate, refuseDeveloper);
const manageSegments = requirePermission("employee.segments.manage");
segmentsRouter.get("/", manageSegments, async (req: Request, res: Response) => void res.json({ segments: await segments.listSegments(viewerOf(req)) }));
segmentsRouter.post("/", manageSegments, validate({ body: createSegmentSchema }), async (req, res) => void res.status(201).json(await segments.createSegment(req.body, viewerOf(req), metaOf(req))));
segmentsRouter.get("/:id", manageSegments, validate({ params: idParamsSchema }), async (req, res) => void res.json(await segments.getSegment(p(req), viewerOf(req))));
segmentsRouter.patch("/:id", manageSegments, validate({ params: idParamsSchema, body: updateSegmentSchema }), async (req, res) => void res.json(await segments.updateSegment(p(req), req.body, viewerOf(req), metaOf(req))));
segmentsRouter.post("/:id/archive", manageSegments, validate({ params: idParamsSchema }), async (req, res) => {
  await segments.archiveSegment(p(req), viewerOf(req), metaOf(req));
  res.status(204).send();
});
segmentsRouter.get("/:id/members", manageSegments, validate({ params: idParamsSchema, query: membersQuerySchema }), async (req, res) => {
  const q = req.query as unknown as { page: number; pageSize: number };
  res.json(await segments.segmentMembers(p(req), viewerOf(req), q.page, q.pageSize));
});

// ── /api/employee-extras: additions to the employee record that sit beside modules/employee (mounted ahead of nothing; own prefix, so no clash with /api/employees/:id) ──
export const employeeExtrasRouter = Router();
employeeExtrasRouter.use(authenticate, refuseDeveloper);
employeeExtrasRouter.get("/grid-columns/:gridKey", validate({ params: gridKeyParamsSchema }), async (req, res) => void res.json(await getGridColumns(req.user!.userId, req.params.gridKey as string)));
employeeExtrasRouter.put("/grid-columns/:gridKey", validate({ params: gridKeyParamsSchema, body: gridColumnsSchema }), async (req, res) => void res.json(await saveGridColumns(req.user!.userId, req.params.gridKey as string, req.body.columns)));
employeeExtrasRouter.get("/:id/contact", requirePermission("employee.contact.reveal"), validate({ params: idParamsSchema, query: reasonQuerySchema }), async (req, res) => {
  res.json(await revealContact(p(req), (req.query as { reason: string }).reason, viewerOf(req), metaOf(req)));
});
employeeExtrasRouter.get("/:id/pay", requirePermission("payroll.salary.view"), validate({ params: idParamsSchema }), async (req, res) => void res.json(await openPay(p(req), viewerOf(req), metaOf(req))));
