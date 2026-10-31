import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { requireAnyPermission, requirePermission } from "../../middleware/rbac";
import { z } from "zod";
import { validate } from "../../middleware/validate";
import * as controller from "./controller";
import { memoryUpload } from "../../lib/uploads";
import { MAX_PHOTO_UPLOAD_MB_CEILING } from "@shared/constants/peopleDocuments";
// PEEPS-BEGIN avatars
import { ownPhotoOnly } from "../avatars/service";
// PEEPS-END
import {
  bankUpdateSchema,
  createChangeRequestSchema,
  createEmployeeSchema,
  decideChangeRequestSchema,
  deviceCodeCheckQuerySchema,
  employeeListQuerySchema,
  exportQuerySchema,
  idParamsSchema,
  revealQuerySchema,
  pendingInvitationsQuerySchema,
  sendInvitationsSchema,
  initiateSeparationSchema,
  jobUpdateSchema,
  nameUpdateSchema,
  personalUpdateSchema,
  savedViewCreateSchema,
  selfServiceUpdateSchema,
  statutoryUpdateSchema,
} from "./validators";

const historyRowParamsSchema = z.object({ id: z.string().min(1), rowId: z.string().min(1) });

export const employeeRouter = Router();
employeeRouter.use(authenticate);

const canCreate = requirePermission("employee.create");
// Sending and resending invitations is its own key (a director-controlled HR switch); it carries no pay data.
const canInvite = requirePermission("invitations.send");
const canView = requirePermission("employee.view");
const canEdit = requirePermission("employee.edit");
const canExport = requirePermission("employee.export");
const canViewBank = requirePermission("employee.bank.view");
const canEditBank = requirePermission("employee.bank.edit");
const canViewStatutory = requirePermission("employee.statutory.view");
const canEditStatutory = requirePermission("employee.statutory.edit");
const canSeparate = requirePermission("employee.separate");
const canViewSeparations = requirePermission("employee.separate.view");
const canApproveChangeRequest = requirePermission("profile.changerequest.approve");
const photoUpload = memoryUpload(MAX_PHOTO_UPLOAD_MB_CEILING);

// ── Literal routes first — must precede /:id so Express doesn't try to
// match "change-requests"/"separations"/etc. as an :id value. ────────────

employeeRouter.get("/device-code-check", canCreate, validate({ query: deviceCodeCheckQuerySchema }), controller.checkDeviceCode);
employeeRouter.post("/", canCreate, validate({ body: createEmployeeSchema }), controller.createEmployee);

employeeRouter.get("/", canView, validate({ query: employeeListQuerySchema }), controller.listEmployees);
employeeRouter.get("/export", canExport, validate({ query: exportQuerySchema }), controller.exportEmployees);

employeeRouter.get("/saved-views", controller.listSavedViews);
employeeRouter.post("/saved-views", validate({ body: savedViewCreateSchema }), controller.createSavedView);
employeeRouter.delete("/saved-views/:id", validate({ params: idParamsSchema }), controller.deleteSavedView);

employeeRouter.get("/me", controller.getMyProfile);
employeeRouter.patch("/me", validate({ body: selfServiceUpdateSchema }), controller.updateSelfService);
// Photos — multipart "file"; re-encoded server-side (modules/people/photos.ts).
// Multer's cap is the hard ceiling; the admin-set limit is checked per request.
employeeRouter.put("/me/photo", photoUpload, controller.uploadMyPhoto);
employeeRouter.delete("/me/photo", controller.removeMyPhoto);

employeeRouter.post("/change-requests", validate({ body: createChangeRequestSchema }), controller.createChangeRequest);
employeeRouter.get("/change-requests", controller.listChangeRequests);
employeeRouter.post(
  "/change-requests/:id/approve",
  canApproveChangeRequest,
  validate({ params: idParamsSchema, body: decideChangeRequestSchema }),
  controller.approveChangeRequest,
);
employeeRouter.post(
  "/change-requests/:id/reject",
  canApproveChangeRequest,
  validate({ params: idParamsSchema, body: decideChangeRequestSchema }),
  controller.rejectChangeRequest,
);

