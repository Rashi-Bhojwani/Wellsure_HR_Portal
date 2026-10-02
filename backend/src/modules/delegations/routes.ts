import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import * as controller from "./controller";
import { createMineSchema, createSchema, delegatorParamsSchema, idParamsSchema, listQuerySchema, revokeSchema } from "./validators";

// Workflow Delegates (Phase 5 commit E3). /mine is the caller's own: any
// signed-in user can read it (managers see what they delegated, anyone sees
// what they're covering); creating one refuses anyone but a MANAGER holder
// in the service. Everything else is HR's, on delegation.manage — not
// manager-grantable.
export const delegationsRouter = Router();
delegationsRouter.use(authenticate);

delegationsRouter.get("/mine", controller.listMine);
delegationsRouter.get("/delegate-options", controller.myDelegateOptions);
delegationsRouter.post("/mine", validate({ body: createMineSchema }), controller.createMine);
delegationsRouter.post("/mine/:id/revoke", validate({ params: idParamsSchema, body: revokeSchema }), controller.revokeMine);

const canManage = requirePermission("delegation.manage");
delegationsRouter.get("/", canManage, validate({ query: listQuerySchema }), controller.listAll);
delegationsRouter.get("/managers", canManage, controller.delegatorOptions);
delegationsRouter.get("/delegate-options/:delegatorUserId", canManage, validate({ params: delegatorParamsSchema }), controller.delegateOptionsFor);
delegationsRouter.post("/", canManage, validate({ body: createSchema }), controller.create);
delegationsRouter.post("/:id/revoke", canManage, validate({ params: idParamsSchema, body: revokeSchema }), controller.revoke);
