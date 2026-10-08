import { z } from "zod";

// Biometric ingestion (Phase 2 commit P2-B, docs/plans/PHASE_2.md §2.2, §3).

export const MAX_AGENT_BATCH_LINES = 1000;

export const idParamsSchema = z.object({ id: z.string().min(1) });

// ── The sync agent's API ──
export const agentPunchesSchema = z.object({
  device: z.string().trim().min(1).max(64), // the device's serial number
  lines: z.array(z.string().max(500)).min(1).max(MAX_AGENT_BATCH_LINES), // ATTLOG lines, exactly as the device records them
});
export const agentHeartbeatSchema = z.object({
  version: z.string().trim().max(50),
  host: z.string().trim().max(200),
  devices: z
    .array(
      z
        .object({
          device: z.string().trim().min(1).max(64),
          reachable: z.boolean(),
        })
        .passthrough(), // cursor, lag, clock offset, retention state — kept as reported (P2-F/P2-H)
    )
    .max(100),
}).passthrough();

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
});
export const createDeviceSchema = deviceFields.extend({
  timezone: timezone.default("Asia/Kolkata"),
  route: z.enum(["AGENT", "PUSH"]).default("AGENT"),
  isSimulated: z.boolean().default(false),
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
export const resolveFlagSchema = z.object({ decision: z.enum(["ACCEPTED", "DISCARDED"]), reason: z.string().trim().min(1).max(500) });

// ── Admin: emergency file upload (Import Center → Punches (ATTLOG)) ──
export const importPreviewBodySchema = z.object({ deviceId: z.string().min(1) });
export const importCommitSchema = z.object({ reason: z.string().trim().min(5, "Say why the emergency upload was needed").max(500) });
