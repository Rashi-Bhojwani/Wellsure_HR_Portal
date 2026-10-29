import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { validate } from "../../middleware/validate";
import * as controller from "./controller";
import { acknowledgeNoticeSchema, noticeIdParamsSchema, noticesQuerySchema, setSwitchSchema, stepParamsSchema } from "./validators";

// Director authority (docs/plans/DIRECTOR_AUTHORITY.md). No permission key gates these: every handler checks in the service that the caller is a director (an active Super
// Admin) and, outside development, that they have two-step sign-in. A permission key would be one more thing an owner could hand out.
export const directorRouter = Router();
directorRouter.use(authenticate);

directorRouter.get("/switches", controller.getSwitches);
directorRouter.put("/switches/:step", validate({ params: stepParamsSchema, body: setSwitchSchema }), controller.putSwitch);
directorRouter.get("/notices", validate({ query: noticesQuerySchema }), controller.getNotices);
directorRouter.post("/notices/:id/seen", validate({ params: noticeIdParamsSchema }), controller.seenNotice);
directorRouter.post("/notices/:id/acknowledge", validate({ params: noticeIdParamsSchema, body: acknowledgeNoticeSchema }), controller.ackNotice);
