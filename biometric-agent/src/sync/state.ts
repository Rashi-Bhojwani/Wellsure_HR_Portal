import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { AgentDeviceConfig, DeviceHealthThresholds, DeviceReportState, RetentionState } from "@shared/attendance/agentProtocol";
import type { Cursor } from "./cursor";
import { writeFileDurably } from "./files";

// What the agent remembers across restarts, in <dataDir>/state.json, written
// durably after every change that matters. Above all the cursor per device,
// and the last settings the server sent — so the retention guard and the
// sync-from date keep working while the API is unreachable, which is exactly
// when they matter.

export interface DeviceState {
  cursor: Cursor | null;
  state: DeviceReportState;
  /** Last successful read, on this PC's clock. */
  lastReadAt: string | null;
  lastError: string | null;
  reportedSerial: string | null;
  firmware: string | null;
  platform: string | null;
  logCount: number | null;
  logCapacity: number | null;
  /** Device clock minus server clock, seconds. */
  clockOffsetSeconds: number | null;
  /** The last retention state logged (so a change is logged once). */
  retentionLogged: RetentionState | null;
  logNearlyFullLogged: boolean;
  driftLogged: boolean;
}

export interface AgentState {
  version: 1;
  devices: Record<string, DeviceState>;
  server: { devices: AgentDeviceConfig[]; thresholds: DeviceHealthThresholds; receivedAt: string } | null;
  /** PC clock minus server clock, from the last heartbeat. */
  pcClockOffsetSeconds: number | null;
}

export const emptyDeviceState = (): DeviceState => ({
  cursor: null,
  state: "NOT_YET_READ",
  lastReadAt: null,
  lastError: null,
  reportedSerial: null,
  firmware: null,
  platform: null,
  logCount: null,
  logCapacity: null,
  clockOffsetSeconds: null,
  retentionLogged: null,
  logNearlyFullLogged: false,
  driftLogged: false,
});

export class StateStore {
  readonly file: string;
  state: AgentState;
  private chain: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.file = path.join(dataDir, "state.json");
    this.state = existsSync(this.file) ? (JSON.parse(readFileSync(this.file, "utf8")) as AgentState) : { version: 1, devices: {}, server: null, pcClockOffsetSeconds: null };
  }

  device(serial: string): DeviceState {
    this.state.devices[serial] ??= emptyDeviceState();
    return this.state.devices[serial]!;
  }

  /** Durable, and one write at a time (several device loops share the file). */
  save(): Promise<void> {
    const snapshot = JSON.stringify(this.state, null, 2);
    this.chain = this.chain.then(() => writeFileDurably(this.file, snapshot));
    return this.chain;
  }
}
