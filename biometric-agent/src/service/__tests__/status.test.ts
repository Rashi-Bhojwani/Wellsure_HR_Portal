import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../../config/load";
import { Outbox } from "../../sync/outbox";
import { emptyDeviceState } from "../../sync/state";
import { ago, describeStatus } from "../status";

const NOW = new Date("2026-10-10T06:00:00Z");

function dataDir(over: { lock?: "alive" | "dead" | "stale" | "none"; serverAgoMs?: number | null; device?: Partial<ReturnType<typeof emptyDeviceState>> | null; waiting?: number; setAside?: boolean } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wsa-status-"));
  const lock = over.lock ?? "alive";
  if (lock !== "none") {
    writeFileSync(path.join(dir, "agent.lock"), JSON.stringify({ pid: lock === "dead" ? 2_147_483_000 : process.pid, startedAt: "2026-10-10T05:00:00.000Z" }));
    const t = (NOW.getTime() - (lock === "stale" ? 10 * 60_000 : 5_000)) / 1000;
    utimesSync(path.join(dir, "agent.lock"), t, t);
  }
  const state = {
    version: 1,
    devices: over.device === null ? {} : { "AEXY225060969": { ...emptyDeviceState(), state: "OK", lastReadAt: new Date(NOW.getTime() - 12_000).toISOString(), clockOffsetSeconds: 3, ...over.device } },
    server: over.serverAgoMs === null ? null : { devices: [{ serial: "AEXY225060969", name: "C-10 entrance", timezone: "Asia/Kolkata", syncFrom: "2026-10-10", retentionDays: 3, retentionRecords: 20000, isSimulated: false }], thresholds: {}, receivedAt: new Date(NOW.getTime() - (over.serverAgoMs ?? 10_000)).toISOString() },
    pcClockOffsetSeconds: 0,
  };
  writeFileSync(path.join(dir, "state.json"), JSON.stringify(state));
  if (over.waiting) {
    const o = new Outbox(dir);
    o.init();
    o.append("AEXY225060969", Array.from({ length: over.waiting }, (_, i) => ({ line: `${i}\t2026-10-10 09:00:00\t1\t255\t1\t0`, localTime: "2026-10-10 09:00:00" })));
  }
  if (over.setAside) {
    mkdirSync(path.join(dir, "outbox-rejected"), { recursive: true });
    writeFileSync(path.join(dir, "outbox-rejected", "AEXY225060969-1.json"), JSON.stringify({ serial: "AEXY225060969", lines: [], oldestLocalTime: null }));
  }
  const config = parseConfig({ apiUrl: "https://api.example.com", dataDir: dir, devices: [{ serial: "AEXY225060969", host: "192.168.29.213" }] }, "linux");
  return { dir, config };
}

describe("wellsure-agent status", () => {
  it("working: running, the server answered lately, the device is read, nothing waiting", () => {
    const r = describeStatus(dataDir().config, NOW);
    expect(r.working).toBe(true);
    const text = r.lines.join("\n");
    expect(text).toMatch(/The agent is running \(process \d+/);
    expect(text).toMatch(/The server last answered it 10 s ago/);
    expect(text).toMatch(/Device AEXY225060969 \(C-10 entrance\) at 192\.168\.29\.213/);
    expect(text).toMatch(/is being read normally/);
    expect(text).toMatch(/Last read 12 s ago/);
    expect(text).toMatch(/Nothing waiting to be sent/);
    expect(r.lines.at(-1)).toBe("WORKING.");
  });

  it("not running: a dead process, or a lock nobody has refreshed for a minute, or no lock at all", () => {
    for (const lock of ["dead", "stale", "none"] as const) {
      const r = describeStatus(dataDir({ lock }).config, NOW);
      expect(r.working).toBe(false);
      expect(r.lines.join("\n")).toMatch(/The agent is NOT running/);
    }
  });

  it("says in plain words what is wrong with a device, and what to check", () => {
    const text = (device: Partial<ReturnType<typeof emptyDeviceState>>) => describeStatus(dataDir({ device }).config, NOW);
    const down = text({ state: "UNREACHABLE", lastError: "No answer from 192.168.29.213:4370" });
    expect(down.working).toBe(false);
    expect(down.lines.join("\n")).toMatch(/cannot be reached over the network.*Last error: No answer/s);
    expect(text({ state: "SERIAL_MISMATCH" }).lines.join("\n")).toMatch(/different machine/);
    expect(text({ state: "AUTH_FAILED" }).lines.join("\n")).toMatch(/comm key/);
    expect(text({ state: "OK", clockOffsetSeconds: 200 }).lines.join("\n")).toMatch(/clock is 3 min 20 s ahead/);
    expect(describeStatus(dataDir({ device: null }).config, NOW).lines.join("\n")).toMatch(/Not read yet/);
  });

  it("the server not answering is a problem (wrong address, no internet, or a wrong key)", () => {
    expect(describeStatus(dataDir({ serverAgoMs: 20 * 60_000 }).config, NOW)).toMatchObject({ working: false });
    const never = describeStatus(dataDir({ serverAgoMs: null }).config, NOW);
    expect(never.working).toBe(false);
    expect(never.lines.join("\n")).toMatch(/never answered it/);
  });

  it("counts punches waiting and batches the server refused, without touching either", () => {
    const { dir, config } = dataDir({ waiting: 7, setAside: true });
    const r = describeStatus(config, NOW);
    const text = r.lines.join("\n");
    expect(text).toMatch(/7 punch\(es\) waiting to be sent/);
    expect(text).toMatch(/1 batch\(es\) of punches the server refused.*quarantine/);
    expect(r.working).toBe(false);
    expect(Outbox.waitingOnDisk(dir, "AEXY225060969")).toEqual({ lines: 7, batches: 1 });
  });

  it("no data folder yet: not working, and says so", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "wsa-status-"));
    const config = parseConfig({ apiUrl: "https://api.example.com", dataDir: dir, devices: [{ serial: "X", host: "1.2.3.4" }] }, "linux");
    const r = describeStatus(config, NOW);
    expect(r.working).toBe(false);
    expect(r.lines.join("\n")).toMatch(/not recorded anything yet/);
  });

  it("times in words", () => {
    expect([ago(5_000), ago(120_000), ago(3 * 3_600_000 + 10 * 60_000), ago(3 * 86_400_000)]).toEqual(["5 s ago", "2 min ago", "3 h 10 min ago", "3 days ago"]);
  });
});
