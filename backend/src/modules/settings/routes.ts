import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import * as controller from "./controller";
import { updateSettingsSchema } from "./validators";

// System Settings (spec §7.8) — security policy only in Phase 1: lockout,
// password rules, invitation TTL, 2FA-required roles, auth rate limits.
export const settingsRouter = Router();
settingsRouter.use(authenticate);

const manage = requirePermission("settings.manage");

settingsRouter.get("/security", manage, controller.getSettings);
settingsRouter.put("/security", manage, validate({ body: updateSettingsSchema }), controller.updateSettings);
