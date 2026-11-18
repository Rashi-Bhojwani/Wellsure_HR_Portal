import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import { z } from "zod";
import * as controller from "./controller";
import { defaultsInUse } from "./defaultsInUse";
import { listSchedulesLimits, setScheduleLimit } from "./schedulesLimits";
import * as emailTemplates from "../auth/emailTemplates";
import { updateRegularizationSettingsSchema, updateExcessHoursSettingsSchema, updateDeviceAlertSettingsSchema, updateDeviceHealthSettingsSchema, updateHelpdeskSettingsSchema, updatePeopleDocumentsSettingsSchema, updateSettingsSchema } from "./validators";

// System Settings (spec §7.8) — security policy (Phase 1: lockout,
// password rules, invitation TTL, 2FA-required roles, auth rate limits)
// plus the attendance, helpdesk and people settings. (The flat leave encashment rate that used to be here is gone: audit fix 2026-11-18.)
export const settingsRouter = Router();
settingsRouter.use(authenticate);

const manage = requirePermission("settings.manage");

// NT-08 (M session): the wording of the sign-in emails (directors: settings.manage is HR-locked and the Developer role does not hold it).
settingsRouter.get("/email-templates", manage, async (_req, res) => void res.json({ templates: await emailTemplates.listEmailTemplates() }));
settingsRouter.put("/email-templates", manage, validate({ body: emailTemplates.updateEmailTemplateSchema }), async (req, res) =>
  void res.json({ templates: await emailTemplates.updateEmailTemplate(req.body, { actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null }) }),
);

// Audit fix 2026-11-18 (docs/plans/AUDIT_FIXES.md items 5 and 6): times and limits that had no screen, and which settings are still on their default.
const metaOf = (req: import("express").Request) => ({ actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null });
settingsRouter.get("/schedules-limits", manage, async (_req, res) => void res.json(await listSchedulesLimits()));
settingsRouter.put("/schedules-limits/:key", manage, validate({ body: z.object({ value: z.union([z.number(), z.string().max(5)]) }).strict() }), async (req, res) => void res.json(await setScheduleLimit(req.params.key as string, req.body.value, metaOf(req))));
settingsRouter.get("/defaults-in-use", manage, async (_req, res) => void res.json(await defaultsInUse()));

settingsRouter.get("/security", manage, controller.getSettings);
settingsRouter.put("/security", manage, validate({ body: updateSettingsSchema }), controller.updateSettings);


settingsRouter.get("/people-documents", manage, controller.getPeopleDocumentsSettings);
settingsRouter.put(
  "/people-documents",
  manage,
  validate({ body: updatePeopleDocumentsSettingsSchema }),
  controller.updatePeopleDocumentsSettings,
);

settingsRouter.get("/helpdesk", manage, controller.getHelpdeskSettings);
settingsRouter.put("/helpdesk", manage, validate({ body: updateHelpdeskSettingsSchema }), controller.updateHelpdeskSettings);

// Phase 2 P2-F: Attendance → Device health (sent to every sync agent).
settingsRouter.get("/device-health", manage, controller.getDeviceHealthSettings);
settingsRouter.put("/device-health", manage, validate({ body: updateDeviceHealthSettingsSchema }), controller.updateDeviceHealthSettings);

// Phase 2 P2-H: Attendance → Device alerts (who is told, and when silence becomes an incident).
settingsRouter.get("/device-alerts", manage, controller.getDeviceAlertSettings);
settingsRouter.put("/device-alerts", manage, validate({ body: updateDeviceAlertSettingsSchema }), controller.updateDeviceAlertSettings);

// Phase 3 commit 1: Attendance → Regularization (how far back a correction reaches; the bulk caps).
settingsRouter.get("/regularization", manage, controller.getRegularizationSettings);
settingsRouter.put("/regularization", manage, validate({ body: updateRegularizationSettingsSchema }), controller.updateRegularizationSettings);

// Phase 3 commit 4: Attendance → Excess hours (the smallest excess the report lists).
settingsRouter.get("/excess-hours", manage, controller.getExcessHoursSettings);
settingsRouter.put("/excess-hours", manage, validate({ body: updateExcessHoursSettingsSchema }), controller.updateExcessHoursSettings);
