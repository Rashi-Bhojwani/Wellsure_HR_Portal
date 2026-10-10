import { spawn } from "node:child_process";
import path from "node:path";
import type { Logger } from "../log";
import type { AlarmKind } from "../sync/agent";

// The Windows event log (docs/plans/PHASE_2.md "P2-F, commit F2 build design"):
// the entries someone finds under Event Viewer → Windows Logs → Application,
// source "WellsureAgent", when asking "what did it do last night". Written with
// the system's own eventcreate, so nothing is installed for it; install.ps1
// registers the source. IDs are fixed and listed in INSTALL.md.

export const EVENT_SOURCE = "WellsureAgent";
export type EventLevel = "INFORMATION" | "WARNING" | "ERROR";

export const EVENT_IDS = {
  STARTED: 1,
  STOPPED: 2,
  INSTALLED: 3, // written by install.ps1 (it registers the event source with this entry)
  RETENTION_WARNING: 10,
  RETENTION_RISK: 11,
  RETENTION_RECOVERED: 12,
  LOG_NEARLY_FULL: 20,
  LOG_RECOVERED: 21,
  CLOCK_DRIFT: 30,
  CLOCK_RECOVERED: 31,
  BATCH_SET_ASIDE: 40,
  KEY_REJECTED: 50,
  KEY_ACCEPTED: 51,
  SECRETS_FAILED: 60,
} as const;

export interface EventLogSink {
  write(id: number, level: EventLevel, text: string): void;
}

export const nullEventLog: EventLogSink = { write: () => undefined };

/** Which entry an alarm change becomes. */
export function eventForAlarm(kind: AlarmKind, level: "warning" | "error" | "recovered"): { id: number; level: EventLevel } {
  const recovered = level === "recovered";
  switch (kind) {
    case "RETENTION":
      return recovered ? { id: EVENT_IDS.RETENTION_RECOVERED, level: "INFORMATION" } : level === "error" ? { id: EVENT_IDS.RETENTION_RISK, level: "ERROR" } : { id: EVENT_IDS.RETENTION_WARNING, level: "WARNING" };
    case "LOG_NEARLY_FULL":
      return recovered ? { id: EVENT_IDS.LOG_RECOVERED, level: "INFORMATION" } : { id: EVENT_IDS.LOG_NEARLY_FULL, level: "WARNING" };
    case "CLOCK_DRIFT":
      return recovered ? { id: EVENT_IDS.CLOCK_RECOVERED, level: "INFORMATION" } : { id: EVENT_IDS.CLOCK_DRIFT, level: "WARNING" };
    case "BATCH_SET_ASIDE":
      return { id: EVENT_IDS.BATCH_SET_ASIDE, level: "ERROR" };
    case "KEY_REJECTED":
      return recovered ? { id: EVENT_IDS.KEY_ACCEPTED, level: "INFORMATION" } : { id: EVENT_IDS.KEY_REJECTED, level: "ERROR" };
  }
}

export type EventCreateRunner = (args: string[]) => Promise<{ code: number; stderr: string }>;

const eventCreate: EventCreateRunner = (args) =>
  new Promise((resolve, reject) => {
    const exe = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "eventcreate.exe");
    const child = spawn(exe, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
  });

export class WindowsEventLog implements EventLogSink {
  private warned = false;

  constructor(
    private readonly log: Logger,
    private readonly run: EventCreateRunner = eventCreate,
  ) {}

  /** Fire and forget: the event log must never stop the agent. A failure is logged once. */
  write(id: number, level: EventLevel, text: string): void {
    this.run(["/ID", String(id), "/L", "APPLICATION", "/T", level, "/SO", EVENT_SOURCE, "/D", text.slice(0, 2000)]).then(
      (res) => res.code !== 0 && this.failed(res.stderr),
      (err: Error) => this.failed(err.message),
    );
  }

  private failed(why: string): void {
    if (this.warned) return;
    this.warned = true;
    this.log.warn("could not write to the Windows event log (is the WellsureAgent source registered? install.ps1 does that)", { error: why.trim().slice(0, 300) });
  }
}

export function createEventLog(platform: NodeJS.Platform, log: Logger): EventLogSink {
  return platform === "win32" ? new WindowsEventLog(log) : nullEventLog;
}

/** The agent's alarm hook, writing each change to the event log. */
export function alarmToEventLog(sink: EventLogSink) {
  return (serial: string | null, kind: AlarmKind, level: "warning" | "error" | "recovered", message: string): void => {
    const e = eventForAlarm(kind, level);
    sink.write(e.id, e.level, message);
    void serial;
  };
}
