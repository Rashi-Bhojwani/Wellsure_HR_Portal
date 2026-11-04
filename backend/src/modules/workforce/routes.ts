import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { STATUS_CATALOGUE } from "@shared/attendance/statusCatalogue";
import { authenticate } from "../../middleware/authenticate";
import { refuseDeveloper } from "../../middleware/refuseDeveloper";
import { requireAnyPermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import { getWorkforceSetting, saveWorkforceSetting, settingHistory, settingView, WORKFORCE_SETTING_KEYS, type WorkforceSettingKey } from "./settings";

// A-10 (docs/plans/GREYTHR_PARITY_WORKFORCE.md). Every route: signed in, never the Developer role, validated, a permission, scope in the service where a person's
// data is involved, and an access-scan entry (managers/__tests__/routeInventory.ts).
export const viewerOf = (req: Request) => ({ userId: req.user!.userId, employeeId: req.user!.employeeId, roleCodes: req.user!.roleCodes, dataScope: req.user!.dataScope, permissions: req.user!.permissions });
export const metaOf = (req: Request) => ({ actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null });

export const workforceRouter = Router();
workforceRouter.use(authenticate, refuseDeveloper);

const attendanceReaders = requireAnyPermission("attendance.view", "attendance.manual.enter", "attendance.override.manage", "attendance.config.manage", "attendance.roster.manage");
const keyParams = z.object({ key: z.enum(WORKFORCE_SETTING_KEYS as [WorkforceSettingKey, ...WorkforceSettingKey[]]) });
const saveBody = z.object({ value: z.unknown(), reason: z.string().trim().min(3, "Say why (a few words)").max(300) });

// G1: the status catalogue with the directors' labels applied (company data, no person's record).
workforceRouter.get("/statuses", attendanceReaders, async (_req: Request, res: Response) => {
  const labels = (await getWorkforceSetting("attendance.statusLabels")) ?? {};
  res.json({ statuses: STATUS_CATALOGUE.map((s) => ({ ...s, label: labels[s.code] ?? s.meaning, labelSet: Boolean(labels[s.code]) })) });
});
workforceRouter.get("/settings/:key", attendanceReaders, validate({ params: keyParams }), async (req, res) => void res.json(await settingView(req.params.key as WorkforceSettingKey)));
workforceRouter.get("/settings/:key/history", validate({ params: keyParams }), async (req, res) => {
  if (!req.user!.roleCodes.includes("SUPER_ADMIN")) {
    res.status(403).json({ error: { message: "Only a director can see a setting's history.", code: "DIRECTOR_ONLY" } });
    return;
  }
  res.json({ history: await settingHistory(req.params.key as WorkforceSettingKey) });
});
workforceRouter.put("/settings/:key", validate({ params: keyParams, body: saveBody }), async (req, res) => void res.json(await saveWorkforceSetting(req.params.key as WorkforceSettingKey, req.body.value, req.body.reason, viewerOf(req), metaOf(req))));
