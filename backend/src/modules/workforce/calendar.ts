import type { WeekOffRule } from "@shared/utils/attendance";
import { writeAuditLog } from "../../lib/audit";
import { buildEmployeeScopeWhere } from "../../lib/dataScope";
import { placementPeriods } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { requestRecomputeForEveryone, requestRecomputeRange } from "../attendance/recompute";
import { resolveSegmentEmployeeIds } from "../parity/segments";
import type { ParityMeta, ParityViewer } from "../parity/types";

// A-10 G4 (docs/plans/GREYTHR_PARITY_WORKFORCE.md items 9b and 10): the two calendar adjustments the attendance engine reads.
// * A holiday limited to some locations: the latest HolidayLocationScope row of the holiday; none, or an empty list, means company-wide (unchanged).
//   A person gets the holiday when they are placed at one of its locations on that day.
// * A weekend override: for its people and its days, the override's week-off pattern replaces the assignment's. The latest unvoided override wins.
// One loader (loadCalendar) is used by the engine (compute.ts), the roster grid and leave day counting, so they never disagree.

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);

export interface Calendar {
  /** The holiday's name if this person has a holiday on this day, else null. */
  holidayFor(employeeId: string, date: string): string | null;
  /** The week-off rules a weekend override puts in force for this person on this day, or null (the assignment's pattern applies). */
  weekOffOverrideFor(employeeId: string, date: string): WeekOffRule[] | null;
}

/** Pure: does a holiday with these locations apply to someone placed at `locationId`? Exported for tests. */
export const holidayApplies = (locationIds: string[] | null, locationId: string | null) => !locationIds || locationIds.length === 0 || (!!locationId && locationIds.includes(locationId));

export async function loadCalendar(employeeIds: string[], from: string, to: string): Promise<Calendar> {
  const [holidays, overrides] = await Promise.all([
    prisma.holiday.findMany({ where: { date: { gte: day(from), lte: day(to) } }, select: { id: true, date: true, name: true } }),
    prisma.weekendOverride.findMany({ where: { voidedAt: null, fromDate: { lte: day(to) }, toDate: { gte: day(from) }, employeeIds: { hasSome: employeeIds.length ? employeeIds : ["-"] } }, include: { weekOffPattern: { select: { rules: true } } }, orderBy: { createdAt: "asc" } }),
  ]);
  const scopes = holidays.length
    ? await prisma.holidayLocationScope.findMany({ where: { holidayId: { in: holidays.map((h) => h.id) } }, orderBy: { createdAt: "asc" } })
    : [];
  const scopeOf = new Map<string, string[]>();
  for (const s of scopes) scopeOf.set(s.holidayId, s.locationIds); // ascending: the latest wins
  const byDate = new Map(holidays.map((h) => [iso(h.date), { name: h.name, locations: scopeOf.get(h.id) ?? null }]));
  const limited = [...byDate.values()].some((h) => h.locations && h.locations.length > 0);
  const placements = limited && employeeIds.length ? await placementPeriods(employeeIds, day(from), day(to)) : new Map<string, Array<{ locationId: string; from: Date; to: Date }>>();
  const locationOn = (employeeId: string, date: string) => placements.get(employeeId)?.find((p) => iso(p.from) <= date && iso(p.to) >= date)?.locationId ?? null;
  return {
    holidayFor(employeeId, date) {
      const h = byDate.get(date);
      if (!h) return null;
      if (!h.locations || h.locations.length === 0) return h.name;
      return holidayApplies(h.locations, locationOn(employeeId, date)) ? h.name : null;
    },
    weekOffOverrideFor(employeeId, date) {
      let rules: WeekOffRule[] | null = null;
      for (const o of overrides) if (o.employeeIds.includes(employeeId) && iso(o.fromDate) <= date && iso(o.toDate) >= date) rules = o.weekOffPattern.rules as unknown as WeekOffRule[];
      return rules;
    },
  };
}

// ── Writers ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function setHolidayLocations(viewer: ParityViewer, holidayId: string, locationIds: string[], reason: string, meta: ParityMeta) {
  if (!viewer.permissions.has("leave.policy.manage")) throw new HttpError(403, "Missing permission: leave.policy.manage", "FORBIDDEN");
  const holiday = await prisma.holiday.findUnique({ where: { id: holidayId } });
  if (!holiday) throw new HttpError(404, "Holiday not found.", "NOT_FOUND");
  const ids = [...new Set(locationIds)];
  if (ids.length) {
    const found = await prisma.location.count({ where: { id: { in: ids } } });
    if (found !== ids.length) throw new HttpError(400, "One of those locations does not exist.", "VALIDATION_ERROR");
  }
  const before = await prisma.holidayLocationScope.findFirst({ where: { holidayId }, orderBy: { createdAt: "desc" } });
  const row = await prisma.holidayLocationScope.create({ data: { holidayId, locationIds: ids, reason: reason.trim(), setByUserId: viewer.userId } });
  await writeAuditLog({ ...meta, action: "leave.holiday.locations", entityType: "Holiday", entityId: holidayId, before: { locationIds: before?.locationIds ?? [] }, after: { locationIds: ids, reason: row.reason } });
  await requestRecomputeForEveryone([holiday.date]);
  return { holidayId, locationIds: ids, everyone: ids.length === 0 };
}

