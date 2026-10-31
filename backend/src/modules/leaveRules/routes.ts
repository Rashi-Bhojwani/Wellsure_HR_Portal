import { Router, type NextFunction, type Request, type Response } from "express";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { HttpError } from "../../middleware/errorHandler";
import { MAX_DOCUMENT_UPLOAD_MB_CEILING } from "@shared/constants/peopleDocuments";
import { SUPER_ADMIN_ROLE_CODE } from "../../lib/permissions";
import { memoryUpload, requireFile } from "../../lib/uploads";
import { authenticate } from "../../middleware/authenticate";
import { requireAnyPermission, requireAuth, requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import { requireDirector } from "../peeps/access";
import { attachDocument, listDocuments, openDocument } from "./documents";
import { approveRules, listRules, prepareRules } from "./service";
import { approveSchema, codeParams, documentParams, prepareSchema, requestParams, versionParams } from "./validators";

// The four new leave types (Q-15). Rules: HR (leave.policy.manage) or a director prepares; a different director approves (service + trigger).
// Supporting documents: the employee attaches to their own request; HR (leave.documents.view) and the directors list and open (each open audited).
const meta = (req: Request) => ({ actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null });
const isDirector = (req: Request) => req.user!.roleCodes.includes(SUPER_ADMIN_ROLE_CODE);
const rulesActor = (req: Request) => ({ userId: req.user!.userId, isDirector: isDirector(req), canPrepare: isDirector(req) || req.user!.permissions.has("leave.policy.manage") });
const docViewer = (req: Request) => ({ userId: req.user!.userId, employeeId: req.user!.employeeId, canOpen: isDirector(req) || req.user!.permissions.has("leave.documents.view") });

// The rules are the owners' decision: the Developer (who holds leave.policy.manage to run the system) does not prepare or read them.
const notDeveloper = (req: Request, _res: Response, next: NextFunction) => (req.user!.roleCodes.includes(DEVELOPER_ROLE_CODE) ? next(new HttpError(403, "The Developer role does not prepare or read leave rules.", "FORBIDDEN")) : next());

export const leaveRulesRouter = Router();
leaveRulesRouter.use(authenticate, requireAuth, notDeveloper);
leaveRulesRouter.get("/", requirePermission("leave.policy.manage"), async (req: Request, res: Response) => {
  res.status(200).json(await listRules(req.user!.userId));
});
leaveRulesRouter.post("/:code/versions", requirePermission("leave.policy.manage"), validate({ params: codeParams, body: prepareSchema }), async (req: Request, res: Response) => {
  res.status(201).json(await prepareRules(req.params.code as string, req.body, rulesActor(req), meta(req)));
});
leaveRulesRouter.post("/:code/versions/:version/approve", requireDirector("leave.policy.manage"), validate({ params: versionParams, body: approveSchema }), async (req: Request, res: Response) => {
  res.status(200).json(await approveRules(req.params.code as string, Number(req.params.version), req.body, rulesActor(req), meta(req)));
});

const upload = memoryUpload(MAX_DOCUMENT_UPLOAD_MB_CEILING);
export const leaveDocumentsRouter = Router();
leaveDocumentsRouter.use(authenticate, requireAuth);
// Attaching is the employee's own (checked in the service: their own new-type request); listing is the employee (a count) or HR/a director.
leaveDocumentsRouter.post("/requests/:requestId", validate({ params: requestParams }), upload, async (req: Request, res: Response) => {
  res.status(201).json(await attachDocument(req.params.requestId as string, requireFile(req.file), docViewer(req), meta(req)));
});
leaveDocumentsRouter.get("/requests/:requestId", validate({ params: requestParams }), async (req: Request, res: Response) => {
  res.status(200).json(await listDocuments(req.params.requestId as string, docViewer(req)));
});
leaveDocumentsRouter.get("/:documentId", requireAnyPermission("leave.documents.view"), validate({ params: documentParams }), async (req: Request, res: Response) => {
  const doc = await openDocument(req.params.documentId as string, docViewer(req), meta(req));
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", doc.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${doc.fileName}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.status(200).send(doc.body);
});
