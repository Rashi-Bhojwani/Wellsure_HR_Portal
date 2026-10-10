import { existsSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../../config/load";
import { EnvSecretStore, commKeyEnvName } from "../../secrets";
import { AGENT_VERSION } from "../../version";
import { Backoff } from "../backoff";
import { deviceMinusPcSeconds, pcMinusServerSeconds } from "../clock";
import { acquireAgentLock, AgentAlreadyRunningError, LOCK_STALE_MS } from "../lock";
import { Outbox } from "../outbox";

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "wsa-"));
const entries = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ line: `${i + from}\t2026-10-09 10:00:00\t1\t255\t1\t0`, localTime: `2026-10-09 10:${String((i + from) % 60).padStart(2, "0")}:00` }));

describe("the outbox", () => {
  it("splits into batches of at most 1,000 lines, oldest first, and counts what's waiting", () => {
    const dir = tmp();
    const o = new Outbox(dir);
    o.init();
    o.append("DEV-1", entries(2_500));
    expect(o.waiting("DEV-1").lines).toBe(2_500);
    const first = o.oldest("DEV-1")!;
    expect(first.lines).toHaveLength(1_000);
    expect(first.lines[0]!.startsWith("0\t")).toBe(true);
    o.remove(first);
    expect(o.oldest("DEV-1")!.lines[0]!.startsWith("1000\t")).toBe(true);
    expect(o.waiting("DEV-1").lines).toBe(1_500);
  });

  it("survives a restart, and drops a half-written file left by a crash", () => {
    const dir = tmp();
    const o = new Outbox(dir);
    o.init();
    o.append("DEV-1", entries(3));
    const folder = path.join(dir, "outbox", "DEV-1");
    writeFileSync(path.join(folder, "999999999999999-00000001.json.tmp"), "{ half a fi");
    const again = new Outbox(dir);
    again.init();
    expect(again.waiting("DEV-1").lines).toBe(3);
    expect(readdirSync(folder).some((f) => f.endsWith(".tmp"))).toBe(false);
  });

  it("a batch the API refuses as it stands is set aside, never deleted", () => {
    const dir = tmp();
    const o = new Outbox(dir);
    o.init();
    o.append("DEV-1", entries(2));
    o.quarantineSegment(o.oldest("DEV-1")!);
    expect(o.waiting("DEV-1").lines).toBe(0);
    expect(o.quarantinedCount()).toBe(1);
    const kept = readdirSync(path.join(dir, "outbox-rejected"));
    expect(JSON.parse(readFileSync(path.join(dir, "outbox-rejected", kept[0]!), "utf8")).lines).toHaveLength(2);
  });
});

describe("backoff", () => {
  it("doubles from the initial delay to the cap, with ±20% jitter, and resets", () => {
    const b = new Backoff(5_000, 300_000, () => 0.5); // no jitter at 0.5
    expect([b.next(), b.next(), b.next(), b.next()]).toEqual([5_000, 10_000, 20_000, 40_000]);
    for (let i = 0; i < 10; i++) b.next();
    expect(b.next()).toBe(300_000);
    b.reset();
    expect(b.next()).toBe(5_000);
    const low = new Backoff(5_000, 300_000, () => 0);
    const high = new Backoff(5_000, 300_000, () => 1);
    expect([low.next(), high.next()]).toEqual([4_000, 6_000]);
  });
});

describe("clock offsets", () => {
  it("device minus PC, reading the device's wall-clock time in its own zone", () => {
    const pc = new Date("2026-10-09T04:30:00Z"); // 10:00:00 IST
    expect(deviceMinusPcSeconds("2026-10-09 10:03:20", "Asia/Kolkata", pc)).toBe(200);
    expect(deviceMinusPcSeconds("2026-10-09 09:59:15", "Asia/Kolkata", pc)).toBe(-45);
  });
  it("PC minus server, taking the server's time as the round trip's midpoint", () => {
    const sent = Date.parse("2026-10-09T04:30:00Z");
    expect(pcMinusServerSeconds(sent, sent + 2_000, "2026-10-09T04:20:01Z")).toBe(600);
  });
});

