import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AttRecord } from "../device/driver";
import type { ServerApi } from "./serverApi";

// The three ways a punch reaches the server, each the real path
// (docs/plans/PHASE_2.md "P2-G, commit G2 build design", item 3). A route
// takes ATTLOG lines exactly as the device records them and delivers them; it
// has no idea what a scenario is.

export interface PunchLine {
  deviceUserId: string;
  /** Device-local "YYYY-MM-DD HH:MM:SS". */
  localTime: string;
  /** The ATTLOG line, exactly the device's format. */
  line: string;
}

export interface Route {
  readonly name: "agent" | "push" | "file";
  send(lines: PunchLine[]): Promise<void>;
  /** Resolves when everything sent has left for the server (the agent's outbox is empty). */
  settled(timeoutMs: number): Promise<void>;
  stop(): Promise<void>;
}

const AGENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── agent: the real agent reading a simulated device ────────────────────────

export interface AgentRouteOptions {
  apiUrl: string;
  /** From the environment or the simulator's private folder; never printed. */
  agentKey: string;
  serial: string;
  workDir: string;
  pollSeconds?: number;
}

export class AgentRoute implements Route {
  readonly name = "agent" as const;
  private proc: ChildProcess | null = null;
  private records: AttRecord[] = [];
  readonly stateFile: string;
  readonly dataDir: string;
  readonly configFile: string;
  readonly logFile: string;

  constructor(private readonly o: AgentRouteOptions) {
    this.dataDir = path.join(o.workDir, "agent-data");
    this.stateFile = path.join(o.workDir, "device.json");
    this.configFile = path.join(o.workDir, "config.json");
    this.logFile = path.join(o.workDir, "agent.log");
  }

  private writeDevice(): void {
    mkdirSync(this.o.workDir, { recursive: true });
    writeFileSync(this.stateFile, JSON.stringify({ serial: this.o.serial, records: this.records }));
  }

  /** Starts the real agent (`main.ts run`, the code the Windows service runs) against the simulated device. */
  async start(): Promise<void> {
    if (this.proc) return;
    mkdirSync(this.o.workDir, { recursive: true });
    rmSync(this.dataDir, { recursive: true, force: true });
    this.writeDevice();
    writeFileSync(
      this.configFile,
      JSON.stringify({
        apiUrl: this.o.apiUrl,
        pollSeconds: this.o.pollSeconds ?? 5,
        dataDir: this.dataDir,
        secrets: "env",
        backoff: { initialSeconds: 1, maxSeconds: 5 },
        devices: [{ serial: this.o.serial, host: "127.0.0.1", port: 4370, driver: "simulated", simulatedStateFile: this.stateFile }],
      }),
    );
    const log = openSync(this.logFile, "w");
    this.proc = spawn(path.join(AGENT_DIR, "node_modules/.bin/tsx"), ["src/main.ts", "run", "--config", this.configFile], {
      cwd: AGENT_DIR,
      env: { ...process.env, WELLSURE_AGENT_KEY: this.o.agentKey },
      stdio: ["ignore", log, log],
      detached: true,
    });
  }

  /** The device records the punches; the agent finds them on its next poll. */
  async send(lines: PunchLine[]): Promise<void> {
    for (const l of lines) this.records.push({ deviceUserId: l.deviceUserId, localTime: l.localTime, status: "1", verifyMode: "255", workcode: "0" });
    this.writeDevice();
    // Started after the first punches are on the device, so its first read finds them rather than waiting a poll.
    if (!this.proc) await this.start();
  }

  /** Has the agent taken every record and posted everything it took? */
  private idle(): boolean {
    try {
      const state = JSON.parse(readFileSync(path.join(this.dataDir, "state.json"), "utf8")) as { devices: Record<string, { cursor: { position: number } | null }> };
      const cursor = state.devices[this.o.serial]?.cursor;
      if (!cursor || cursor.position < this.records.length) return false;
      const outbox = path.join(this.dataDir, "outbox");
      if (!existsSync(outbox)) return true;
      return readdirSync(outbox).every((d) => readdirSync(path.join(outbox, d)).filter((f) => f.endsWith(".json")).length === 0);
    } catch {
      return false;
    }
  }

  async settled(timeoutMs: number): Promise<void> {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if (this.proc?.exitCode !== null && this.proc?.exitCode !== undefined) throw new Error(`The agent stopped (exit ${this.proc.exitCode}); see ${this.logFile}`);
      if (this.idle()) return;
      await sleep(250);
    }
    throw new Error(`The agent had not delivered everything after ${Math.round(timeoutMs / 1000)} s; see ${this.logFile}`);
  }

  async stop(): Promise<void> {
    if (this.proc?.pid) {
      // tsx runs the script in a child: signal the whole group.
      try {
        process.kill(-this.proc.pid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
    this.proc = null;
  }
}

// ── push: playing the ADMS device ───────────────────────────────────────────

export class PushRoute implements Route {
  readonly name = "push" as const;
  private shook = false;

  constructor(
    private readonly api: ServerApi,
    private readonly serial: string,
    private readonly chunk = 200,
  ) {}

  async send(lines: PunchLine[]): Promise<void> {
    const sn = encodeURIComponent(this.serial);
    if (!this.shook) {
      await this.api.request("GET", `/iclock/cdata?SN=${sn}&options=all&pushver=2.4.1`, { auth: false });
      this.shook = true;
    }
    for (let i = 0; i < lines.length; i += this.chunk) {
      await this.api.request("POST", `/iclock/cdata?SN=${sn}&table=ATTLOG&Stamp=9999`, { text: lines.slice(i, i + this.chunk).map((l) => l.line).join("\n"), auth: false });
    }
  }

  async settled(): Promise<void> {
    /* a push is answered when it is stored */
  }
  async stop(): Promise<void> {
    /* nothing running */
  }
}

// ── file: the ATTLOG file, and (with a device) HR's emergency upload ────────

export class FileRoute implements Route {
  readonly name = "file" as const;

  constructor(
    private readonly o: { api?: ServerApi; deviceId?: string; reason?: string; writeTo?: string },
  ) {}

  /** The file written and, with a device, uploaded for preview (HR's first step). Returns the upload to commit, if any. */
  async stage(lines: PunchLine[]): Promise<string | null> {
    const text = lines.map((l) => l.line).join("\n") + "\n";
    if (this.o.writeTo) {
      mkdirSync(path.dirname(this.o.writeTo), { recursive: true });
      writeFileSync(this.o.writeTo, text);
    }
    if (!this.o.api || !this.o.deviceId) return null;
    const form = new FormData();
    form.set("deviceId", this.o.deviceId);
    form.set("file", new Blob([text], { type: "text/plain" }), "attlog.txt");
    return (await this.o.api.request<{ batchId: string }>("POST", "/api/biometric/import/preview", { form })).batchId;
  }

  /** HR's second step: commit the previewed upload. This is the moment the punches reach the server. */
  async commit(batchId: string): Promise<void> {
    await this.o.api!.request("POST", `/api/biometric/import/${batchId}/commit`, { json: { reason: this.o.reason ?? "Punch simulator (development)" } });
  }

  async send(lines: PunchLine[]): Promise<void> {
    // The same two calls the Import Center screen makes: preview, then commit.
    const batchId = await this.stage(lines);
    if (batchId) await this.commit(batchId);
  }

  async settled(): Promise<void> {
    /* a commit is answered when it is stored */
  }
  async stop(): Promise<void> {
    /* nothing running */
  }
}
