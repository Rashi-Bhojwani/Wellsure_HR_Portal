import { Router } from "express";
import { MAX_DOCUMENT_UPLOAD_MB_CEILING } from "@shared/constants/peopleDocuments";
import { memoryUploadMany } from "../../lib/uploads";
import { authenticate } from "../../middleware/authenticate";
import { requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import * as controller from "./controller";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "./service";
import {
  addMessageSchema,
  createCategorySchema,
  idParamsSchema,
  myTicketsQuerySchema,
  queueQuerySchema,
  raiseTicketSchema,
  updateCategorySchema,
  updateTicketSchema,
} from "./validators";

// Helpdesk (spec §6). Raising, reading and replying to your own tickets is
// self-serve. The queue, assignment/status changes and category admin need
// helpdesk.manage. Per-ticket access (raiser vs HR, sensitive categories,
// internal notes) is decided in the service, never at the route — a ticket
// you can't see is a 404, not a 403.
export const helpdeskRouter = Router();
helpdeskRouter.use(authenticate);

const manage = requirePermission("helpdesk.manage");
const upload = memoryUploadMany(MAX_DOCUMENT_UPLOAD_MB_CEILING, MAX_ATTACHMENTS_PER_MESSAGE);

helpdeskRouter.get("/categories", controller.listActiveCategories);
helpdeskRouter.get("/categories/all", manage, controller.listAllCategories);
helpdeskRouter.post("/categories", manage, validate({ body: createCategorySchema }), controller.createCategory);
helpdeskRouter.patch("/categories/:id", manage, validate({ params: idParamsSchema, body: updateCategorySchema }), controller.updateCategory);
helpdeskRouter.get("/assignees", manage, controller.listAssignees);

helpdeskRouter.post("/tickets", upload, validate({ body: raiseTicketSchema }), controller.raiseTicket);
helpdeskRouter.get("/tickets/mine", validate({ query: myTicketsQuerySchema }), controller.listMyTickets);
helpdeskRouter.get("/queue", manage, validate({ query: queueQuerySchema }), controller.listQueue);
helpdeskRouter.get("/tickets/:id", validate({ params: idParamsSchema }), controller.getTicket);
helpdeskRouter.post("/tickets/:id/messages", validate({ params: idParamsSchema }), upload, validate({ body: addMessageSchema }), controller.addMessage);
helpdeskRouter.patch("/tickets/:id", manage, validate({ params: idParamsSchema, body: updateTicketSchema }), controller.updateTicket);
helpdeskRouter.post("/tickets/:id/reopen", validate({ params: idParamsSchema }), controller.reopenTicket);
helpdeskRouter.post("/attachments/:id/download", validate({ params: idParamsSchema }), controller.downloadAttachment);
