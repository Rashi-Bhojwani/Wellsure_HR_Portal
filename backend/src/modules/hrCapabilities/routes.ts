import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { validate } from "../../middleware/validate";
import * as controller from "./controller";
import { historyQuerySchema, setCapabilitySchema } from "./validators";

// What HR can do (docs/plans/HR_CAPABILITIES.md §1B). Like director authority, no permission key gates these: every handler checks in the service that the caller is a director (an
// active Super Admin), and a change also needs two-step sign-in outside development. A key would be one more thing an owner could hand out.
export const hrCapabilitiesRouter = Router();
hrCapabilitiesRouter.use(authenticate);

hrCapabilitiesRouter.get("/", controller.getOverview);
hrCapabilitiesRouter.get("/history", validate({ query: historyQuerySchema }), controller.getHistory);
hrCapabilitiesRouter.put("/", validate({ body: setCapabilitySchema }), controller.putSwitch);
