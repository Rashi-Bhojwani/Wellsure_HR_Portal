import { z } from "zod";
import { DEVICE_REPORT_STATES, MAX_AGENT_BATCH_LINES, MAX_AGENT_REPORTED_DEVICES, RETENTION_STATES } from "@shared/attendance/agentProtocol";

// Biometric ingestion (Phase 2 commit P2-B, docs/plans/PHASE_2.md §2.2, §3).
// The agent's wire contract lives in shared/attendance/agentProtocol.ts (P2-F).

export { MAX_AGENT_BATCH_LINES };

export const idParamsSchema = z.object({ id: z.string().min(1) });

// ── The sync agent's API ──
export const agentPunchesSchema = z.object({
  device: z.string().trim().min(1).max(64), // the device's serial number
  lines: z.array(z.string().max(500)).min(1).max(MAX_AGENT_BATCH_LINES), // ATTLOG lines, exactly as the device records them
});
// The heartbeat (P2-F). Only the device and its reachability are required:
// an agent a version older or newer than the server still gets through, and
// whatever it reports is kept as reported.
const retentionReportSchema = z
  .object({
    state: z.enum(RETENTION_STATES),
    gapHours: z.number().min(0).nullable(),
    windowHours: z.number().min(0),
    logFullPercent: z.number().min(0).nullable(),
    logNearlyFull: z.boolean(),
    capacityUsed: z.number().min(0).nullable(),
  })
  .partial()
  .passthrough();
const deviceReportSchema = z
  .object({
    device: z.string().trim().min(1).max(64),
    reachable: z.boolean(),
    state: z.enum(DEVICE_REPORT_STATES).optional(),
    lastReadAt: z.iso.datetime({ offset: true }).nullable().optional(),
    secondsSinceLastRead: z.number().min(0).nullable().optional(),
    lastError: z.string().max(1000).nullable().optional(),
    reportedSerial: z.string().max(64).nullable().optional(),
    firmware: z.string().max(100).nullable().optional(),
    platform: z.string().max(100).nullable().optional(),
    logCount: z.number().int().min(0).nullable().optional(),
    logCapacity: z.number().int().min(0).nullable().optional(),
    clockOffsetSeconds: z.number().nullable().optional(),
    outboxRecords: z.number().int().min(0).optional(),
    oldestUnsentLocalTime: z.string().max(25).nullable().optional(),
    retention: retentionReportSchema.optional(),
  })
  .passthrough();
export const agentHeartbeatSchema = z
  .object({
    version: z.string().trim().max(50),
    host: z.string().trim().max(200),
    startedAt: z.iso.datetime({ offset: true }).optional(),
    outboxRecords: z.number().int().min(0).optional(),
    lastPostAt: z.iso.datetime({ offset: true }).nullable().optional(),
    lastPostError: z.string().max(1000).nullable().optional(),
    pcClockOffsetSeconds: z.number().nullable().optional(),
    quarantinedBatches: z.number().int().min(0).optional(),
    devices: z.array(deviceReportSchema).max(MAX_AGENT_REPORTED_DEVICES),
  })
  .passthrough();
export type AgentHeartbeatBody = z.infer<typeof agentHeartbeatSchema>;
export type AgentDeviceReportBody = z.infer<typeof deviceReportSchema>;

// ── Admin: devices and agents ──
const timezone = z.string().trim().refine((tz) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, "Not a known timezone, e.g. Asia/Kolkata");

// No defaults here: an update must change only what it names (Zod keeps a
// field's .default() through .partial(), which would silently reset it).
const deviceFields = z.object({
  serialNumber: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(100),
  locationId: z.string().min(1),
  timezone,
  model: z.string().trim().max(100).nullable().optional(),
  firmware: z.string().trim().max(100).nullable().optional(),
  route: z.enum(["AGENT", "PUSH"]),
  agentId: z.string().min(1).nullable().optional(),
  lanIp: z.string().trim().max(64).nullable().optional(),
  isSimulated: z.boolean(),
  // P2-F: the agent never sends a punch dated before syncFrom (default: the
  // day the device is registered); retention is pessimistic until the model
  // is known.
  syncFrom: z.iso.date(),
  retentionDays: z.number().int().min(1).max(365),
  retentionRecords: z.number().int().min(100).max(10_000_000),
});
export const createDeviceSchema = deviceFields.extend({
  timezone: timezone.default("Asia/Kolkata"),
  route: z.enum(["AGENT", "PUSH"]).default("AGENT"),
  isSimulated: z.boolean().default(false),
  syncFrom: z.iso.date().optional(), // the service defaults it to today (IST)
  retentionDays: z.number().int().min(1).max(365).optional(),
  retentionRecords: z.number().int().min(100).max(10_000_000).optional(),
});
export const updateDeviceSchema = deviceFields.omit({ serialNumber: true }).partial().extend({ isActive: z.boolean().optional() });

export const createAgentSchema = z.object({ name: z.string().trim().min(1).max(100) });
export const updateAgentSchema = z.object({ name: z.string().trim().min(1).max(100).optional(), isActive: z.boolean().optional() });

// ── Admin: queues ──
export const batchesQuerySchema = z.object({ deviceId: z.string().min(1).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });
export const mapUnmappedSchema = z.object({
  deviceUserId: z.string().trim().min(1).max(30),
  employeeId: z.string().min(1),
  effectiveFrom: z.iso.date().optional(), // default: the first unmapped punch's date (not before joining)
});
// Flagged punches: filter the list, preview a bulk accept, and confirm it (P2-J, docs/plans/PHASE_2.md "P2-J", D).
const flaggedFilterFields = {
  deviceId: z.string().min(1).optional(),
  flag: z.enum(["FUTURE", "TOO_OLD"]).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
};
export const flaggedQuerySchema = z.object(flaggedFilterFields);
const flaggedSelection = z
  .object({ ids: z.array(z.string().min(1)).min(1).max(2000).optional(), filter: z.object(flaggedFilterFields).optional() })
  .refine((s) => (s.ids ? 1 : 0) + (s.filter && Object.values(s.filter).some((v) => v !== undefined) ? 1 : 0) === 1, {
    message: "Choose punches by ticking them, or by a filter (device, reason, dates) — one or the other.",
  });
export const bulkAcceptPreviewSchema = flaggedSelection;
export const bulkAcceptSchema = z.intersection(
  flaggedSelection,
  z.object({ fingerprint: z.string().regex(/^[0-9a-f]{64}$/), reason: z.string().trim().min(5, "Say why these punches are right").max(500), confirm: z.literal(true) }),
);
export const resolveFlagSchema = z.object({ decision: z.enum(["ACCEPTED", "DISCARDED"]), reason: z.string().trim().min(1).max(500) });

// ── Admin: emergency file upload (Import Center → Punches (ATTLOG)) ──
export const importPreviewBodySchema = z.object({ deviceId: z.string().min(1) });
export const importCommitSchema = z.object({ reason: z.string().trim().min(5, "Say why the emergency upload was needed").max(500) });

// ── Admin: health (P2-H) ──
export const incidentsQuerySchema = z.object({
  state: z.enum(["open", "all"]).default("all"),
  deviceId: z.string().min(1).optional(),
  agentId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const volumeQuerySchema = z.object({ scope: z.enum(["today", "30d"]).default("today"), deviceId: z.string().min(1).optional() });
