import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { validate } from "../../middleware/validate";
import { HttpError } from "../../middleware/errorHandler";
import * as insights from "./service";

// Insights routes. Every route signs in, validates, and checks the viewer in the service (directors, or Wellsure Office members with
// VIEW_INSIGHTS; the Developer is refused before anything is read). Responses and exports are aggregate and suppressed.
export const insightsRouter = Router();
insightsRouter.use(authenticate, (req, _res, next) => (req.user!.roleCodes.includes("DEVELOPER") ? next(new HttpError(403, "This is unavailable to Developer.", "FORBIDDEN")) : next()));
const empty = z.object({}).strict();
const metaOf = (req: { user?: { userId: string }; ip?: string; headers: Record<string, unknown> }) => ({ actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: (req.headers["user-agent"] as string | undefined) ?? null });

insightsRouter.get("/status", validate({ query: empty }), async (req, res) => { res.json(await insights.status(req.user!)); });
insightsRouter.get("/settings", validate({ query: empty }), async (req, res) => { res.json(await insights.viewSettings(req.user!)); });
insightsRouter.put("/settings/:key", validate({ params: z.object({ key: insights.keySchema }).strict(), body: insights.settingInput }), async (req, res) => { res.json(await insights.setSetting(req.params.key as insights.SettingKey, req.body, req.user!, metaOf(req))); });
insightsRouter.get("/metrics/:metric", validate({ params: insights.metricSchema, query: empty }), async (req, res) => { res.setHeader("Cache-Control", "no-store"); res.json(await insights.view(req.params.metric as insights.Metric, req.user!, metaOf(req))); });
insightsRouter.get("/metrics/:metric/export", validate({ params: insights.metricSchema, query: empty }), async (req, res) => {
  const out = await insights.exportCsv(req.params.metric as insights.Metric, req.user!, metaOf(req));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${out.filename}"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(out.body);
});
