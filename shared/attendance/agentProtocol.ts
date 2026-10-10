// The sync agent ↔ API contract (docs/plans/PHASE_2.md "P2-F build design").
// Used by the backend's validators and by biometric-agent/, so the two can
// never disagree on what a heartbeat or a punches post carries. Plain types
// and pure functions only: no dependencies.

/** Most ATTLOG lines one punches post may carry. */
export const MAX_AGENT_BATCH_LINES = 1000;
/** Most devices one heartbeat may report on. */
export const MAX_AGENT_REPORTED_DEVICES = 100;

// ── Punches ──────────────────────────────────────────────────────────────

export interface AgentPunchesRequest {
  /** The device's serial number, as registered on the Devices screen. */
  device: string;
  /** ATTLOG lines exactly as the device records them (shared/attendance/attlog.ts). */
  lines: string[];
}

export interface AgentPunchesResponse {
  batchId: string;
  totalLines: number;
  newCount: number;
  duplicateCount: number;
  unmappedCount: number;
  rejectedCount: number;
  flaggedCount: number;
  rejected: Array<{ lineNumber: number; raw: string; reason: string }>;
  highestPunchedAt: string | null;
  highestLocalTime: string | null;
}

// ── Heartbeat ────────────────────────────────────────────────────────────

/**
 * How the agent last found a device:
 * - OK: read successfully;
 * - NOT_YET_READ: configured, no read attempted yet (just started);
 * - UNREACHABLE: no connection, or the read failed part-way;
 * - SERIAL_MISMATCH: the device at that address reports a different serial,
 *   so nothing was read or sent (a wrong IP would put one branch's punches on
 *   another);
 * - AUTH_FAILED: the device refused the comm key;
 * - NOT_ASSIGNED: configured on the PC, but the server doesn't assign it to
 *   this agent (or it is inactive), so it isn't polled;
 * - UNSUPPORTED_FORMAT: the device's attendance records aren't in a layout the
 *   driver reads (docs/plans/PHASE_2.md §11);
 * - CONFIG_REFUSED: the PC's configuration for it was refused (e.g. a
 *   simulated driver for a device the server says is real — P2-F rule 3).
 */
export const DEVICE_REPORT_STATES = ["OK", "NOT_YET_READ", "UNREACHABLE", "SERIAL_MISMATCH", "AUTH_FAILED", "NOT_ASSIGNED", "UNSUPPORTED_FORMAT", "CONFIG_REFUSED"] as const;
export type DeviceReportState = (typeof DEVICE_REPORT_STATES)[number];

export const RETENTION_STATES = ["OK", "WARNING", "RISK"] as const;
export type RetentionState = (typeof RETENTION_STATES)[number];

export interface AgentDeviceReport {
  /** The serial as configured on the PC. */
  device: string;
  reachable: boolean;
  state: DeviceReportState;
  /** The agent's clock, for display. */
  lastReadAt: string | null;
  /** Seconds between the last successful read and this report, on the agent's own clock — so the server can place the read on its clock even if the PC's clock is wrong. */
  secondsSinceLastRead: number | null;
  lastError: string | null;
  /** What the device itself says (null until read). */
  reportedSerial: string | null;
  firmware: string | null;
  platform: string | null;
  logCount: number | null;
  logCapacity: number | null;
  /** Device clock minus server clock, in seconds; positive = the device is ahead. */
  clockOffsetSeconds: number | null;
  /** Records read from the device and waiting in the outbox. */
  outboxRecords: number;
  oldestUnsentLocalTime: string | null;
  retention: RetentionAssessment;
}

export interface AgentHeartbeatRequest {
  version: string;
  host: string;
  startedAt: string;
  outboxRecords: number;
  lastPostAt: string | null;
  lastPostError: string | null;
  /** The PC's clock minus the server's, estimated from the last round trip. */
  pcClockOffsetSeconds: number | null;
  /** Batches the server refused as they stand, set aside on the PC for a person (never deleted). HR sees a warning while this is above 0. */
  quarantinedBatches?: number;
  devices: AgentDeviceReport[];
}

/** What the server tells the agent about each device assigned to it. */
export interface AgentDeviceConfig {
  serial: string;
  name: string;
  timezone: string;
  /** "YYYY-MM-DD": punches dated before this are never sent (D-F3). */
  syncFrom: string;
  retentionDays: number;
  retentionRecords: number;
  isSimulated: boolean;
}

