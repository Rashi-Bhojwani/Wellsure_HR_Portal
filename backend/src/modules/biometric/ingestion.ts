import type { Device, PunchFlag, PunchRoute } from "@prisma/client";
import { localDate, localTimeToInstant, parseAttlog, type AttlogLine, type AttlogRejected } from "@shared/attendance/attlog";
import { prisma } from "../../lib/prisma";
import { punchPlausibility } from "../../lib/attendanceSettings";
import { employeesForDeviceUsersOn } from "../../lib/effectiveDating";
import { emitPunchesReceived } from "../../realtime/emit";
import { requestRecompute } from "../attendance/recompute";

// THE ingestion service (docs/plans/PHASE_2.md §3). Every route — the sync
// agent, ADMS push, the emergency file upload — turns its wire format into
// ATTLOG lines and calls this; nothing else writes raw_punches. It parses,
// resolves the device's timezone, flags implausible times, drops exact
// duplicates by the unique key (so retries and overlapping files are
// idempotent), resolves the employee through the device mapping in force on
// the punch's date (EF4), records the batch, and asks for recompute.

export interface PlannedPunch extends AttlogLine {
  lineNumber: number;
  punchedAt: Date;
  businessDate: Date;
  employeeId: string | null;
  flag: PunchFlag | null;
  /** Repeated earlier in this same batch (the exact-duplicate layer, within the batch). */
  repeatInBatch: boolean;
}

export interface Analysis {
  planned: PlannedPunch[];
  rejected: AttlogRejected[];
}

const key = (deviceUserId: string, punchedAt: Date) => `${deviceUserId}|${punchedAt.toISOString()}`;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Parse and classify a batch without writing anything (also the file-upload preview). */
export async function analyse(device: Pick<Device, "timezone">, text: string, now: Date = new Date()): Promise<Analysis> {
  const { lines, rejected } = parseAttlog(text);
  const { futureToleranceMinutes, maxPunchAgeDays } = await punchPlausibility();
  const futureLimit = now.getTime() + futureToleranceMinutes * 60_000;
  const pastLimit = now.getTime() - maxPunchAgeDays * 86_400_000;
  const seen = new Set<string>();
  const withTimes = lines.map((l) => {
    const punchedAt = localTimeToInstant(l.localTime, device.timezone);
    const businessDate = localDate(l.localTime);
    const k = key(l.deviceUserId, punchedAt);
    const repeatInBatch = seen.has(k);
    seen.add(k);
    const flag: PunchFlag | null = punchedAt.getTime() > futureLimit ? "FUTURE" : punchedAt.getTime() < pastLimit ? "TOO_OLD" : null;
    return { ...l, punchedAt, businessDate, flag, repeatInBatch };
  });
  const owners = await employeesForDeviceUsersOn(withTimes.map((p) => ({ deviceUserId: p.deviceUserId, day: p.businessDate })));
  return {
    planned: withTimes.map((p) => ({ ...p, employeeId: owners.get(`${p.deviceUserId}|${isoDay(p.businessDate)}`) ?? null })),
    rejected,
  };
}

export interface IngestCounts {
  totalLines: number;
  newCount: number;
  duplicateCount: number;
  unmappedCount: number;
  rejectedCount: number;
  flaggedCount: number;
}

export interface IngestResult extends IngestCounts {
  batchId: string;
  rejected: AttlogRejected[];
  /** The latest punch in the batch that is now stored (new or already there) — the agent advances its cursor to this, only on success. */
  highestPunchedAt: string | null;
  highestLocalTime: string | null;
}

export interface IngestInput {
  route: PunchRoute;
  device: Device;
  text: string;
  agentId?: string | null;
  uploadedByUserId?: string | null;
  fileName?: string | null;
  reason?: string | null;
  /** Commit an IMPORT preview: that batch becomes the committed one. */
  previewBatchId?: string;
  now?: Date;
}

const MAX_KEPT_REJECTED = 1000;

