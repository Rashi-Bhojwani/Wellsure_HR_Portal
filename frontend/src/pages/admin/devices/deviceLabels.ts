import dayjs from "dayjs";
import type { QueryClient } from "@tanstack/react-query";
import type { HealthStatus, IncidentKind } from "../../../api/biometric";
import type { ChipTone } from "../../../ui";

// Words and tones for the Devices screen (Phase 2 P2-B/F/H). Every status is a word; the tone only reinforces it.

export const when = (val: string | null) => (val ? dayjs(val).format("D MMM YYYY, HH:mm") : "—");

/** Everything on this screen lives under ["biometric"]; the device.status socket event invalidates the same key. */
export const invalidateBiometric = (qc: QueryClient) => void qc.invalidateQueries({ queryKey: ["biometric"] });

export const HEALTH: Record<HealthStatus, { tone: ChipTone; label: string; tip: string }> = {
  ONLINE: { tone: "success", label: "Online", tip: "Heard from recently, with nothing open against it." },
  SILENT: { tone: "danger", label: "Gone quiet", tip: "No successful contact for the set time during working hours. See Incidents." },
  AGENT_OFFLINE: { tone: "danger", label: "Agent offline", tip: "The sync agent that reads it has stopped reporting, so nothing from it can arrive. See Incidents." },
  NOT_CONNECTED: { tone: "neutral", label: "Not connected yet", tip: "Nothing has ever come from it. No alert is raised for something that has never worked; connect it (INSTALL.md) and it is watched from then on." },
  ATTENTION: { tone: "warning", label: "Needs attention", tip: "Reachable, but something is open against it (no punches today, clock, or log). See Incidents." },
};

export const KIND_LABEL: Record<IncidentKind, string> = {
  DEVICE_SILENT: "Device gone quiet",
  AGENT_SILENT: "Agent stopped reporting",
  NO_PUNCHES_TODAY: "No punches today",
  CLOCK_DRIFT: "Clock wrong",
  RETENTION_RISK: "Punches at risk on the device",
};

export const REPORT_STATE: Record<string, { tone: ChipTone; label: string }> = {
  OK: { tone: "success", label: "Read OK" },
  NOT_YET_READ: { tone: "neutral", label: "Not read yet" },
  UNREACHABLE: { tone: "danger", label: "Unreachable" },
  SERIAL_MISMATCH: { tone: "danger", label: "Wrong device at that address" },
  AUTH_FAILED: { tone: "danger", label: "Comm key refused" },
  NOT_ASSIGNED: { tone: "warning", label: "Not assigned to the agent" },
  UNSUPPORTED_FORMAT: { tone: "danger", label: "Record layout not supported" },
  CONFIG_REFUSED: { tone: "danger", label: "Configuration refused" },
};

export const ROUTE_LABEL: Record<string, string> = { AGENT: "Agent", PUSH: "ADMS push", IMPORT: "File upload" };

export const FLAG_LABEL: Record<string, string> = { FUTURE: "In the future", TOO_OLD: "Too old" };

export const DEVICE_TABS = ["devices", "agents", "incidents", "volume", "unmapped", "flagged", "batches"] as const;
export type DeviceTab = (typeof DEVICE_TABS)[number];
