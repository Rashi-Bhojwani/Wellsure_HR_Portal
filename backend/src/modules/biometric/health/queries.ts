import type { DeviceIncident, DeviceIncidentKind } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { humanDuration, openedMessage, type IncidentFacts } from "./messages";

// What the Devices screen reads about health (docs/plans/PHASE_2.md "P2-H build design").

/**
 * At a glance, from the open incidents: an agent that has stopped reporting
 * explains everything behind it, so its devices read "agent offline" rather
 * than each looking separately broken.
 */
export type HealthStatus = "ONLINE" | "SILENT" | "AGENT_OFFLINE" | "ATTENTION" | "NOT_CONNECTED";

export function statusOf(kinds: DeviceIncidentKind[], agentOffline: boolean, neverHeardFrom = false): HealthStatus {
  if (agentOffline || kinds.includes("AGENT_SILENT")) return "AGENT_OFFLINE";
  if (kinds.includes("DEVICE_SILENT")) return "SILENT";
  if (kinds.length) return "ATTENTION";
  return neverHeardFrom ? "NOT_CONNECTED" : "ONLINE";
}

export async function openIncidentKindsBySubject(): Promise<{ byDevice: Map<string, DeviceIncidentKind[]>; byAgent: Map<string, DeviceIncidentKind[]> }> {
  const open = await prisma.deviceIncident.findMany({ where: { resolvedAt: null }, select: { kind: true, deviceId: true, agentId: true } });
  const byDevice = new Map<string, DeviceIncidentKind[]>();
  const byAgent = new Map<string, DeviceIncidentKind[]>();
  for (const i of open) {
    if (i.deviceId) byDevice.set(i.deviceId, [...(byDevice.get(i.deviceId) ?? []), i.kind]);
    if (i.agentId) byAgent.set(i.agentId, [...(byAgent.get(i.agentId) ?? []), i.kind]);
  }
  return { byDevice, byAgent };
}

export interface IncidentRow {
  id: string;
  kind: DeviceIncidentKind;
  deviceId: string | null;
  agentId: string | null;
  subject: string;
  branch: string | null;
  openedAt: string;
  resolvedAt: string | null;
  /** How long it lasted, or has lasted so far. */
  duration: string;
  isOpen: boolean;
  headline: string;
  detail: string;
  escalatedAt: string | null;
  recovery: { arrivedPunches: number | null; expectedWithoutPunch: number | null } | null;
}

export async function listIncidents(q: { state: "open" | "all"; deviceId?: string; agentId?: string; limit: number }, now: Date = new Date()): Promise<IncidentRow[]> {
  const rows = await prisma.deviceIncident.findMany({
    where: { ...(q.state === "open" ? { resolvedAt: null } : {}), ...(q.deviceId ? { deviceId: q.deviceId } : {}), ...(q.agentId ? { agentId: q.agentId } : {}) },
    orderBy: [{ resolvedAt: { sort: "asc", nulls: "first" } }, { openedAt: "desc" }],
    take: q.limit,
    include: { device: { select: { name: true, location: { select: { name: true } } } }, agent: { select: { name: true, devices: { where: { isActive: true }, select: { location: { select: { name: true } } } } } } },
  });
  return rows.map((i: DeviceIncident & { device: { name: string; location: { name: string } } | null; agent: { name: string; devices: Array<{ location: { name: string } }> } | null }) => {
    const subject = i.device?.name ?? i.agent?.name ?? "";
    const branch = i.device?.location.name ?? (i.agent ? [...new Set(i.agent.devices.map((d) => d.location.name))].join(", ") || null : null);
    const facts: IncidentFacts = { kind: i.kind, subject, branch, openedAt: i.openedAt, lastContactAt: i.lastContactAt, details: i.details as Record<string, unknown> };
    const m = openedMessage(facts);
    const summary = i.recoverySummary as { arrivedPunches?: number | null; expectedWithoutPunch?: number | null } | null;
    return {
      id: i.id,
      kind: i.kind,
      deviceId: i.deviceId,
      agentId: i.agentId,
      subject,
      branch,
      openedAt: i.openedAt.toISOString(),
      resolvedAt: i.resolvedAt?.toISOString() ?? null,
      duration: humanDuration((i.resolvedAt ?? now).getTime() - (i.lastContactAt ?? i.openedAt).getTime()),
      isOpen: !i.resolvedAt,
      headline: m.title,
      detail: m.body,
      escalatedAt: i.escalatedAt?.toISOString() ?? null,
      recovery: summary ? { arrivedPunches: summary.arrivedPunches ?? null, expectedWithoutPunch: summary.expectedWithoutPunch ?? null } : null,
    };
  });
}

export interface VolumeBucket {
  /** IST: "YYYY-MM-DD HH:00" (hourly) or "YYYY-MM-DD" (daily). */
  bucket: string;
  route: "AGENT" | "PUSH" | "IMPORT";
  punches: number;
  batches: number;
}

/**
 * Ingestion volume (spec §4.7): new punches stored, by hour for today or by day
 * for the last 30, per route, for one device or all. From the batches, which are
 * kept for every upload, so it costs one grouped query.
 */
export async function ingestionVolume(q: { scope: "today" | "30d"; deviceId?: string }, now: Date = new Date()): Promise<{ scope: string; buckets: VolumeBucket[] }> {
  const istNow = new Date(now.getTime() + 330 * 60_000);
  const today = istNow.toISOString().slice(0, 10);
  const from = q.scope === "today" ? `${today}T00:00:00Z` : `${new Date(Date.parse(`${today}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10)}T00:00:00Z`;
  const fromInstant = new Date(Date.parse(from) - 330 * 60_000);
  const trunc = q.scope === "today" ? "hour" : "day";
  const fmt = q.scope === "today" ? "YYYY-MM-DD HH24:00" : "YYYY-MM-DD";
  const rows = await prisma.$queryRawUnsafe<Array<{ bucket: string; route: string; punches: number; batches: number }>>(
    `SELECT to_char(date_trunc('${trunc}', (received_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata'), '${fmt}') AS bucket, route::text AS route, COALESCE(SUM(new_count), 0)::int AS punches, COUNT(*)::int AS batches
     FROM ingestion_batches WHERE status = 'COMMITTED' AND received_at >= $1 ${q.deviceId ? "AND device_id = $2" : ""}
     GROUP BY 1, 2 ORDER BY 1, 2`,
    ...(q.deviceId ? [fromInstant, q.deviceId] : [fromInstant]),
  );
  return { scope: q.scope, buckets: rows.map((r) => ({ bucket: r.bucket, route: r.route as VolumeBucket["route"], punches: r.punches, batches: r.batches })) };
}