employeeRouter.get("/separations", canViewSeparations, controller.listSeparations);
employeeRouter.post("/separations/:id/cancel", canSeparate, validate({ params: idParamsSchema }), controller.cancelSeparation);

// Invitations: who is still waiting for their set-password email (and what happened to the last one), and sending it, one batch at a time, by hand.
employeeRouter.get("/invitations", canInvite, validate({ query: pendingInvitationsQuerySchema }), controller.listPendingInvitations);
employeeRouter.post("/invitations/send", canInvite, validate({ body: sendInvitationsSchema }), controller.sendInvitations);

// ── :id routes ───────────────────────────────────────────────────────────

employeeRouter.get("/:id", canView, validate({ params: idParamsSchema }), controller.getProfile);
employeeRouter.post("/:id/resend-invite", canInvite, validate({ params: idParamsSchema }), controller.resendInvite);

employeeRouter.get("/:id/statutory/reveal", canViewStatutory, validate({ params: idParamsSchema, query: revealQuerySchema }), controller.revealStatutory);
employeeRouter.get("/:id/bank/reveal", canViewBank, validate({ params: idParamsSchema, query: revealQuerySchema }), controller.revealBank);

employeeRouter.get("/:id/history/job", canView, validate({ params: idParamsSchema }), controller.getJobHistory);
employeeRouter.get("/:id/history/name", canView, validate({ params: idParamsSchema }), controller.getNameHistory);
employeeRouter.get("/:id/history/bank", canViewBank, validate({ params: idParamsSchema }), controller.getBankHistory);
// EF3: cancel a scheduled change — same permission as making it (a team
// move can also be made in Manager Management, hence manager.team.assign).
employeeRouter.post("/:id/history/job/:rowId/cancel", requireAnyPermission("employee.edit", "manager.team.assign"), validate({ params: historyRowParamsSchema }), controller.cancelScheduledJobChange);
employeeRouter.post("/:id/history/name/:rowId/cancel", canEdit, validate({ params: historyRowParamsSchema }), controller.cancelScheduledNameChange);
employeeRouter.post("/:id/history/bank/:rowId/cancel", canEditBank, validate({ params: historyRowParamsSchema }), controller.cancelScheduledBankChange);

employeeRouter.patch("/:id/job", canEdit, validate({ params: idParamsSchema, body: jobUpdateSchema }), controller.updateJob);
employeeRouter.patch("/:id/bank", canEditBank, validate({ params: idParamsSchema, body: bankUpdateSchema }), controller.updateBank);
employeeRouter.patch("/:id/name", canEdit, validate({ params: idParamsSchema, body: nameUpdateSchema }), controller.updateName);
employeeRouter.patch(
  "/:id/statutory",
  canEditStatutory,
  validate({ params: idParamsSchema, body: statutoryUpdateSchema }),
  controller.updateStatutory,
);
// PEEPS-BEGIN avatars
// Only the owner adds or changes their photo; HR and the directors remove someone else's with a reason at /api/avatars/:employeeId/remove.
employeeRouter.use("/:id/photo", ownPhotoOnly);
// PEEPS-END
employeeRouter.put("/:id/photo", canEdit, validate({ params: idParamsSchema }), photoUpload, controller.uploadPhoto);
employeeRouter.delete("/:id/photo", canEdit, validate({ params: idParamsSchema }), controller.removePhoto);
employeeRouter.patch("/:id/personal", canEdit, validate({ params: idParamsSchema, body: personalUpdateSchema }), controller.updatePersonal);

employeeRouter.post(
  "/:id/separations",
  canSeparate,
  validate({ params: idParamsSchema, body: initiateSeparationSchema }),
  controller.initiateSeparation,
);
