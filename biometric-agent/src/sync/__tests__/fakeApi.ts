import http from "node:http";
import { parseAttlogLine } from "@shared/attendance/attlog";
import { DEFAULT_DEVICE_HEALTH_THRESHOLDS, type AgentDeviceConfig, type AgentHeartbeatRequest, type DeviceHealthThresholds } from "@shared/attendance/agentProtocol";

// A stand-in for the two agent endpoints (backend/src/modules/biometric), for
// the agent's own tests. Like the real ingestion service it drops exact
// duplicates by (device, device user ID, time), so "sent twice" is harmless
// and "never sent" shows up as a missing punch.

export type FakeApiMode = "ok" | "down" | "500" | "401" | "403" | "400" | "acceptThenDrop";

export class FakeApi {
  /** Unique punches stored, per device: "userId|localTime". */
  readonly stored = new Map<string, Set<string>>();
  /** Every punches post that was answered 200, in order. */
  readonly accepted: Array<{ device: string; lines: string[] }> = [];
  readonly heartbeats: AgentHeartbeatRequest[] = [];
  mode: FakeApiMode = "ok";
  /** Per-device mode overrides (e.g. one device 403). */
  readonly deviceMode = new Map<string, FakeApiMode>();
  devices: AgentDeviceConfig[];
  thresholds: DeviceHealthThresholds = { ...DEFAULT_DEVICE_HEALTH_THRESHOLDS };
  /** The server's clock relative to the real one, seconds (to fake a wrong PC clock). */
  serverClockOffsetSeconds = 0;
  key: string;
  private server: http.Server | null = null;

  constructor(opts: { key: string; devices: AgentDeviceConfig[] }) {
    this.key = opts.key;
    this.devices = opts.devices;
  }

  storedFor(device: string): string[] {
    return [...(this.stored.get(device) ?? [])].sort();
  }

  async start(port = 0): Promise<string> {
    this.server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => this.handle(req, res, body));
    });
    await new Promise<void>((resolve) => this.server!.listen(port, "127.0.0.1", () => resolve()));
    return `http://127.0.0.1:${(this.server.address() as { port: number }).port}`;
  }

  async stop(): Promise<void> {
    if (this.server) {
      this.server.closeAllConnections();
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    }
  }

  private reply(res: http.ServerResponse, status: number, json: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(json));
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse, raw: string): void {
    const body = JSON.parse(raw || "{}") as Record<string, unknown>;
    const mode = (req.url?.endsWith("/punches") ? this.deviceMode.get(body.device as string) : undefined) ?? this.mode;
    if (mode === "down") return void res.destroy();
    if (mode === "500") return this.reply(res, 500, { error: { message: "Internal error" } });
    if (req.headers.authorization !== `Bearer ${this.key}` || mode === "401") return this.reply(res, 401, { error: { message: "Invalid or inactive agent key." } });

    if (req.url === "/api/biometric/agent/heartbeat") {
      this.heartbeats.push(body as unknown as AgentHeartbeatRequest);
      return this.reply(res, 200, { ok: true, serverTime: new Date(Date.now() + this.serverClockOffsetSeconds * 1000).toISOString(), devices: this.devices, thresholds: this.thresholds });
    }
    if (req.url === "/api/biometric/agent/punches") {
      const device = body.device as string;
      if (mode === "403" || !this.devices.some((d) => d.serial === device)) return this.reply(res, 403, { error: { message: `Device "${device}" isn't assigned to this agent.` } });
      if (mode === "400") return this.reply(res, 400, { error: { message: "Request validation failed" } });
      const lines = body.lines as string[];
      const set = this.stored.get(device) ?? new Set<string>();
      let fresh = 0;
      for (const l of lines) {
        const p = parseAttlogLine(l);
        if ("error" in p) continue;
        const k = `${p.deviceUserId}|${p.localTime}`;
        if (!set.has(k)) fresh++;
        set.add(k);
      }
      this.stored.set(device, set);
      if (mode === "acceptThenDrop") {
        // Stored, but the answer never arrives: the agent must send again, harmlessly.
        this.mode = "ok";
        return void res.destroy();
      }
      this.accepted.push({ device, lines });
      return this.reply(res, 200, { batchId: `b${this.accepted.length}`, totalLines: lines.length, newCount: fresh, duplicateCount: lines.length - fresh, unmappedCount: 0, rejectedCount: 0, flaggedCount: 0, rejected: [], highestPunchedAt: null, highestLocalTime: null });
    }
    this.reply(res, 404, { error: { message: "Not found" } });
  }
}