export async function ingest(input: IngestInput): Promise<IngestResult> {
  const now = input.now ?? new Date();
  const { planned, rejected } = await analyse(input.device, input.text, now);
  const fresh = planned.filter((p) => !p.repeatInBatch);

  const { batchId, inserted, counts } = await prisma.$transaction(async (tx) => {
    const batchData = {
      route: input.route,
      status: "COMMITTED" as const,
      deviceId: input.device.id,
      agentId: input.agentId ?? null,
      uploadedByUserId: input.uploadedByUserId ?? null,
      fileName: input.fileName ?? null,
      reason: input.reason ?? null,
      committedAt: now,
      pendingText: null,
    };
    const batch = input.previewBatchId
      ? await tx.ingestionBatch.update({ where: { id: input.previewBatchId }, data: batchData })
      : await tx.ingestionBatch.create({ data: batchData });
    const inserted = fresh.length
      ? await tx.rawPunch.createManyAndReturn({
          data: fresh.map((p) => ({
            deviceId: input.device.id,
            deviceUserId: p.deviceUserId,
            punchedAt: p.punchedAt,
            localTime: p.localTime,
            businessDate: p.businessDate,
            status: p.status,
            verifyMode: p.verifyMode,
            workcode: p.workcode,
            reserved: p.reserved,
            rawLine: p.raw,
            route: input.route,
            batchId: batch.id,
            employeeId: p.employeeId,
            flag: p.flag,
          })),
          skipDuplicates: true,
          select: { id: true, deviceUserId: true, punchedAt: true, employeeId: true, flag: true, businessDate: true },
        })
      : [];
    const counts: IngestCounts = {
      totalLines: planned.length + rejected.length,
      newCount: inserted.length,
      duplicateCount: planned.length - inserted.length,
      unmappedCount: inserted.filter((p) => !p.employeeId).length,
      rejectedCount: rejected.length,
      flaggedCount: inserted.filter((p) => p.flag).length,
    };
    await tx.ingestionBatch.update({ where: { id: batch.id }, data: { ...counts, rejectedLines: rejected.slice(0, MAX_KEPT_REJECTED) as never } });
    const latestNew = inserted.filter((p) => !p.flag).reduce<Date | null>((m, p) => (!m || p.punchedAt > m ? p.punchedAt : m), null);
    await tx.device.update({
      where: { id: input.device.id },
      data: { lastReceivedAt: now, ...(latestNew && (!input.device.lastPunchAt || latestNew > input.device.lastPunchAt) ? { lastPunchAt: latestNew } : {}) },
    });
    return { batchId: batch.id, inserted, counts };
  });

  // Recompute every employee-day the new (plausible) punches touch, in punch order.
  const usable = inserted.filter((p) => p.employeeId && !p.flag).sort((a, b) => a.punchedAt.getTime() - b.punchedAt.getTime());
  await requestRecompute(usable.map((p) => ({ employeeId: p.employeeId!, date: p.businessDate })));
  emitPunchesReceived(usable.map((p) => ({ employeeId: p.employeeId!, punchedAt: p.punchedAt.toISOString(), deviceId: input.device.id, locationId: input.device.locationId })));

  const highest = planned.reduce<PlannedPunch | null>((m, p) => (!m || p.punchedAt > m.punchedAt ? p : m), null);
  return {
    batchId,
    ...counts,
    rejected,
    highestPunchedAt: highest ? highest.punchedAt.toISOString() : null,
    highestLocalTime: highest ? highest.localTime : null,
  };
}

/**
 * What committing an uploaded file would do, counted against what's stored
 * now (docs/plans/PHASE_2.md §3 "File upload": upload → preview → commit).
 */
export async function previewCounts(device: Device, text: string, now: Date = new Date()): Promise<IngestCounts & { rejected: AttlogRejected[]; sample: Array<{ lineNumber: number; deviceUserId: string; localTime: string; outcome: string }> }> {
  const { planned, rejected } = await analyse(device, text, now);
  const times = planned.map((p) => p.punchedAt.getTime());
  const existing = planned.length
    ? await prisma.rawPunch.findMany({
        where: { deviceId: device.id, punchedAt: { gte: new Date(Math.min(...times)), lte: new Date(Math.max(...times)) } },
        select: { deviceUserId: true, punchedAt: true },
      })
    : [];
  const stored = new Set(existing.map((e) => key(e.deviceUserId, e.punchedAt)));
  const outcome = (p: PlannedPunch) =>
    p.repeatInBatch || stored.has(key(p.deviceUserId, p.punchedAt)) ? "duplicate" : p.flag ? `new, flagged ${p.flag === "FUTURE" ? "(in the future)" : "(too old)"}` : p.employeeId ? "new" : "new, unmapped";
  const fresh = planned.filter((p) => !p.repeatInBatch && !stored.has(key(p.deviceUserId, p.punchedAt)));
  return {
    totalLines: planned.length + rejected.length,
    newCount: fresh.length,
    duplicateCount: planned.length - fresh.length,
    unmappedCount: fresh.filter((p) => !p.employeeId).length,
    rejectedCount: rejected.length,
    flaggedCount: fresh.filter((p) => p.flag).length,
    rejected,
    sample: planned.slice(0, 200).map((p) => ({ lineNumber: p.lineNumber, deviceUserId: p.deviceUserId, localTime: p.localTime, outcome: outcome(p) })),
  };
}
