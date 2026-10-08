import type { Announcement } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { writeAuditLog } from "../../lib/audit";
import { businessToday } from "../../lib/businessDate";
import { HttpError } from "../../middleware/errorHandler";
import type { ActorMeta } from "./types";
import { inForceOn } from "../../lib/effectiveDating";

// The Home page HR banner (spec §6), replacing greytHR's product-ad slot.
// Overlapping active windows/scopes are expected — see getActiveForEmployee
// below for the exact precedence rule.

function formatAnnouncement(row: Announcement) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    linkLabel: row.linkLabel,
    linkUrl: row.linkUrl,
    scopeLocationId: row.scopeLocationId,
    scopeDepartmentId: row.scopeDepartmentId,
    activeFrom: row.activeFrom.toISOString().slice(0, 10),
    activeTo: row.activeTo.toISOString().slice(0, 10),
    isActive: row.isActive,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

// Admin list — every row (active, paused, past, future), newest first, so
// HR can see history and toggle isActive without losing a configured date
// range.
export async function listAnnouncements() {
  const rows = await prisma.announcement.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map(formatAnnouncement);
}

export interface CreateAnnouncementInput {
  title: string;
  body: string;
  linkLabel?: string | null;
  linkUrl?: string | null;
  scopeLocationId?: string | null;
  scopeDepartmentId?: string | null;
  activeFrom: string;
  activeTo: string;
}

export async function createAnnouncement(input: CreateAnnouncementInput, meta: ActorMeta) {
  const row = await prisma.announcement.create({
    data: {
      title: input.title,
      body: input.body,
      linkLabel: input.linkLabel ?? null,
      linkUrl: input.linkUrl ?? null,
      scopeLocationId: input.scopeLocationId ?? null,
      scopeDepartmentId: input.scopeDepartmentId ?? null,
      activeFrom: new Date(input.activeFrom),
      activeTo: new Date(input.activeTo),
      createdByUserId: meta.actorUserId,
    },
  });
  await writeAuditLog({ ...meta, action: "announcement.create", entityType: "Announcement", entityId: row.id, after: formatAnnouncement(row) });
  return formatAnnouncement(row);
}

export interface UpdateAnnouncementInput {
  title?: string;
  body?: string;
  linkLabel?: string | null;
  linkUrl?: string | null;
  scopeLocationId?: string | null;
  scopeDepartmentId?: string | null;
  activeFrom?: string;
  activeTo?: string;
  isActive?: boolean;
}

export async function updateAnnouncement(id: string, input: UpdateAnnouncementInput, meta: ActorMeta) {
  const existing = await prisma.announcement.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, "Announcement not found.", "NOT_FOUND");

  const row = await prisma.announcement.update({
    where: { id },
    data: {
      ...(input.title !== undefined && { title: input.title }),
      ...(input.body !== undefined && { body: input.body }),
      ...(input.linkLabel !== undefined && { linkLabel: input.linkLabel }),
      ...(input.linkUrl !== undefined && { linkUrl: input.linkUrl }),
      ...(input.scopeLocationId !== undefined && { scopeLocationId: input.scopeLocationId }),
      ...(input.scopeDepartmentId !== undefined && { scopeDepartmentId: input.scopeDepartmentId }),
      ...(input.activeFrom !== undefined && { activeFrom: new Date(input.activeFrom) }),
      ...(input.activeTo !== undefined && { activeTo: new Date(input.activeTo) }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
    },
  });
  await writeAuditLog({ ...meta, action: "announcement.update", entityType: "Announcement", entityId: id, before: formatAnnouncement(existing), after: formatAnnouncement(row) });
  return formatAnnouncement(row);
}

export async function deleteAnnouncement(id: string, meta: ActorMeta): Promise<void> {
  const existing = await prisma.announcement.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, "Announcement not found.", "NOT_FOUND");
  await prisma.announcement.delete({ where: { id } });
  await writeAuditLog({ ...meta, action: "announcement.delete", entityType: "Announcement", entityId: id, before: formatAnnouncement(existing) });
}

// Resolves the single announcement a given employee sees on their Home
// page today, out of every currently-active, date-in-range, scope-
// matching row. Precedence, explicit rather than inferred:
//   1. Most specific scope wins — ranked by how many of
//      scopeLocationId/scopeDepartmentId are set (both-scoped > one-
//      scoped > org-wide/neither set).
//   2. Ties break on the most recent activeFrom.
// A row matches at all only if every scope column it sets equals the
// employee's own current location/department; a null scope column always
// matches (org-wide on that dimension).
export async function getActiveAnnouncementForEmployee(employeeId: string) {
  const today = businessToday();
  const jobHistory = await prisma.employeeJobHistory.findFirst({
    where: { employeeId, ...inForceOn() },
    select: { locationId: true, departmentId: true },
  });

  const locationFilter = jobHistory?.locationId
    ? { OR: [{ scopeLocationId: null }, { scopeLocationId: jobHistory.locationId }] }
    : { scopeLocationId: null };
  const departmentFilter = jobHistory?.departmentId
    ? { OR: [{ scopeDepartmentId: null }, { scopeDepartmentId: jobHistory.departmentId }] }
    : { scopeDepartmentId: null };

  const candidates = await prisma.announcement.findMany({
    where: { isActive: true, activeFrom: { lte: today }, activeTo: { gte: today }, AND: [locationFilter, departmentFilter] },
  });
  if (candidates.length === 0) return null;

  const specificity = (a: Announcement) => (a.scopeLocationId ? 1 : 0) + (a.scopeDepartmentId ? 1 : 0);
  candidates.sort((a, b) => specificity(b) - specificity(a) || b.activeFrom.getTime() - a.activeFrom.getTime());

  return formatAnnouncement(candidates[0]!);
}
