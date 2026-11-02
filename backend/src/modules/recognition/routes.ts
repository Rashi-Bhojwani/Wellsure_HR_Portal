import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { requireAuth } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import { requireDirector } from "../peeps/access";
import * as controller from "./controller";
import { directoryQuery, employeeParams, giveSchema, idParams, reasonSchema, recipientsQuery, sendSchema } from "./validators";

// Badges and cheers (D-36: given along the reporting line, decided in the service) and corrective notes (D-37: the directors only, private). Neither
// is a key a role could hold. Badges are public to signed-in staff; a note is read only by its sender, its recipient and the directors (audited).
export const badgesRouter = Router();
badgesRouter.use(authenticate, requireAuth);
badgesRouter.get("/status", controller.badgeStatus);
badgesRouter.get("/recipients", validate({ query: recipientsQuery }), controller.badgeRecipients);
badgesRouter.get("/mine", controller.myBadges);
badgesRouter.get("/given", controller.givenBadges);
badgesRouter.get("/directory", validate({ query: directoryQuery }), controller.directoryBadges);
badgesRouter.get("/counts", controller.badgeCounts);
badgesRouter.get("/recent", controller.recentBadges);
badgesRouter.post("/catalogue/starter", requireDirector("badges.give"), controller.loadStarter);
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
