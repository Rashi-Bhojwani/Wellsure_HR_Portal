import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { validate } from "../../middleware/validate";
import * as controller from "./controller";
import { z } from "zod";
import { NOTIFICATION_CATEGORY_KEYS, type NotificationCategory } from "@shared/constants/notificationPreferences";
import { idParamsSchema, listNotificationsQuerySchema } from "./validators";

// Notifications (spec §8) — self-serve only; every row is implicitly
// scoped to req.user.userId, so no permission/data-scope check is needed
// beyond being signed in. Persistence itself (createNotification, in
// ./service.ts) is called directly by other modules' write paths, never
// exposed as its own HTTP endpoint.
export const notificationsRouter = Router();
notificationsRouter.use(authenticate);

notificationsRouter.get("/", validate({ query: listNotificationsQuerySchema }), controller.listNotifications);
notificationsRouter.get("/unread-count", controller.getUnreadCount);
// NT-09 (M session): the signed-in person's own notification choices.
notificationsRouter.get("/preferences", controller.getPreferences);
notificationsRouter.put("/preferences", validate({ body: z.object({ category: z.enum(NOTIFICATION_CATEGORY_KEYS as [NotificationCategory, ...NotificationCategory[]]), on: z.boolean() }).strict() }), controller.setPreference);
notificationsRouter.post("/read-all", controller.markAllAsRead);
notificationsRouter.post("/:id/read", validate({ params: idParamsSchema }), controller.markAsRead);
