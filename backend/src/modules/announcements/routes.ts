import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import * as controller from "./controller";
import { createAnnouncementSchema, idParamsSchema, updateAnnouncementSchema } from "./validators";

// Announcements (spec §6/§7.7's Home page HR banner). Read side is
// self-serve (every signed-in employee resolves their own scoped
// announcement); every mutation is announcements.manage (HR_ADMIN+, same
// config-action narrowing as settings.manage/leave.policy.manage).
export const announcementsRouter = Router();
announcementsRouter.use(authenticate);

announcementsRouter.get("/active", controller.getActiveAnnouncement);

const manage = requirePermission("announcements.manage");
announcementsRouter.get("/", manage, controller.listAnnouncements);
announcementsRouter.post("/", manage, validate({ body: createAnnouncementSchema }), controller.createAnnouncement);
announcementsRouter.patch("/:id", manage, validate({ params: idParamsSchema, body: updateAnnouncementSchema }), controller.updateAnnouncement);
announcementsRouter.delete("/:id", manage, validate({ params: idParamsSchema }), controller.deleteAnnouncement);
