import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import * as controller from "./controller";
import { createFavouriteSchema, idParamsSchema, reorderFavouritesSchema, saveLayoutSchema } from "./validators";

// Admin Homepage (spec §7.1) — Welcome tab (My Favourites, My Tasks,
// Latest Updates via modules/announcements) and Dashboard tab (widgets +
// layout). Favourites/layout/tasks are all self-serve (scoped to the
// caller); dashboard widgets are aggregate org data behind employee.view,
// the same broad-visibility permission every role that should see them
// (SUPER_ADMIN/HR_ADMIN/HR_EXECUTIVE/PAYROLL_ADMIN/MANAGER) already holds.
export const adminRouter = Router();
adminRouter.use(authenticate);

adminRouter.get("/dashboard", requirePermission("employee.view"), controller.getDashboardWidgets);

adminRouter.get("/favourites", controller.listFavourites);
adminRouter.post("/favourites", validate({ body: createFavouriteSchema }), controller.createFavourite);
adminRouter.delete("/favourites/:id", validate({ params: idParamsSchema }), controller.deleteFavourite);
adminRouter.post("/favourites/reorder", validate({ body: reorderFavouritesSchema }), controller.reorderFavourites);

adminRouter.get("/dashboard-layout", controller.getLayout);
adminRouter.put("/dashboard-layout", validate({ body: saveLayoutSchema }), controller.saveLayout);

adminRouter.get("/tasks/counts", controller.getTaskCounts);
