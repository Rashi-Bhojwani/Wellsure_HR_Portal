import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env";
import { authenticate } from "../../middleware/authenticate";
import { requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import { buildSimulatorRoster, storedDays } from "./simulatorService";

// Development helpers for the punch simulator (docs/plans/PHASE_2.md "P2-G,
// commit G2 build design"). Read-only. Mounted by app.ts ONLY when APP_ENV is
// not "production": in a production build this router is never created, so
// every path under it is an ordinary 404.
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const rangeQuery = z.object({ from: date, to: date, seed: z.coerce.number().int().min(0).default(1) }).refine((q) => q.from <= q.to && Date.parse(q.to) - Date.parse(q.from) <= 62 * 86_400_000, {
  message: "from..to must be a range of at most 62 days",
});
const daysQuery = z.object({ from: date, to: date, codes: z.string().min(1).max(20_000) });

export const devSimulatorRouter = Router();
devSimulatorRouter.use(authenticate);
const canManage = requirePermission("attendance.devices.manage");

devSimulatorRouter.get("/roster", canManage, validate({ query: rangeQuery }), async (req, res) => {
  const q = req.query as unknown as z.infer<typeof rangeQuery>;
  res.status(200).json(await buildSimulatorRoster(q.from, q.to, q.seed, env.APP_ENV));
});

devSimulatorRouter.get("/days", canManage, validate({ query: daysQuery }), async (req, res) => {
  const q = req.query as unknown as z.infer<typeof daysQuery>;
  res.status(200).json({ days: await storedDays(q.codes.split(",").filter(Boolean), q.from, q.to) });
});
