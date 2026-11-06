import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { STATUS_CATALOGUE } from "@shared/attendance/statusCatalogue";
import { authenticate } from "../../middleware/authenticate";
import { refuseDeveloper } from "../../middleware/refuseDeveloper";
import { requireAnyPermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import { prisma } from "../../lib/prisma";
import { createWeekendOverride, holidayLocations, listWeekendOverrides, setHolidayLocations, voidWeekendOverride, type NewWeekendOverride } from "./calendar";
import { createReviewer, listReviewers, voidReviewer } from "./reviewers";
import { createLock, listLocks, LOCK_CATEGORIES, voidLock, type NewLock } from "./locks";
import { exportRosterGrid, rosterGrid, type RosterGridQuery } from "../attendance/roster/grid";
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

// G2: the roster month grid (item 4) and its export. Scope in the service (rosterGrid → visibleIds).
const rosterReaders = requireAnyPermission("attendance.view", "attendance.roster.manage");
const gridQuery = z.object({
  cycleStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  locationId: z.string().min(1).max(64).optional(),
  departmentId: z.string().min(1).max(64).optional(),
});
workforceRouter.get("/roster/grid", rosterReaders, validate({ query: gridQuery }), async (req, res) => void res.json(await rosterGrid(viewerOf(req), req.query as RosterGridQuery)));
workforceRouter.get("/roster/grid/export", rosterReaders, validate({ query: gridQuery }), async (req, res) => {
  const { filename, buffer } = await exportRosterGrid(viewerOf(req), req.query as RosterGridQuery);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.status(200).send(buffer);
});

// G3: attendance activity locks (item 7). Directors only (in the service); every lock and void audited.
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date as YYYY-MM-DD");
const lockBody = z.object({
  effectiveFrom: isoDate,
  fromDate: isoDate,
  toDate: isoDate,
  categories: z.array(z.enum(LOCK_CATEGORIES)).min(1, "Choose at least one activity"),
  segmentId: z.string().min(1).max(64).nullable().optional(),
  reason: z.string().trim().min(3, "Say why (a few words)").max(300),
});
const voidBody = z.object({ reason: z.string().trim().min(3, "Say why (a few words)").max(300) });
const idParams = z.object({ id: z.string().min(1).max(64) });
workforceRouter.get("/locks", async (req, res) => void res.json(await listLocks(viewerOf(req))));
workforceRouter.post("/locks", validate({ body: lockBody }), async (req, res) => void res.status(201).json(await createLock(viewerOf(req), req.body as NewLock, metaOf(req))));
workforceRouter.post("/locks/:id/void", validate({ params: idParams, body: voidBody }), async (req, res) => void res.json(await voidLock(viewerOf(req), req.params.id as string, req.body.reason as string, metaOf(req))));

// G4: location-limited holidays (leave.policy.manage), weekend overrides (attendance.config.manage, scope in the service), leave type reviewers (directors).
const holidayLocBody = z.object({ locationIds: z.array(z.string().min(1).max(64)).max(200), reason: z.string().trim().min(3, "Say why (a few words)").max(300) });
workforceRouter.get("/holidays/locations", requireAnyPermission("leave.policy.manage"), async (_req, res) => {
  const ids = (await prisma.holiday.findMany({ select: { id: true } })).map((h) => h.id);
  res.json({ locations: Object.fromEntries(await holidayLocations(ids)) });
});
workforceRouter.put("/holidays/:id/locations", requireAnyPermission("leave.policy.manage"), validate({ params: idParams, body: holidayLocBody }), async (req, res) =>
  void res.json(await setHolidayLocations(viewerOf(req), req.params.id as string, req.body.locationIds as string[], req.body.reason as string, metaOf(req))),
);
const weekendBody = z
  .object({
    fromDate: isoDate,
    toDate: isoDate,
    weekOffPatternId: z.string().min(1).max(64),
    employeeIds: z.array(z.string().min(1).max(64)).max(2000).optional(),
    segmentId: z.string().min(1).max(64).nullable().optional(),
    reason: z.string().trim().min(3, "Say why (a few words)").max(300),
  })
  .refine((b) => (b.employeeIds?.length ?? 0) > 0 || !!b.segmentId, { message: "Choose the people (a list or a saved segment)." });
const canConfigure = requireAnyPermission("attendance.config.manage");
workforceRouter.get("/weekend-overrides", canConfigure, async (req, res) => void res.json(await listWeekendOverrides(viewerOf(req))));
workforceRouter.post("/weekend-overrides", canConfigure, validate({ body: weekendBody }), async (req, res) => void res.status(201).json(await createWeekendOverride(viewerOf(req), req.body as NewWeekendOverride, metaOf(req))));
workforceRouter.post("/weekend-overrides/:id/void", canConfigure, validate({ params: idParams, body: voidBody }), async (req, res) => void res.json(await voidWeekendOverride(viewerOf(req), req.params.id as string, req.body.reason as string, metaOf(req))));
const reviewerBody = z.object({
  leaveTypeId: z.string().min(1).max(64),
  reviewerEmployeeId: z.string().min(1).max(64),
  locationId: z.string().min(1).max(64).nullable().optional(),
  departmentId: z.string().min(1).max(64).nullable().optional(),
  reason: z.string().trim().min(3, "Say why (a few words)").max(300),
});
workforceRouter.get("/leave-reviewers", async (req, res) => void res.json(await listReviewers(viewerOf(req))));
workforceRouter.post("/leave-reviewers", validate({ body: reviewerBody }), async (req, res) => void res.status(201).json(await createReviewer(viewerOf(req), req.body, metaOf(req))));
workforceRouter.post("/leave-reviewers/:id/void", validate({ params: idParams, body: voidBody }), async (req, res) => void res.json(await voidReviewer(viewerOf(req), req.params.id as string, req.body.reason as string, metaOf(req))));
