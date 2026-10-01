import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import * as controller from "./controller";
import { updateHelpdeskSettingsSchema, updateLeaveSettingsSchema, updatePeopleDocumentsSettingsSchema, updateSettingsSchema } from "./validators";

// System Settings (spec §7.8) — security policy (Phase 1: lockout,
// password rules, invitation TTL, 2FA-required roles, auth rate limits)
// plus, from Phase 4, the one leave-domain setting Year End Process needs
// (the encashment daily rate — see modules/leave/encashmentRate.ts).
export const settingsRouter = Router();
settingsRouter.use(authenticate);

const manage = requirePermission("settings.manage");

settingsRouter.get("/security", manage, controller.getSettings);
settingsRouter.put("/security", manage, validate({ body: updateSettingsSchema }), controller.updateSettings);

settingsRouter.get("/leave", manage, controller.getLeaveSettings);
settingsRouter.put("/leave", manage, validate({ body: updateLeaveSettingsSchema }), controller.updateLeaveSettings);

settingsRouter.get("/people-documents", manage, controller.getPeopleDocumentsSettings);
settingsRouter.put(
  "/people-documents",
  manage,
  validate({ body: updatePeopleDocumentsSettingsSchema }),
  controller.updatePeopleDocumentsSettings,
);

settingsRouter.get("/helpdesk", manage, controller.getHelpdeskSettings);
settingsRouter.put("/helpdesk", manage, validate({ body: updateHelpdeskSettingsSchema }), controller.updateHelpdeskSettings);
