import { readFileSync } from "node:fs";
import { instantToLocalTime } from "@shared/attendance/attlog";
import { DeviceError, type AttRecord, type DeviceDriver, type DeviceInfo, type RecordFormat } from "./driver";

// The punch simulator's device (docs/plans/PHASE_2.md §4.6, §7.1): the same
// DeviceDriver interface as Zk4370Driver, so the agent code exercised by the
// simulator (P2-G) is the code that reads the real machine. Its state comes
// from a source: in memory for tests, or a JSON file the simulator writes.
// It is refused for any device the server doesn't mark as simulated (P2-F
// rule 3), so a production PC can never send made-up punches.

export interface SimulatedDeviceState {
  serial: string;
  reachable?: boolean;
  firmware?: string;
  platform?: string;
  logCapacity?: number;
  timezone?: string;
  /** The device clock's error in seconds (positive = ahead). */
  clockOffsetSeconds?: number;
  records: AttRecord[];
}

export interface SimulatedSource {
  load(): SimulatedDeviceState;
}

export class InMemorySimulatedSource implements SimulatedSource {
  constructor(public state: SimulatedDeviceState) {}
  load(): SimulatedDeviceState {
    return this.state;
  }
  punch(deviceUserId: string, localTime?: string): void {
    const tz = this.state.timezone ?? "Asia/Kolkata";
    this.state.records.push({ deviceUserId, localTime: localTime ?? instantToLocalTime(new Date(Date.now() + (this.state.clockOffsetSeconds ?? 0) * 1000), tz), status: "1", verifyMode: "255", workcode: "0" });
  }
}

export class JsonFileSimulatedSource implements SimulatedSource {
  constructor(private readonly file: string) {}
  load(): SimulatedDeviceState {
    try {
      return JSON.parse(readFileSync(this.file, "utf8")) as SimulatedDeviceState;
    } catch (err) {
      throw new DeviceError("UNREACHABLE", `Simulated device state ${this.file}: ${(err as Error).message}`);
    }
  }
}

export class SimulatedDriver implements DeviceDriver {
  private state: SimulatedDeviceState | null = null;

  constructor(private readonly source: SimulatedSource) {}

  async connect(): Promise<void> {
    const s = this.source.load();
    if (s.reachable === false) throw new DeviceError("UNREACHABLE", "The simulated device is switched off.");
    this.state = s;
  }

  private current(): SimulatedDeviceState {
    if (!this.state) throw new DeviceError("UNREACHABLE", "Not connected.");
    return this.state;
  }

  async info(): Promise<DeviceInfo> {
    const s = this.current();
    return { serial: s.serial, platform: s.platform ?? "SIMULATED", firmware: s.firmware ?? "simulated", logCount: s.records.length, logCapacity: s.logCapacity ?? 100_000, userCount: null };
  }

  async readAll(): Promise<{ format: RecordFormat; records: AttRecord[] }> {
    return { format: 40, records: [...this.current().records] };
  }

  async deviceTime(): Promise<string> {
    const s = this.current();
    return instantToLocalTime(new Date(Date.now() + (s.clockOffsetSeconds ?? 0) * 1000), s.timezone ?? "Asia/Kolkata");
  }

  async disconnect(): Promise<void> {
    this.state = null;
  }
}
