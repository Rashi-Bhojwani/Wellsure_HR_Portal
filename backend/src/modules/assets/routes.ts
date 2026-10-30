import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { requireAuth, requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import * as controller from "./controller";
import {
  confirmSettingSchema,
  createAssetSchema,
  damagedSchema,
  employeeParamsSchema,
  holdersQuerySchema,
  idParamsSchema,
  issueSchema,
  kindParamsSchema,
  listQuerySchema,
  lostSchema,
  proposeSettingSchema,
  returnSchema,
  transferSchema,
  updateAssetSchema,
} from "./validators";

// The asset register (Peeps module 1, docs/plans/PEEPS_PLAN.md §B.2).
//   /mine…        self: the caller's own assets and acknowledging receipt (no key; only ever the caller's rows).
//   register      assets.view to read, assets.manage to change; the service narrows holders to the caller's data scope.
//   settings      assets.settings.manage to read and enter a list; confirming also needs a director who did not enter it (service + trigger).
export const assetsRouter = Router();
assetsRouter.use(authenticate, requireAuth);

const view = requirePermission("assets.view");
const manage = requirePermission("assets.manage");
const settings = requirePermission("assets.settings.manage");

assetsRouter.get("/mine", controller.listMine);
assetsRouter.post("/mine/:id/acknowledge", validate({ params: idParamsSchema }), controller.acknowledge);

assetsRouter.get("/settings", settings, controller.getSettings);
assetsRouter.post("/settings/:kind", settings, validate({ params: kindParamsSchema, body: proposeSettingSchema }), controller.proposeSetting);
assetsRouter.post("/settings/:kind/confirm", settings, validate({ params: kindParamsSchema, body: confirmSettingSchema }), controller.confirmSetting);

assetsRouter.get("/holders", manage, validate({ query: holdersQuerySchema }), controller.searchHolders);
assetsRouter.get("/employees/:employeeId", view, validate({ params: employeeParamsSchema }), controller.listEmployeeAssets);
assetsRouter.get("/", view, validate({ query: listQuerySchema }), controller.listAssets);
assetsRouter.post("/", manage, validate({ body: createAssetSchema }), controller.createAsset);
assetsRouter.get("/:id", view, validate({ params: idParamsSchema }), controller.getAsset);
assetsRouter.patch("/:id", manage, validate({ params: idParamsSchema, body: updateAssetSchema }), controller.updateAsset);
assetsRouter.post("/:id/issue", manage, validate({ params: idParamsSchema, body: issueSchema }), controller.issueAsset);
assetsRouter.post("/:id/return", manage, validate({ params: idParamsSchema, body: returnSchema }), controller.returnAsset);
assetsRouter.post("/:id/transfer", manage, validate({ params: idParamsSchema, body: transferSchema }), controller.transferAsset);
assetsRouter.post("/:id/lost", manage, validate({ params: idParamsSchema, body: lostSchema }), controller.markLost);
assetsRouter.post("/:id/damaged", manage, validate({ params: idParamsSchema, body: damagedSchema }), controller.markDamaged);
