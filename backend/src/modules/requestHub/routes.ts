import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { REQUEST_HUB_TYPES } from "@shared/types/inbox";
import { authenticate } from "../../middleware/authenticate";
import { validate } from "../../middleware/validate";
import * as service from "./service";

// Request Hub — self-serve, always the caller's own requests (see service.ts).
export const requestHubRouter = Router();
requestHubRouter.use(authenticate);

const listQuerySchema = z.object({
  type: z.enum(REQUEST_HUB_TYPES).optional(),
  state: z.enum(["OPEN", "CLOSED"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

requestHubRouter.get("/", validate({ query: listQuerySchema }), async (req: Request, res: Response) => {
  res.status(200).json(await service.listMyRequests(req.user!.employeeId, req.query as never));
});