export async function holidayLocations(holidayIds: string[]) {
  const rows = await prisma.holidayLocationScope.findMany({ where: { holidayId: { in: holidayIds } }, orderBy: { createdAt: "asc" } });
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.holidayId, r.locationIds);
  return out;
}

export interface NewWeekendOverride {
  fromDate: string;
  toDate: string;
  weekOffPatternId: string;
  employeeIds?: string[];
  segmentId?: string | null;
  reason: string;
}

async function inScope(viewer: ParityViewer, ids: string[]) {
  if (viewer.dataScope === "ALL") return;
  const where = await buildEmployeeScopeWhere(viewer.employeeId, viewer.dataScope);
  const n = await prisma.employee.count({ where: { AND: [where, { id: { in: ids } }] } });
  if (n !== ids.length) throw new HttpError(404, "Employee not found.", "NOT_FOUND");
}

export async function createWeekendOverride(viewer: ParityViewer, input: NewWeekendOverride, meta: ParityMeta) {
  if (!viewer.permissions.has("attendance.config.manage")) throw new HttpError(403, "Missing permission: attendance.config.manage", "FORBIDDEN");
  if (input.fromDate > input.toDate) throw new HttpError(400, "The range ends before it starts.", "VALIDATION_ERROR");
  const pattern = await prisma.weekOffPattern.findUnique({ where: { id: input.weekOffPatternId } });
  if (!pattern || !pattern.isActive) throw new HttpError(400, "Choose an active week-off pattern.", "VALIDATION_ERROR");
  let ids = [...new Set(input.employeeIds ?? [])];
  let segmentName: string | null = null;
  if (input.segmentId) {
    ids = await resolveSegmentEmployeeIds(input.segmentId, viewer);
    segmentName = (await prisma.employeeSegment.findUnique({ where: { id: input.segmentId }, select: { name: true } }))?.name ?? null;
  }
  if (ids.length === 0) throw new HttpError(400, "Choose the people (a list or a saved segment).", "VALIDATION_ERROR");
  if (ids.includes(viewer.employeeId)) throw new HttpError(403, "You can't change your own week-offs. Another administrator does it.", "OWN_ATTENDANCE");
  await inScope(viewer, ids);
  const row = await prisma.weekendOverride.create({ data: { fromDate: day(input.fromDate), toDate: day(input.toDate), weekOffPatternId: pattern.id, employeeIds: ids, segmentName, reason: input.reason.trim(), createdByUserId: viewer.userId } });
  await writeAuditLog({ ...meta, action: "attendance.weekend_override.created", entityType: "WeekendOverride", entityId: row.id, after: { fromDate: input.fromDate, toDate: input.toDate, pattern: pattern.code, people: ids.length, segmentName, reason: row.reason } });
  await requestRecomputeRange(ids, row.fromDate, row.toDate);
  return weekendView(row, pattern.name);
}

export async function voidWeekendOverride(viewer: ParityViewer, id: string, reason: string, meta: ParityMeta) {
  if (!viewer.permissions.has("attendance.config.manage")) throw new HttpError(403, "Missing permission: attendance.config.manage", "FORBIDDEN");
  const row = await prisma.weekendOverride.findUnique({ where: { id }, include: { weekOffPattern: true } });
  if (!row) throw new HttpError(404, "Weekend override not found.", "NOT_FOUND");
  await inScope(viewer, row.employeeIds);
  if (row.voidedAt) throw new HttpError(409, "This weekend override is already void.", "ALREADY_VOID");
  const updated = await prisma.weekendOverride.update({ where: { id }, data: { voidedAt: new Date(), voidedByUserId: viewer.userId, voidReason: reason.trim() } });
  await writeAuditLog({ ...meta, action: "attendance.weekend_override.voided", entityType: "WeekendOverride", entityId: id, after: { reason: updated.voidReason } });
  await requestRecomputeRange(row.employeeIds, row.fromDate, row.toDate);
  return weekendView(updated, row.weekOffPattern.name);
}

function weekendView(r: { id: string; fromDate: Date; toDate: Date; employeeIds: string[]; segmentName: string | null; reason: string; createdAt: Date; voidedAt: Date | null; voidReason: string | null }, patternName: string) {
  return { id: r.id, fromDate: iso(r.fromDate), toDate: iso(r.toDate), pattern: patternName, people: r.employeeIds.length, segmentName: r.segmentName, reason: r.reason, createdAt: r.createdAt.toISOString(), voidedAt: r.voidedAt?.toISOString() ?? null, voidReason: r.voidReason };
}

export async function listWeekendOverrides(viewer: ParityViewer) {
  if (!viewer.permissions.has("attendance.config.manage")) throw new HttpError(403, "Missing permission: attendance.config.manage", "FORBIDDEN");
  const rows = await prisma.weekendOverride.findMany({ orderBy: { createdAt: "desc" }, take: 500, include: { weekOffPattern: { select: { name: true } } } });
  let visible = rows;
  if (viewer.dataScope !== "ALL") {
    const where = await buildEmployeeScopeWhere(viewer.employeeId, viewer.dataScope);
    const ok = new Set((await prisma.employee.findMany({ where, select: { id: true } })).map((e) => e.id));
    visible = rows.filter((r) => r.employeeIds.every((id) => ok.has(id)));
  }
  return { overrides: visible.map((r) => weekendView(r, r.weekOffPattern.name)) };
}
