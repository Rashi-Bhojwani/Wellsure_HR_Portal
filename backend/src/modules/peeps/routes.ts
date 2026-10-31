import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { requireAuth } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import { requireDirector, requireOffice } from "./access";
import * as controller from "./controller";
import { confirmSettingSchema, enterSettingSchema, idParams, peopleQuery, proposeChangeSchema, settingKeyParams } from "./validators";

// Peeps core: the Wellsure Office workspace (membership) and the settings every Peeps module reads (D-29, D-30).
//   /me          self: whether the caller is a director or a member, and the workspace's name (drives the workspace switcher).
//   /settings    read by the directors and members; entered by a director or a member allowed to prepare settings; confirmed by a different director.
//   /office/*    the directors only.
export const peepsRouter = Router();
peepsRouter.use(authenticate, requireAuth);

peepsRouter.get("/me", controller.me);

peepsRouter.get("/settings", requireOffice("office.workspace"), controller.listSettings);
peepsRouter.post("/settings/:key", requireOffice("peeps.settings.manage"), validate({ params: settingKeyParams, body: enterSettingSchema }), controller.enterSetting);
peepsRouter.post("/settings/:key/confirm", requireDirector("peeps.settings.manage"), validate({ params: settingKeyParams, body: confirmSettingSchema }), controller.confirmSetting);

peepsRouter.get("/office/members", requireDirector("office.members.manage"), controller.membership);
peepsRouter.get("/office/people", requireDirector("office.members.manage"), validate({ query: peopleQuery }), controller.people);
peepsRouter.get("/office/drift", requireDirector("office.members.manage"), controller.drift);
peepsRouter.post("/office/changes", requireDirector("office.members.manage"), validate({ body: proposeChangeSchema }), controller.propose);
peepsRouter.post("/office/changes/:id/confirm", requireDirector("office.members.manage"), validate({ params: idParams }), controller.confirm);
