import compression from "compression";
import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { validate } from "../../middleware/validate";
import * as controller from "./controller";
import { idParamsSchema, listDirectoryQuerySchema, photoParamsSchema, photoQuerySchema } from "./validators";

// People (spec §6, Phase 5 commit C) — the directory and org chart are for
// every signed-in employee; what each entry shows is governed by
// fieldPolicy.ts plus System Settings → People & Documents.
export const peopleRouter = Router();
peopleRouter.use(authenticate);

// The two potentially large responses (the whole company for the org chart:
// ~130 KB raw / ~14 KB gzipped at ~500 people) are gzipped. Deliberately
// per-route, not app-wide: responses that carry secrets alongside
// attacker-influenced input (e.g. auth tokens) shouldn't be compressed
// (BREACH), and these two carry neither.
const gzip = compression();
peopleRouter.get("/", gzip, validate({ query: listDirectoryQuerySchema }), controller.listDirectory);
peopleRouter.get("/org-chart", gzip, controller.getOrgChart);
peopleRouter.get("/photo-token", controller.getPhotoToken);
peopleRouter.get("/:id", validate({ params: idParamsSchema }), controller.getDirectoryEntry);

// Image bytes for <img> tags: authenticated by the photo-only token in the
// query string (see photos.ts), not the Authorization header, and mounted
// ahead of the noStore /api/people router in app.ts so it can be cached.
export const peoplePhotosRouter = Router();
peoplePhotosRouter.get("/:employeeId/:size", validate({ params: photoParamsSchema, query: photoQuerySchema }), controller.servePhoto);
