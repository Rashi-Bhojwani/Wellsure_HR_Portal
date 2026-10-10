import type { AttRecord, RecordFormat } from "./zk/protocol";

export type { AttRecord, RecordFormat };

// The seam between the agent and a device (docs/plans/PHASE_2.md §7.1).
// Implementations: Zk4370Driver (our read-only ZKTeco protocol, D-F1) and
// SimulatedDriver (the punch simulator's, P2-G). Everything else in the agent
// works through this interface, so the code tested against the simulator is
// the code that runs against the machine.
//
// §7.1 named the read `readSince(cursor)`. Both drivers return the whole log
// in storage order (that's what the protocol does), so the cursor logic lives
// once, in sync/cursor.ts, and the driver just reads.

export interface DeviceInfo {
  /** What the device says its serial is (checked against the configuration before anything is read). */
  serial: string | null;
  platform: string | null;
  firmware: string | null;
  /** Attendance records currently stored. */
  logCount: number | null;
  /** Attendance records it can store (its own figure). */
  logCapacity: number | null;
  userCount: number | null;
}

export interface DeviceDriver {
  /** Opens a session (and authenticates with the comm key if the device asks). */
  connect(): Promise<void>;
  info(): Promise<DeviceInfo>;
  /** The whole attendance log, oldest first, exactly as stored. */
  readAll(recordCountHint: number | null): Promise<{ format: RecordFormat; records: AttRecord[] }>;
  /** The device's clock, device-local "YYYY-MM-DD HH:MM:SS". Read, never set. */
  deviceTime(): Promise<string>;
  disconnect(): Promise<void>;
}

/** Why a device couldn't be read, in the heartbeat's terms. */
export type DeviceErrorKind = "UNREACHABLE" | "AUTH_FAILED" | "UNSUPPORTED_FORMAT" | "NOT_ALLOWED" | "PROTOCOL";

export class DeviceError extends Error {
  readonly name = "DeviceError";
  constructor(
    readonly kind: DeviceErrorKind,
    message: string,
  ) {
    super(message);
  }
}
