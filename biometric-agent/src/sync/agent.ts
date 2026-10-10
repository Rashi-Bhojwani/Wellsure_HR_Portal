import os from "node:os";
import { formatAttlogLine } from "@shared/attendance/attlog";
import {
  DEFAULT_DEVICE_HEALTH_THRESHOLDS,
  DEFAULT_RETENTION_DAYS,
  DEFAULT_RETENTION_RECORDS,
  assessRetention,
  clockDriftExceeded,
  describeClockOffset,
  type AgentDeviceConfig,
  type AgentDeviceReport,
  type AgentHeartbeatRequest,
  type DeviceHealthThresholds,
  type DeviceReportState,
  type RetentionAssessment,
} from "@shared/attendance/agentProtocol";
import { ApiClient } from "../api/client";
import type { DeviceConfig } from "../config/schema";
import type { LoadedConfig } from "../config/load";
import { DeviceError, type DeviceDriver } from "../device/driver";
import { createDriver } from "../device/factory";
import type { Logger } from "../log";
import type { SecretStore } from "../secrets";
import { AGENT_VERSION } from "../version";
import { Backoff } from "./backoff";
import { deviceMinusPcSeconds, pcMinusServerSeconds } from "./clock";
import { needsFullRead, newRecords } from "./cursor";
import { Outbox } from "./outbox";
import { StateStore, type DeviceState } from "./state";

// The sync agent (docs/plans/PHASE_2.md §7.1, "P2-F build design").
//
// One loop per device, every pollSeconds, so a device that's down never holds
// up the others:
//   connect → confirm the device's own serial → record count → (only if
//   needed) the whole log → new records as ATTLOG lines into the outbox →
//   THEN move the cursor → read the clock → disconnect.
// A sender drains the outbox in order with backoff; a heartbeat goes every
// cycle and brings back the server's settings for each device.
//
// The agent only ever reads the device (P2-F rule 1; see device/zk/zkDriver.ts).

export interface AgentHooks {
  /** Tests: a crash point between "records are in the outbox" and "the cursor moved". */
  afterOutboxWrite?: (serial: string) => void | Promise<void>;
  /** F2: the Windows event log, on each change of retention state / drift. */
  onAlarm?: (serial: string, kind: "RETENTION" | "LOG_NEARLY_FULL" | "CLOCK_DRIFT", level: "warning" | "error" | "recovered", message: string) => void;
}

export interface AgentOptions {
  config: LoadedConfig;
  secrets: SecretStore;
  logger: Logger;
  /** Default: the driver the config names (Zk4370Driver, or the simulated one). */
  driverFor?: (device: DeviceConfig, commKey: number | null) => DeviceDriver;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  hooks?: AgentHooks;
  random?: () => number;
}

export class Agent {
  readonly store: StateStore;
  readonly outbox: Outbox;
  private api: ApiClient | null = null;
  private readonly startedAt: Date;
  private lastPostAt: string | null = null;
  private lastPostError: string | null = null;
  private keyRejected = false;
  private readonly sendBackoff: Backoff;
  private readonly parkedUntil = new Map<string, number>();
  private timers = new Set<NodeJS.Timeout>();
  private running = false;
  private inFlight = new Set<Promise<unknown>>();
  private sending: Promise<unknown> | null = null;
  private readonly now: () => Date;

  constructor(private readonly opts: AgentOptions) {
    this.now = opts.now ?? (() => new Date());
    this.startedAt = this.now();
    this.store = new StateStore(opts.config.dataDir);
    this.outbox = new Outbox(opts.config.dataDir);
    this.outbox.init();
    this.sendBackoff = new Backoff(opts.config.backoff.initialSeconds * 1000, opts.config.backoff.maxSeconds * 1000, opts.random);
  }

  private get log(): Logger {
    return this.opts.logger;
  }

  private async client(): Promise<ApiClient> {
    if (this.api) return this.api;
    const key = await this.opts.secrets.agentKey();
    if (!key) throw new Error("No agent key is stored. Add it (Credential Manager on Windows; WELLSURE_AGENT_KEY elsewhere): Admin Tools → Devices → Sync agents shows it once.");
    this.api = new ApiClient(this.opts.config.apiUrl, key, this.opts.config.requestTimeoutSeconds * 1000, this.opts.fetchImpl);
    return this.api;
  }

  private serverDevice(serial: string): AgentDeviceConfig | null {
    return this.store.state.server?.devices.find((d) => d.serial === serial) ?? null;
  }

  private thresholds(): DeviceHealthThresholds {
    return this.store.state.server?.thresholds ?? DEFAULT_DEVICE_HEALTH_THRESHOLDS;
  }

  // ── One device, one cycle ───────────────────────────────────────────────