describe("config.json", () => {
  const base = { apiUrl: "https://api.example.com", devices: [{ serial: "AEXY225060969", host: "192.168.29.213" }] };

  it("fills the defaults: 30 s poll, port 4370, transport auto, our driver", () => {
    const c = parseConfig(base, "linux");
    expect(c.pollSeconds).toBe(30);
    expect(c.devices[0]).toMatchObject({ port: 4370, transport: "auto", driver: "zk4370" });
    expect(c.secrets).toBe("env");
    expect(parseConfig(base, "win32")).toMatchObject({ secrets: "credential-manager", dataDir: "C:\\ProgramData\\Wellsure Agent" });
  });

  it("requires HTTPS except for localhost (P2-F rule 4)", () => {
    expect(() => parseConfig({ ...base, apiUrl: "http://api.example.com" }, "linux")).toThrow(/https/);
    expect(parseConfig({ ...base, apiUrl: "http://localhost:4000" }, "linux").apiUrl).toBe("http://localhost:4000");
    expect(parseConfig({ ...base, apiUrl: "http://127.0.0.1:4000" }, "linux").apiUrl).toBe("http://127.0.0.1:4000");
  });

  it("refuses a device listed twice, and says which field is wrong", () => {
    expect(() => parseConfig({ ...base, devices: [base.devices[0], base.devices[0]] }, "linux")).toThrow(/once/);
    expect(() => parseConfig({ ...base, pollSeconds: 1 }, "linux")).toThrow(/pollSeconds/);
  });
});

describe("secrets from the environment (Linux, development, CI)", () => {
  it("reads the agent key and a device's comm key; never from config.json", async () => {
    const s = new EnvSecretStore({ WELLSURE_AGENT_KEY: " wsa_abc ", [commKeyEnvName("AEXY-22")]: "123456" });
    expect(commKeyEnvName("AEXY-22")).toBe("WELLSURE_COMMKEY_AEXY_22");
    expect(await s.agentKey()).toBe("wsa_abc");
    expect(await s.commKey("AEXY-22")).toBe(123456);
    expect(await s.commKey("OTHER")).toBeNull();
    await expect(new EnvSecretStore({ [commKeyEnvName("X")]: "abc" }).commKey("X")).rejects.toThrow(/whole number/);
  });
});

it("the reported version is package.json's", () => {
  const pkg = JSON.parse(readFileSync(path.join(import.meta.dirname, "../../../package.json"), "utf8")) as { version: string };
  expect(AGENT_VERSION).toBe(pkg.version);
  mkdirSync(tmp(), { recursive: true });
});

describe("one agent per data folder", () => {
  const lockFile = (dir: string) => path.join(dir, "agent.lock");
  const hold = (dir: string, pid: number, ageMs: number) => {
    writeFileSync(lockFile(dir), JSON.stringify({ pid, startedAt: "2026-10-10T05:00:00Z" }));
    const t = (Date.now() - ageMs) / 1000;
    utimesSync(lockFile(dir), t, t);
  };

  it("a second agent is refused while the first runs, and releasing frees the folder", () => {
    const dir = tmp();
    const release = acquireAgentLock(dir); // this process: alive, fresh
    expect(() => acquireAgentLock(dir, process.pid + 1_000_000)).toThrow(AgentAlreadyRunningError);
    release();
    expect(existsSync(lockFile(dir))).toBe(false);
    acquireAgentLock(dir, process.pid + 1_000_000)();
  });

  it("a lock left by a dead agent is taken over at once", () => {
    const dir = tmp();
    hold(dir, 2_147_483_000, 0); // fresh, but no such process
    expect(() => acquireAgentLock(dir)()).not.toThrow();
  });

  it("a lock not refreshed for a minute is taken over even if its process ID now belongs to something else (Windows reuses IDs after a reboot)", () => {
    const dir = tmp();
    hold(dir, process.ppid, LOCK_STALE_MS + 5_000); // a live process, but the lock is stale
    expect(() => acquireAgentLock(dir)()).not.toThrow();
    hold(dir, process.ppid, 10_000); // live and fresh: a real agent
    expect(() => acquireAgentLock(dir)).toThrow(AgentAlreadyRunningError);
  });
});
