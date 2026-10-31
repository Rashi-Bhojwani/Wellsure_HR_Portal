import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { requireAuth } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import { requireDirector } from "../peeps/access";
import * as controller from "./controller";
import { directoryQuery, employeeParams, giveSchema, idParams, reasonSchema, recipientsQuery, sendSchema } from "./validators";

// Badges and private nudges (D-28, D-29, Q-16). Who may give or send is decided in the service from the directors' settings (the directors; Wellsure
// Office members with the capability; managers for their own team) — it is not a key a role could hold. Reading: the recipient their own, the giver
// what they gave, the directors everything (a director opening someone else's nudge is audited).
export const badgesRouter = Router();
badgesRouter.use(authenticate, requireAuth);
badgesRouter.get("/status", controller.badgeStatus);
badgesRouter.get("/recipients", validate({ query: recipientsQuery }), controller.badgeRecipients);
badgesRouter.get("/mine", controller.myBadges);
badgesRouter.get("/given", controller.givenBadges);
badgesRouter.get("/directory", validate({ query: directoryQuery }), controller.directoryBadges);
badgesRouter.get("/counts", controller.badgeCounts);
badgesRouter.get("/people/:employeeId", validate({ params: employeeParams }), controller.personBadges);
badgesRouter.post("/", validate({ body: giveSchema }), controller.give);
badgesRouter.post("/:id/revoke", validate({ params: idParams, body: reasonSchema }), controller.revokeBadge);
badgesRouter.get("/admin/all", requireDirector("badges.give"), controller.allBadges);

export const nudgesRouter = Router();
nudgesRouter.use(authenticate, requireAuth);
nudgesRouter.get("/status", controller.nudgeStatus);
nudgesRouter.get("/recipients", validate({ query: recipientsQuery }), controller.nudgeRecipients);
nudgesRouter.get("/mine", controller.myNudges);
nudgesRouter.get("/sent", controller.sentNudges);
nudgesRouter.get("/admin/all", requireDirector("nudges.send"), controller.allNudges);
nudgesRouter.get("/:id", validate({ params: idParams }), controller.getNudge);
nudgesRouter.post("/", validate({ body: sendSchema }), controller.send);
nudgesRouter.post("/:id/revoke", validate({ params: idParams, body: reasonSchema }), controller.revokeNudge);