  async cycleDevice(serial: string): Promise<void> {
    const cfg = this.opts.config.devices.find((d) => d.serial === serial);
    if (!cfg) throw new Error(`Device ${serial} isn't in config.json.`);
    const ds = this.store.device(serial);
    const server = this.serverDevice(serial);
    if (!this.store.state.server) {
      return this.mark(serial, ds, "NOT_YET_READ", "Waiting for the server's settings for this device (its sync-from date) — the agent hasn't reached the API yet.");
    }
    if (!server) {
      return this.mark(serial, ds, "NOT_ASSIGNED", "The server doesn't assign this device to this agent, or it is inactive (Admin Tools → Devices). It isn't read.");
    }
    if (cfg.driver === "simulated" && !server.isSimulated) {
      return this.mark(serial, ds, "CONFIG_REFUSED", "config.json uses the simulated driver for a device the server says is real. Refused: a real device is never simulated.");
    }

    let driver: DeviceDriver;
    try {
      driver = (this.opts.driverFor ?? createDriver)(cfg, await this.opts.secrets.commKey(serial));
    } catch (err) {
      return this.mark(serial, ds, "CONFIG_REFUSED", (err as Error).message);
    }
    try {
      await driver.connect();
      const info = await driver.info();
      Object.assign(ds, { reportedSerial: info.serial, firmware: info.firmware, platform: info.platform, logCount: info.logCount, logCapacity: info.logCapacity });
      if (info.serial !== serial) {
        return this.mark(serial, ds, "SERIAL_MISMATCH", `The device at ${cfg.host}:${cfg.port} says its serial is ${info.serial ?? "(none)"}, not ${serial}. Nothing was read or sent — check the address in config.json.`);
      }
      if (needsFullRead(info, ds.cursor, server.syncFrom)) {
        const { records } = await driver.readAll(info.logCount);
        const { fresh, next, move } = newRecords(records, ds.cursor, server.syncFrom);
        if (fresh.length) {
          this.outbox.append(serial, fresh.map((r) => ({ line: formatAttlogLine(r), localTime: r.localTime })));
          await this.opts.hooks?.afterOutboxWrite?.(serial);
        }
        ds.cursor = next;
        await this.store.save();
        if (move !== "append" || fresh.length) this.log.info("device read", { serial, newRecords: fresh.length, logCount: records.length, move });
        if (move === "lost") this.log.warn("the device's log no longer holds the last record sent; sending every record again (the server drops the ones it has)", { serial });
        if (fresh.length) this.wakeSender();
      }
      const deviceLocal = await driver.deviceTime();
      const readAt = this.now();
      ds.clockOffsetSeconds = deviceMinusPcSeconds(deviceLocal, server.timezone, readAt) + (this.store.state.pcClockOffsetSeconds ?? 0);
      ds.lastReadAt = readAt.toISOString();
      ds.state = "OK";
      ds.lastError = null;
    } catch (err) {
      const e = err instanceof DeviceError ? err : new DeviceError("UNREACHABLE", (err as Error).message);
      const state: DeviceReportState = e.kind === "AUTH_FAILED" ? "AUTH_FAILED" : e.kind === "UNSUPPORTED_FORMAT" ? "UNSUPPORTED_FORMAT" : "UNREACHABLE";
      ds.state = state;
      ds.lastError = e.message;
      this.log.warn("device not read", { serial, state, error: e.message });
    } finally {
      await driver.disconnect().catch(() => undefined);
      this.checkAlarms(serial, ds, server);
      await this.store.save();
    }
  }

  private async mark(serial: string, ds: DeviceState, state: DeviceReportState, message: string): Promise<void> {
    if (ds.state !== state || ds.lastError !== message) this.log.warn("device not read", { serial, state, error: message });
    ds.state = state;
    ds.lastError = message;
    await this.store.save();
  }

  private retentionFor(ds: DeviceState, server: AgentDeviceConfig | null): RetentionAssessment {
    return assessRetention({
      lastReadAt: ds.lastReadAt ? new Date(ds.lastReadAt) : null,
      now: this.now(),
      retentionDays: server?.retentionDays ?? DEFAULT_RETENTION_DAYS,
      retentionRecords: server?.retentionRecords ?? DEFAULT_RETENTION_RECORDS,
      logCount: ds.logCount,
      logCapacity: ds.logCapacity,
      thresholds: this.thresholds(),
    });
  }

