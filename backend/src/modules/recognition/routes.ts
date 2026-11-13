import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { requireAuth } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import { requireDirector } from "../peeps/access";
import * as controller from "./controller";
import { decideSchema, directoryQuery, emptyBody, employeeParams, giveSchema, idParams, reasonSchema, recipientsQuery, tagGiveSchema } from "./validators";

// Badges and cheers (D-36: given along the reporting line, decided in the service) and nudge tags (Stage 3: the directors only). Neither is a key a role
// could hold. Both are public to signed-in staff (never the Developer, never signed out).
export const badgesRouter = Router();
badgesRouter.use(authenticate, requireAuth);
badgesRouter.get("/status", controller.badgeStatus);
badgesRouter.get("/recipients", validate({ query: recipientsQuery }), controller.badgeRecipients);
badgesRouter.get("/mine", controller.myBadges);
badgesRouter.get("/given", controller.givenBadges);
badgesRouter.get("/directory", validate({ query: directoryQuery }), controller.directoryBadges);
badgesRouter.get("/counts", controller.badgeCounts);
badgesRouter.get("/recent", controller.recentBadges);
badgesRouter.get("/people/:employeeId", validate({ params: employeeParams }), controller.personBadges);
badgesRouter.post("/", validate({ body: giveSchema }), controller.give);
badgesRouter.post("/:id/revoke", validate({ params: idParams, body: reasonSchema }), controller.revokeBadge);
badgesRouter.get("/admin/all", requireDirector("badges.give"), controller.allBadges);

// Nudge tags (Peeps Stage 3): public light-hearted tags, given and removed by the directors (service + database), reviewed on the receiver's request.
// The old private corrective notes stay readable under /notes (the person concerned and the directors) and can no longer be written.
export const nudgesRouter = Router();
nudgesRouter.use(authenticate, requireAuth);
nudgesRouter.get("/status", controller.nudgeStatus);
nudgesRouter.get("/recipients", validate({ query: recipientsQuery }), controller.nudgeRecipients);
nudgesRouter.get("/mine", controller.myNudges);
nudgesRouter.get("/counts", controller.nudgeCounts);
nudgesRouter.get("/recent", controller.recentNudges);
nudgesRouter.get("/people/:employeeId", validate({ params: employeeParams }), controller.personNudges);
nudgesRouter.get("/admin/all", requireDirector("nudges.send"), controller.allNudges);
nudgesRouter.get("/notes/mine", controller.myNotes);
nudgesRouter.get("/notes/admin/all", requireDirector("nudges.send"), controller.allNotes);
nudgesRouter.get("/notes/:id", validate({ params: idParams }), controller.getNote);
nudgesRouter.post("/", validate({ body: tagGiveSchema }), controller.giveNudge);
nudgesRouter.post("/:id/remove", validate({ params: idParams, body: reasonSchema }), controller.removeNudge);
nudgesRouter.post("/:id/review", validate({ params: idParams, body: emptyBody }), controller.requestNudgeReview);
nudgesRouter.post("/:id/review/decide", validate({ params: idParams, body: decideSchema }), controller.decideNudgeReview);
