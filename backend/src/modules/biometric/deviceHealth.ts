import type { BiometricAgent, Device } from "@prisma/client";
import { assessRetention, clockDriftExceeded, describeClockOffset, type DeviceHealthThresholds, type RetentionAssessment } from "@shared/attendance/agentProtocol";
import { getDeviceHealthThresholds } from "../../lib/deviceHealthSettings";
import { prisma } from "../../lib/prisma";

// What the Devices screen and Admin Home show about each agent-route device,
// from the sync agent's latest report (Phase 2 P2-F, docs/plans/PHASE_2.md
// "P2-F build design"). Worked out when it is read, not when the report
// arrived: if an agent stops reporting, its devices' last successful read
// stops moving and the retention state climbs to WARNING and RISK on its own.
// P2-H turns these into incidents with notifications and email.

export interface StoredAgentReport {
  state?: string;
  reachable?: boolean;
  lastError?: string | null;
  serverLastReadAt?: string | null;
  reportedSerial?: string | null;
  firmware?: string | null;
  platform?: string | null;
  logCount?: number | null;
  logCapacity?: number | null;
  clockOffsetSeconds?: number | null;
  outboxRecords?: number;
  oldestUnsentLocalTime?: string | null;
}

export interface DeviceHealth {
  /** The agent's latest report (null: none yet). */
  report: StoredAgentReport | null;
  reportAt: Date | null;
  /** When the agent last read the device successfully, on the server's clock. */
  lastReadAt: string | null;
  retention: RetentionAssessment | null;
  clockDrift: { offsetSeconds: number; text: string; exceeded: boolean } | null;
  /** Assigned to an agent that has reported since, but its report didn't include this device: not in that PC's config.json. */
  notConfiguredOnAgent: boolean;
}

export function deviceHealth(device: Device, agent: Pick<BiometricAgent, "lastHeartbeatAt"> | null, thresholds: DeviceHealthThresholds, now: Date): DeviceHealth {
  const report = (device.agentReport as StoredAgentReport | null) ?? null;
  const notConfiguredOnAgent =
    device.route === "AGENT" && !!agent?.lastHeartbeatAt && (!device.agentReportAt || device.agentReportAt.getTime() < agent.lastHeartbeatAt.getTime());
  if (!report || device.route !== "AGENT") {
    return { report: null, reportAt: null, lastReadAt: null, retention: null, clockDrift: null, notConfiguredOnAgent };
  }
  const lastReadAt = report.serverLastReadAt ?? null;
  const retention = assessRetention({
    lastReadAt: lastReadAt ? new Date(lastReadAt) : null,
    now,
    retentionDays: device.retentionDays,
    retentionRecords: device.retentionRecords,
    logCount: report.logCount ?? null,
    logCapacity: report.logCapacity ?? null,
    thresholds,
  });
  const offset = typeof report.clockOffsetSeconds === "number" ? report.clockOffsetSeconds : null;
  return {
    report,
    reportAt: device.agentReportAt,
    lastReadAt,
    retention,
    clockDrift: offset === null ? null : { offsetSeconds: offset, text: describeClockOffset(offset), exceeded: clockDriftExceeded(offset, thresholds) },
    notConfiguredOnAgent,
  };
}

export type DeviceWarningKind = "CLOCK_DRIFT" | "RETENTION_WARNING" | "RETENTION_RISK" | "LOG_NEARLY_FULL";

export interface DeviceWarning {
  deviceId: string;
  deviceName: string;
  serialNumber: string;
  kind: DeviceWarningKind;
  message: string;
  reportAt: string | null;
}

const hoursText = (h: number) => (h >= 48 ? `${Math.round(h / 24)} days` : `${Math.round(h)} hours`);

/** The warnings a device's report raises, worded for HR. */
export function warningsFor(device: Device, health: DeviceHealth): DeviceWarning[] {
  const base = { deviceId: device.id, deviceName: device.name, serialNumber: device.serialNumber, reportAt: health.reportAt?.toISOString() ?? null };
  const out: DeviceWarning[] = [];
  if (health.clockDrift?.exceeded) {
    out.push({
      ...base,
      kind: "CLOCK_DRIFT",
      message: `${device.name}'s clock is ${health.clockDrift.text}. Every punch on it is recorded with the wrong time until it is set correctly from the device's own menu (the system never changes it).`,
    });
  }
  const r = health.retention;
  if (r && r.state !== "OK" && r.gapHours !== null) {
    out.push({
      ...base,
      kind: r.state === "RISK" ? "RETENTION_RISK" : "RETENTION_WARNING",
      message: `${device.name} hasn't been read for ${hoursText(r.gapHours)}. Its log is assumed to hold about ${hoursText(r.windowHours)} of punches, so the oldest unread ones may be overwritten${r.state === "RISK" ? " soon" : ""}. Check the sync agent PC and its network.`,
    });
  }
  if (r?.logNearlyFull) {
    out.push({
      ...base,
      kind: "LOG_NEARLY_FULL",
      message: `${device.name}'s attendance log is ${r.logFullPercent}% full. When it is full the device either overwrites the oldest records or stops recording, depending on its setting.`,
    });
  }
  return out;
}

/** Every warning across active agent-route devices (Admin Home, the Devices screen banner). */
export async function listDeviceWarnings(now: Date = new Date()): Promise<{ warnings: DeviceWarning[]; thresholds: DeviceHealthThresholds }> {
  const [devices, thresholds] = await Promise.all([
    prisma.device.findMany({ where: { isActive: true, route: "AGENT" }, include: { agent: { select: { lastHeartbeatAt: true } } }, orderBy: { name: "asc" } }),
    getDeviceHealthThresholds(),
  ]);
  return { warnings: devices.flatMap((d) => warningsFor(d, deviceHealth(d, d.agent, thresholds, now))), thresholds };
}