  /** Logs (and, from F2, raises in the Windows event log) each change of retention state, a nearly full log, and clock drift. */
  private checkAlarms(serial: string, ds: DeviceState, server: AgentDeviceConfig | null): void {
    const r = this.retentionFor(ds, server);
    if (r.state !== (ds.retentionLogged ?? "OK")) {
      const message =
        r.state === "OK"
          ? `${serial}: read again; retention back to normal.`
          : `${serial} hasn't been read for ${r.gapHours} h of an assumed ${r.windowHours} h log: punches older than that may be overwritten${r.state === "RISK" ? " SOON" : ""}.`;
      (r.state === "RISK" ? this.log.error : this.log.warn)("retention", { serial, state: r.state, gapHours: r.gapHours, windowHours: r.windowHours, message });
      this.opts.hooks?.onAlarm?.(serial, "RETENTION", r.state === "RISK" ? "error" : r.state === "WARNING" ? "warning" : "recovered", message);
      ds.retentionLogged = r.state;
    }
    if (r.logNearlyFull !== ds.logNearlyFullLogged) {
      const message = r.logNearlyFull ? `${serial}'s attendance log is ${r.logFullPercent}% full.` : `${serial}'s attendance log is below the nearly-full mark again.`;
      this.log.warn("device log", { serial, logFullPercent: r.logFullPercent, message });
      this.opts.hooks?.onAlarm?.(serial, "LOG_NEARLY_FULL", r.logNearlyFull ? "warning" : "recovered", message);
      ds.logNearlyFullLogged = r.logNearlyFull;
    }
    const drift = clockDriftExceeded(ds.clockOffsetSeconds, this.thresholds());
    if (drift !== ds.driftLogged) {
      const message = drift
        ? `${serial}'s clock is ${describeClockOffset(ds.clockOffsetSeconds!)}. Set it from the device's own menu; the agent never changes it.`
        : `${serial}'s clock is within the threshold again.`;
      this.log.warn("device clock", { serial, clockOffsetSeconds: ds.clockOffsetSeconds, message });
      this.opts.hooks?.onAlarm?.(serial, "CLOCK_DRIFT", drift ? "warning" : "recovered", message);
      ds.driftLogged = drift;
    }
  }

  // ── Sending ─────────────────────────────────────────────────────────────

  /**
   * Sends waiting batches, oldest first per device, until the outbox is empty
   * or something fails. Returns false on a failure that should back off.
   */
  async sendPending(): Promise<boolean> {
    let api: ApiClient;
    try {
      api = await this.client();
    } catch (err) {
      this.lastPostError = (err as Error).message;
      return false;
    }
    for (;;) {
      const now = Date.now();
      const serials = this.outbox.serialsWaiting().filter((s) => (this.parkedUntil.get(s) ?? 0) <= now);
      if (!serials.length) return true;
      for (const serial of serials) {
        const seg = this.outbox.oldest(serial);
        if (!seg) continue;
        const res = await api.postPunches({ device: serial, lines: seg.lines });
        if (res.status === 200) {
          this.outbox.remove(seg);
          this.lastPostAt = new Date().toISOString();
          this.lastPostError = null;
          this.keyRejected = false;
          this.sendBackoff.reset();
          const b = res.body!;
          this.log.info("sent", { serial, lines: seg.lines.length, new: b.newCount, duplicate: b.duplicateCount, unmapped: b.unmappedCount, rejected: b.rejectedCount, flagged: b.flaggedCount });
          continue;
        }
        this.lastPostError = res.error;
        if (res.status === 401) {
          this.keyRejected = true;
          this.api = null; // read the key again next time: a corrected key works without a restart
          this.log.error("the API rejected the agent key; punches keep collecting in the outbox until it is fixed (rotate the key: INSTALL.md)", { error: res.error });
          return false;
        }
        if (res.status === 403) {
          this.parkedUntil.set(serial, Date.now() + this.opts.config.backoff.maxSeconds * 1000);
          this.log.error("the API refused this device's punches (not assigned to this agent, or inactive); kept in the outbox", { serial, error: res.error });
          continue;
        }
        if (res.status === 400 || res.status === 413 || res.status === 422) {
          this.outbox.quarantineSegment(seg, res.error ?? `HTTP ${res.status}`);
          this.log.error("the API refused a batch as it stands; it was set aside in outbox-rejected for a person to look at (never deleted)", { serial, file: seg.file, error: res.error });
          continue;
        }
        this.log.warn("send failed; will retry", { serial, error: res.error });
        return false;
      }
    }
  }

  private wakeSender(): void {
    if (!this.running || this.sending) return;
    this.sending = this.track(
      (async () => {
        const ok = await this.sendPending();
        this.sending = null;
        if (!this.running) return;
        if (!ok) this.later(() => this.wakeSender(), this.keyRejected ? this.opts.config.backoff.maxSeconds * 1000 : this.sendBackoff.next());
        else if (this.outbox.total() > 0) this.later(() => this.wakeSender(), this.opts.config.backoff.maxSeconds * 1000); // only parked devices left
      })(),
    );
  }

