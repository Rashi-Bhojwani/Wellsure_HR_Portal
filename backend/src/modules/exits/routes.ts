import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import { metaOf, requireExitDirector, requireExitUser } from "./access";
import * as settings from "./settings";

export const exitsRouter = Router();
exitsRouter.use(authenticate, requireExitUser);
const empty = z.object({}).strict();
export const idSchema = z.object({ id: z.string().min(1) });
exitsRouter.get("/status", validate({ query: empty }), async (_req, res) => {
  const categories = await settings.getExitSetting("reasonCategories");
  res.json({ submitReady: categories !== null, reasonCategories: categories });
});
exitsRouter.get("/settings", requirePermission("exits.settings.manage"), validate({ query: empty }), async (req, res) => {
  res.json(await settings.settingsView(req.user!.userId));
});
exitsRouter.put("/settings/:key", requirePermission("exits.settings.manage"), validate({ params: z.object({ key: settings.settingKeySchema }), body: settings.settingInputSchema }), async (req, res) => {
  res.json(await settings.setExitSetting(req.params.key as settings.ExitSettingKey, req.body, metaOf(req)));
});
exitsRouter.get("/checklist-templates", requirePermission("exits.settings.manage"), validate({ query: empty }), async (req, res) => {
  await requireExitDirector(req.user!.userId);
  res.json(await settings.latestTemplate());
});
exitsRouter.post("/checklist-templates", requirePermission("exits.settings.manage"), validate({ body: settings.templateSchema }), async (req, res) => {
  res.status(201).json(await settings.createTemplate(req.body, metaOf(req)));
});
