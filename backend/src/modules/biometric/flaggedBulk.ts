import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PunchFlag } from "@prisma/client";
import { writeAuditLogs } from "../../lib/audit";
import { namesOn } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { requestRecompute } from "../attendance/recompute";
import type { Meta } from "./adminService";

// Bulk accept for flagged punches (docs/plans/PHASE_2.md "P2-J", D). When a device's clock or a long backlog goes wrong,
// flagged punches arrive for a whole branch at once and deciding them one at a time is not workable. The rules that
// keep it safe: HR sees exactly what would be accepted (preview), confirms it with a reason, the confirmation only
// applies to the set that was previewed (a fingerprint of the exact ids), and every punch gets its own audit row.

export const MAX_BULK_ACCEPT = 2000;

export interface FlaggedFilter {
  deviceId?: string;
  flag?: PunchFlag;
  from?: string;
  to?: string;
}
export type FlaggedSelection = { ids?: string[]; filter?: FlaggedFilter };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);

/** Unresolved flagged punches matching the filter (the same one the list uses), oldest first. */
export function flaggedWhere(filter: FlaggedFilter = {}, ids?: string[]): Prisma.RawPunchWhereInput {
  return {
    flag: filter.flag ?? { not: null },
    flagResolution: null,
    ...(ids ? { id: { in: ids } } : {}),
    ...(filter.deviceId ? { deviceId: filter.deviceId } : {}),
    ...(filter.from || filter.to ? { businessDate: { ...(filter.from ? { gte: day(filter.from) } : {}), ...(filter.to ? { lte: day(filter.to) } : {}) } } : {}),
  };
}

/** The punches to decide, leaving out the actor's own: someone else decides those. `own` counts what was left out. */
async function selectPunches(selection: FlaggedSelection, actorEmployeeId?: string | null) {
  const where = flaggedWhere(selection.filter, selection.ids);
  const own = actorEmployeeId ? await prisma.rawPunch.count({ where: { ...where, employeeId: actorEmployeeId } }) : 0;
  const rows = await prisma.rawPunch.findMany({
    where: actorEmployeeId ? { ...where, OR: [{ employeeId: null }, { employeeId: { not: actorEmployeeId } }] } : where,
    orderBy: [{ punchedAt: "asc" }, { id: "asc" }],
    take: MAX_BULK_ACCEPT + 1,
    include: { device: { select: { id: true, name: true } } },
  });
  if (rows.length > MAX_BULK_ACCEPT) {
    throw new HttpError(400, `That is more than ${MAX_BULK_ACCEPT} punches at once. Narrow it by device, reason or dates, and accept in parts.`, "TOO_MANY");
  }
  return { rows, own };
}

/** A fingerprint of exactly these punches: the confirmation is only good for the set that was shown. */
export const fingerprintOf = (ids: string[]): string => createHash("sha256").update([...ids].sort().join(",")).digest("hex");

const tally = <T>(items: T[], key: (t: T) => string) => {
  const m = new Map<string, number>();
  for (const i of items) m.set(key(i), (m.get(key(i)) ?? 0) + 1);
  return m;
};

export async function previewBulkAccept(selection: FlaggedSelection, actorEmployeeId?: string | null) {
  const { rows, own } = await selectPunches(selection, actorEmployeeId);
  const names = await namesOn([...new Set(rows.flatMap((r) => (r.employeeId ? [r.employeeId] : [])))], new Date());
  const mappedDays = new Set(rows.filter((r) => r.employeeId).map((r) => `${r.employeeId}|${iso(r.businessDate)}`));
  return {
    count: rows.length,
    /** The actor's own flagged punches in this selection, left out: someone else decides them. */
    ownLeftOut: own,
    fingerprint: fingerprintOf(rows.map((r) => r.id)),
    /** Punches that belong to nobody yet: accepted, but they count only once their device ID is mapped. */
    unmappedCount: rows.filter((r) => !r.employeeId).length,
    affectedDays: mappedDays.size,
    employees: new Set(rows.flatMap((r) => (r.employeeId ? [r.employeeId] : []))).size,
    byDevice: [...tally(rows, (r) => r.device.name)].map(([device, count]) => ({ device, count })),
    byFlag: [...tally(rows, (r) => r.flag ?? "")].map(([flag, count]) => ({ flag, count })),
    byDate: [...tally(rows, (r) => iso(r.businessDate))].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count })),
    punches: rows.map((r) => ({
      id: r.id,
      device: r.device.name,
      deviceUserId: r.deviceUserId,
      localTime: r.localTime,
      flag: r.flag,
      employee: r.employeeId ? { id: r.employeeId, name: names.get(r.employeeId) ?? null } : null,
    })),
  };
}

export async function bulkAcceptFlagged(selection: FlaggedSelection, input: { fingerprint: string; reason: string }, meta: Meta) {
  const { rows } = await selectPunches(selection, meta.actorEmployeeId);
  if (rows.length === 0) throw new HttpError(409, "Nothing is waiting for a decision any more. Review the list again.", "SELECTION_CHANGED");
  if (fingerprintOf(rows.map((r) => r.id)) !== input.fingerprint) {
    throw new HttpError(409, "The list changed since you looked at it (someone decided some of these, or more arrived). Review it again before accepting.", "SELECTION_CHANGED");
  }
  const bulkId = randomUUID();
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.punchFlagResolution.createMany({ data: rows.map((r) => ({ punchId: r.id, decision: "ACCEPTED" as const, reason: input.reason, decidedByUserId: meta.actorUserId })) });
        // One audit row per punch, in the same transaction: a decision without its record cannot exist.
        await writeAuditLogs(
          rows.map((r) => ({
            ...meta,
            action: "biometric.punch.flag_accepted",
            entityType: "RawPunch",
            entityId: r.id,
            after: { decision: "ACCEPTED", reason: input.reason, flag: r.flag, localTime: r.localTime, deviceId: r.deviceId, deviceUserId: r.deviceUserId, bulkId, bulkCount: rows.length },
          })),
          tx,
        );
      },
      { timeout: 60_000 },
    );
  } catch (err) {
    // Someone decided one of them between our read and the write: the whole acceptance rolls back.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new HttpError(409, "Some of these were decided while you were confirming. Nothing was changed; review the list again.", "SELECTION_CHANGED");
    }
    throw err;
  }
  const days = new Map<string, { employeeId: string; date: Date }>();
  for (const r of rows) if (r.employeeId) days.set(`${r.employeeId}|${iso(r.businessDate)}`, { employeeId: r.employeeId, date: r.businessDate });
  await requestRecompute([...days.values()]);
  return { accepted: rows.length, bulkId, recomputedDays: days.size, unmapped: rows.filter((r) => !r.employeeId).length };
}