  // ── Heartbeat ───────────────────────────────────────────────────────────

  report(): AgentHeartbeatRequest {
    const now = this.now();
    const devices: AgentDeviceReport[] = this.opts.config.devices.map((cfg) => {
      const ds = this.store.device(cfg.serial);
      const waiting = this.outbox.waiting(cfg.serial);
      return {
        device: cfg.serial,
        reachable: ds.state === "OK",
        state: ds.state,
        lastReadAt: ds.lastReadAt,
        secondsSinceLastRead: ds.lastReadAt ? Math.max(0, Math.round((now.getTime() - Date.parse(ds.lastReadAt)) / 1000)) : null,
        lastError: ds.lastError ? ds.lastError.slice(0, 1000) : null,
        reportedSerial: ds.reportedSerial,
        firmware: ds.firmware,
        platform: ds.platform,
        logCount: ds.logCount,
        logCapacity: ds.logCapacity,
        clockOffsetSeconds: ds.clockOffsetSeconds,
        outboxRecords: waiting.lines,
        oldestUnsentLocalTime: waiting.oldest,
        retention: this.retentionFor(ds, this.serverDevice(cfg.serial)),
      };
    });
    return {
      version: AGENT_VERSION,
      host: os.hostname(),
      startedAt: this.startedAt.toISOString(),
      outboxRecords: this.outbox.total(),
      lastPostAt: this.lastPostAt,
      lastPostError: this.lastPostError ? this.lastPostError.slice(0, 1000) : null,
      pcClockOffsetSeconds: this.store.state.pcClockOffsetSeconds,
      devices,
      quarantinedBatches: this.outbox.quarantinedCount(),
    };
  }

  /** Reports in, and takes the server's settings for each device. */
  async heartbeat(): Promise<boolean> {
    let api: ApiClient;
    try {
      api = await this.client();
    } catch (err) {
      this.log.error("no agent key", { error: (err as Error).message });
      return false;
    }
    const res = await api.heartbeat(this.report());
    if (res.status === 200 && res.body) {
      const body = res.body;
      const before = JSON.stringify(this.store.state.server?.devices ?? null);
      this.store.state.server = { devices: body.devices, thresholds: body.thresholds, receivedAt: new Date().toISOString() };
      this.store.state.pcClockOffsetSeconds = pcMinusServerSeconds(res.sentAt, res.receivedAt, body.serverTime);
      this.keyRejected = false;
      await this.store.save();
      if (JSON.stringify(body.devices) !== before) this.log.info("settings from the server", { devices: body.devices.map((d) => ({ serial: d.serial, syncFrom: d.syncFrom, retentionDays: d.retentionDays })) });
      for (const cfg of this.opts.config.devices) {
        if (!body.devices.some((d) => d.serial === cfg.serial)) this.log.warn("config.json lists a device the server doesn't assign to this agent", { serial: cfg.serial });
      }
      return true;
    }
    if (res.status === 401) {
      this.keyRejected = true;
      this.api = null;
    }
    this.log.warn("heartbeat failed", { error: res.error });
    return false;
  }

  // ── Running ─────────────────────────────────────────────────────────────

  private track<T>(p: Promise<T>): Promise<T> {
    this.inFlight.add(p);
    void p.finally(() => this.inFlight.delete(p));
    return p;
  }

  private later(fn: () => void, ms: number): void {
    if (!this.running) return;
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (this.running) fn();
    }, ms);
    this.timers.add(t);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const poll = this.opts.config.pollSeconds * 1000;
    const beat = () =>
      void this.track(this.heartbeat().catch((err) => this.log.error("heartbeat crashed", { error: String(err) }))).then(() => this.later(beat, poll));
    const deviceLoop = (serial: string) => () =>
      void this.track(this.cycleDevice(serial).catch((err) => this.log.error("device cycle crashed", { serial, error: String(err) }))).then(() => this.later(deviceLoop(serial), poll));
    this.log.info("agent started", { version: AGENT_VERSION, apiUrl: this.opts.config.apiUrl, pollSeconds: this.opts.config.pollSeconds, devices: this.opts.config.devices.map((d) => d.serial), outboxRecords: this.outbox.total() });
    // Report in first, so each device's sync-from date is known before it's read.
    void this.track(this.heartbeat().catch(() => false)).then(() => {
      this.later(beat, poll);
      for (const d of this.opts.config.devices) deviceLoop(d.serial)();
      this.wakeSender(); // anything left from before a restart
    });
  }

  async stop(): Promise<void> {
    this.running = false;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    while (this.inFlight.size) await Promise.allSettled([...this.inFlight]);
    await this.store.save();
    this.log.info("agent stopped", { outboxRecords: this.outbox.total() });
  }
}
