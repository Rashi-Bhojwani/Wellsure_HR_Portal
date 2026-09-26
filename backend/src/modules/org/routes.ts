import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import * as controller from "./controller";
import {
  createCitySchema,
  createGradeSchema,
  createLocationSchema,
  createSimpleMasterSchema,
  idParamsSchema,
  mergeLocationSchema,
  updateCitySchema,
  updateGradeSchema,
  updateLocationSchema,
  updateSimpleMasterSchema,
} from "./validators";

// Org masters (spec §7.8). Reads only need an authenticated session — every
// role needs these lists for dropdowns/filters/grouping. Mutations require
// org.manage (HR_ADMIN/HR_EXECUTIVE/SUPER_ADMIN per seed).
export const orgRouter = Router();
orgRouter.use(authenticate);

const manage = requirePermission("org.manage");

orgRouter.get("/cities", controller.listCities);
orgRouter.post("/cities", manage, validate({ body: createCitySchema }), controller.createCity);
orgRouter.patch("/cities/:id", manage, validate({ params: idParamsSchema, body: updateCitySchema }), controller.updateCity);
orgRouter.delete("/cities/:id", manage, validate({ params: idParamsSchema }), controller.deleteCity);

orgRouter.get("/locations", controller.listLocations);
orgRouter.post("/locations", manage, validate({ body: createLocationSchema }), controller.createLocation);
orgRouter.patch("/locations/:id", manage, validate({ params: idParamsSchema, body: updateLocationSchema }), controller.updateLocation);
orgRouter.delete("/locations/:id", manage, validate({ params: idParamsSchema }), controller.deleteLocation);
orgRouter.post(
  "/locations/:id/merge",
  manage,
  validate({ params: idParamsSchema, body: mergeLocationSchema }),
  controller.mergeLocations,
);

for (const [path, handlers] of [
  ["departments", controller.departments],
  ["designations", controller.designations],
  ["cost-centres", controller.costCentres],
] as const) {
  orgRouter.get(`/${path}`, handlers.list);
  orgRouter.post(`/${path}`, manage, validate({ body: createSimpleMasterSchema }), handlers.create);
  orgRouter.patch(`/${path}/:id`, manage, validate({ params: idParamsSchema, body: updateSimpleMasterSchema }), handlers.update);
  orgRouter.delete(`/${path}/:id`, manage, validate({ params: idParamsSchema }), handlers.remove);
}

// Grades carry an extra optional `rank` field — same shape otherwise.
orgRouter.get("/grades", controller.grades.list);
orgRouter.post("/grades", manage, validate({ body: createGradeSchema }), controller.grades.create);
orgRouter.patch("/grades/:id", manage, validate({ params: idParamsSchema, body: updateGradeSchema }), controller.grades.update);
orgRouter.delete("/grades/:id", manage, validate({ params: idParamsSchema }), controller.grades.remove);