export interface DeviceHealthThresholds {
  /** Percent of the retention window since the last successful read that raises a warning. */
  retentionWarningPercent: number;
  /** …and an alarm. */
  retentionAlarmPercent: number;
  /** Percent of the device's log capacity in use that counts as nearly full. */
  logNearlyFullPercent: number;
  /** A device clock further than this from the server's is a warning. */
  clockDriftWarningSeconds: number;
}

export interface AgentHeartbeatResponse {
  ok: true;
  serverTime: string;
  devices: AgentDeviceConfig[];
  thresholds: DeviceHealthThresholds;
}

// ── Defaults (until HR / the device model say otherwise) ─────────────────

/** Pessimistic until the device model is known (docs/plans/PHASE_2.md §7.1). */
export const DEFAULT_RETENTION_DAYS = 3;
export const DEFAULT_RETENTION_RECORDS = 20_000;

export const DEFAULT_DEVICE_HEALTH_THRESHOLDS: DeviceHealthThresholds = {
  retentionWarningPercent: 50,
  retentionAlarmPercent: 75,
  logNearlyFullPercent: 90,
  clockDriftWarningSeconds: 120,
};

// ── The rules, computed the same way by the agent and the server ─────────

export interface RetentionAssessment {
  state: RetentionState;
  /** Hours since the last successful read (null: never read). */
  gapHours: number | null;
  /** The retention window, in hours. */
  windowHours: number;
  /** Log count as a percent of capacity (null: unknown). */
  logFullPercent: number | null;
  logNearlyFull: boolean;
  /** The capacity used: the device's own figure when it reports one, else the configured records. */
  capacityUsed: number | null;
}

/**
 * The retention guard (docs/plans/PHASE_2.md §7.1, "P2-F build design"):
 * the time since the device was last read successfully, against its
 * retention window, gives WARNING / RISK; the log count against capacity
 * gives "nearly full" on its own threshold (P2-F rule 2). A device never read
 * yet has no gap, so it is OK until it has been read once.
 */
export function assessRetention(input: {
  lastReadAt: Date | null;
  now: Date;
  retentionDays: number;
  retentionRecords: number;
  logCount: number | null;
  logCapacity: number | null;
  thresholds: DeviceHealthThresholds;
}): RetentionAssessment {
  const windowHours = input.retentionDays * 24;
  const gapHours = input.lastReadAt ? Math.max(0, (input.now.getTime() - input.lastReadAt.getTime()) / 3_600_000) : null;
  const gapPercent = gapHours === null ? 0 : (gapHours / windowHours) * 100;
  const state: RetentionState = gapPercent >= input.thresholds.retentionAlarmPercent ? "RISK" : gapPercent >= input.thresholds.retentionWarningPercent ? "WARNING" : "OK";
  const capacityUsed = input.logCapacity && input.logCapacity > 0 ? input.logCapacity : input.retentionRecords > 0 ? input.retentionRecords : null;
  const logFullPercent = input.logCount !== null && capacityUsed ? Math.round((input.logCount / capacityUsed) * 1000) / 10 : null;
  return {
    state,
    gapHours: gapHours === null ? null : Math.round(gapHours * 10) / 10,
    windowHours,
    logFullPercent,
    logNearlyFull: logFullPercent !== null && logFullPercent >= input.thresholds.logNearlyFullPercent,
    capacityUsed,
  };
}

/** Is a device clock offset beyond the warning threshold? Never corrected automatically (P2-F rule 5). */
export function clockDriftExceeded(offsetSeconds: number | null, thresholds: DeviceHealthThresholds): boolean {
  return offsetSeconds !== null && Math.abs(offsetSeconds) > thresholds.clockDriftWarningSeconds;
}

/** "3 min 20 s ahead" / "45 s behind" — the same words on every screen and in the agent's log. */
export function describeClockOffset(offsetSeconds: number): string {
  const abs = Math.abs(Math.round(offsetSeconds));
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  const parts = h ? [`${h} h`, m ? `${m} min` : ""] : m ? [`${m} min`, s ? `${s} s` : ""] : [`${s} s`];
  const amount = parts.filter(Boolean).join(" ");
  return offsetSeconds === 0 ? "exact" : `${amount} ${offsetSeconds > 0 ? "ahead" : "behind"}`;
}
