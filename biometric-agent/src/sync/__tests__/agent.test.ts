import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseAttlogLine } from "@shared/attendance/attlog";
import type { AgentDeviceConfig } from "@shared/attendance/agentProtocol";
import { parseConfig } from "../../config/load";
import { FakeZkDevice, type FakeDeviceOptions, type FakeRecord } from "../../dev/zkFakeDevice";
import { InMemorySimulatedSource, SimulatedDriver } from "../../device/simulated";
import { memoryLogger } from "../../log";
import { EnvSecretStore } from "../../secrets";
import { Agent, type AgentHooks } from "../agent";
import { FakeApi } from "./fakeApi";

// The sync agent end to end (docs/plans/PHASE_2.md §7.1, "P2-F build
// design"): the real agent and our real read-only driver, against the fake
// device over TCP and a fake API that drops exact duplicates like the real
// one. "Nothing lost" is checked as: every punch ever made on the device
// (from the sync-from date) is stored on the server.

const KEY = "wsa_test_key";
const SYNC = "2026-10-01";
const fakes: FakeZkDevice[] = [];
const apis: FakeApi[] = [];
const agents: Agent[] = [];

afterEach(async () => {
  for (const a of agents.splice(0)) await a.stop();
  for (const f of fakes) expect(f.violations, "the agent sent a command that isn't a read").toEqual([]);
  for (const f of fakes.splice(0)) await f.stop();
  for (const a of apis.splice(0)) await a.stop();
});

const rec = (deviceUserId: string, localTime: string): FakeRecord => ({ deviceUserId, localTime });
const serverDevice = (serial: string, over: Partial<AgentDeviceConfig> = {}): AgentDeviceConfig => ({ serial, name: `Device ${serial}`, timezone: "Asia/Kolkata", syncFrom: SYNC, retentionDays: 3, retentionRecords: 20_000, isSimulated: false, ...over });
const keyOf = (r: FakeRecord) => `${r.deviceUserId}|${r.localTime}`;

interface Setup {
  devices?: Array<Partial<FakeDeviceOptions> & { serial: string; down?: boolean }>;
  server?: AgentDeviceConfig[];
  key?: string;
  now?: () => Date;
  hooks?: AgentHooks;
  /** config.json's devices, given the started fake devices (default: each one, by its own serial). */
  configDevices?: (devs: Array<{ serial: string; port: number }>) => Array<Record<string, unknown>>;
  pollSeconds?: number;
}

async function setup(s: Setup = {}) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "wsa-agent-"));
  const specs = s.devices ?? [{ serial: "AEXY225060969" }];
  const devs = [];
  for (const spec of specs) {
    const device = new FakeZkDevice({ ...spec, serial: spec.serial });
    fakes.push(device);
    const { tcpPort } = await device.start({ udpPort: null });
    if (spec.down) await device.stop();
    devs.push({ device, port: tcpPort, serial: spec.serial });
  }
  const api = new FakeApi({ key: KEY, devices: s.server ?? specs.map((d) => serverDevice(d.serial)) });
  apis.push(api);
  const apiUrl = await api.start();
  const config = parseConfig(
    {
      apiUrl,
      dataDir,
      pollSeconds: s.pollSeconds ?? 5,
      backoff: { initialSeconds: 1, maxSeconds: 5 },
      deviceTimeoutSeconds: 2,
      devices: s.configDevices ? s.configDevices(devs) : devs.map((d) => ({ serial: d.serial, host: "127.0.0.1", port: d.port, transport: "tcp" })),
    },
    "linux",
  );
  const logger = memoryLogger();
  const make = (key = s.key ?? KEY, extra: Partial<ConstructorParameters<typeof Agent>[0]> = {}) => {
    const agent = new Agent({ config, secrets: new EnvSecretStore({ WELLSURE_AGENT_KEY: key }), logger, now: s.now, hooks: s.hooks, ...extra });
    agents.push(agent);
    return agent;
  };
  return { api, devs, device: devs[0]?.device as FakeZkDevice, serial: devs[0]?.serial as string, config, logger, make, dataDir };
}

/** One full turn: report in, read every device, send what's waiting. */
async function turn(agent: Agent, serials: string[]) {
  await agent.heartbeat();
  for (const s of serials) await agent.cycleDevice(s);
  return agent.sendPending();
}

const prepares = (d: FakeZkDevice) => d.commands.filter((c) => c === 1503).length;

describe("reading and sending", () => {
  it("sends every punch from the sync-from date — never older ones — and then polls cheaply until the count moves", async () => {
    const records = [rec("7", "2022-12-15 09:00:00"), rec("8", "2026-09-30 18:00:00"), rec("18", "2026-10-01 18:30:19"), rec("44", "2026-10-01 18:30:38"), rec("113", "2026-10-01 19:02:25"), rec("113", "2026-10-01 19:02:28")];
    const { api, device, serial, make } = await setup({ devices: [{ serial: "AEXY225060969", records }] });
    const agent = make();
    expect(await turn(agent, [serial])).toBe(true);
    expect(api.storedFor(serial)).toEqual(records.slice(2).map(keyOf).sort()); // the user's sample, including 113's two punches 3 s apart
    expect(prepares(device)).toBe(1);

    expect(await turn(agent, [serial])).toBe(true);
    expect(prepares(device)).toBe(1); // nothing new: only the record count was asked for
    expect(api.accepted).toHaveLength(1);

    const report = agent.report().devices[0]!;
    expect(report).toMatchObject({ device: serial, state: "OK", reachable: true, reportedSerial: serial, firmware: "Ver 6.60 Apr 28 2015", platform: "ZMM220_TFT", logCount: 6, logCapacity: 100_000, outboxRecords: 0 });
    expect(report.retention.state).toBe("OK");
    expect(report.secondsSinceLastRead).toBeLessThan(5);
  });

  it("a punch stamped EARLIER than the last one sent (the device clock was corrected backwards) is still sent", async () => {
    const { api, device, serial, make } = await setup({ devices: [{ serial: "AEXY225060969", records: [rec("18", "2026-10-05 10:00:00")] }] });
    const agent = make();
    await turn(agent, [serial]);
    device.punch("44", "2026-10-05 09:05:00"); // an hour "earlier": the clock was set back
    device.punch("45", "2026-10-05 09:06:00");
    await turn(agent, [serial]);
    expect(api.storedFor(serial)).toEqual(["18|2026-10-05 10:00:00", "44|2026-10-05 09:05:00", "45|2026-10-05 09:06:00"]);
  });

  it("a log that wraps when full, and a log cleared from the device's menu: only what's new is sent, and nothing is missed", async () => {
    const start = [1, 2, 3, 4, 5].map((i) => rec(String(i), `2026-10-02 09:0${i}:00`));
    const { api, device, serial, make, logger } = await setup({ devices: [{ serial: "AEXY225060969", records: start, logCapacity: 5, whenFull: "overwrite" }] });
    const agent = make();
    await turn(agent, [serial]);
    for (const i of [6, 7, 8]) device.punch(String(i), `2026-10-02 09:0${i}:00`); // overwrites 1–3
    await turn(agent, [serial]);
    expect(api.accepted.at(-1)!.lines.map((l) => (parseAttlogLine(l) as { deviceUserId: string }).deviceUserId)).toEqual(["6", "7", "8"]);
    device.clear();
    device.punch("9", "2026-10-02 10:00:00");
    await turn(agent, [serial]);
    expect(api.storedFor(serial)).toHaveLength(9);
    expect(logger.lines.some((l) => l.msg.includes("no longer holds"))).toBe(true);
  });

  it("moving the sync-from date earlier re-sends from that date; the server drops what it already has", async () => {
    const records = [rec("8", "2026-09-28 18:00:00"), rec("18", "2026-10-01 18:30:19")];
    const { api, serial, make } = await setup({ devices: [{ serial: "AEXY225060969", records }] });
    const agent = make();
    await turn(agent, [serial]);
    expect(api.storedFor(serial)).toEqual(["18|2026-10-01 18:30:19"]);
    api.devices = [serverDevice(serial, { syncFrom: "2026-09-25" })];
    await turn(agent, [serial]);
    expect(api.storedFor(serial)).toEqual(["18|2026-10-01 18:30:19", "8|2026-09-28 18:00:00"]);
    expect(api.accepted.at(-1)!.lines).toHaveLength(2); // both sent; one was a duplicate
  });

  it("2,500 new punches go as batches of at most 1,000, in order", async () => {
    const records = Array.from({ length: 2_500 }, (_, i) => rec(String((i % 120) + 2), `2026-10-0${1 + Math.floor(i / 400)} ${String(8 + Math.floor((i % 400) / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00`));
    const { api, serial, make } = await setup({ devices: [{ serial: "AEXY225060969", records }] });
    await turn(make(), [serial]);
    expect(api.accepted.map((a) => a.lines.length)).toEqual([1_000, 1_000, 500]);
    expect(api.storedFor(serial)).toHaveLength(new Set(records.map(keyOf)).size);
  });
});

describe("outages and crashes lose nothing", () => {
  it("while the API is down the agent keeps reading into the outbox — even as the device overwrites old punches — then catches up in order", async () => {
    const { api, device, serial, make } = await setup({ devices: [{ serial: "AEXY225060969", records: [], logCapacity: 4, whenFull: "overwrite" }] });
    const agent = make();
    await turn(agent, [serial]);
    api.mode = "down";
    const made: FakeRecord[] = [];
    for (let i = 0; i < 10; i++) {
      const r = rec(String(20 + i), `2026-10-03 10:${String(i).padStart(2, "0")}:00`);
      device.punch(r.deviceUserId, r.localTime);
      made.push(r);
      expect(await turn(agent, [serial])).toBe(false);
    }
    expect(device.records).toHaveLength(4); // the device itself now holds only the last four
    expect(agent.report().devices[0]!.outboxRecords).toBe(10);
    api.mode = "ok";
    expect(await agent.sendPending()).toBe(true);
    expect(api.storedFor(serial)).toEqual(made.map(keyOf).sort());
    const times = api.accepted.flatMap((a) => a.lines.map((l) => (parseAttlogLine(l) as { localTime: string }).localTime));
    expect(times).toEqual([...times].sort()); // oldest first
  });

  it("a crash after the outbox is written but before the cursor moves: the restarted agent sends again, nothing is lost or doubled", async () => {
    let crash = true;
    const hooks: AgentHooks = {
      afterOutboxWrite: () => {
        if (crash) {
          crash = false;
          throw new Error("power cut");
        }
      },
    };
    const records = [rec("18", "2026-10-04 09:00:00"), rec("44", "2026-10-04 09:01:00")];
    const { api, serial, make } = await setup({ devices: [{ serial: "AEXY225060969", records }], hooks });
    const first = make();
    await first.heartbeat();
    await first.cycleDevice(serial); // dies after writing the outbox
    expect(first.store.device(serial).cursor).toBeNull();
    const restarted = make(); // a new process on the same data folder
    await turn(restarted, [serial]);
    expect(api.storedFor(serial)).toEqual(records.map(keyOf).sort());
    expect(api.accepted.flatMap((a) => a.lines)).toHaveLength(4); // each sent twice; the server kept one
  });

  it("an answer lost after the server stored the batch: sent again, harmlessly", async () => {
    const { api, serial, make } = await setup({ devices: [{ serial: "AEXY225060969", records: [rec("18", "2026-10-04 09:00:00")] }] });
    const agent = make();
    await agent.heartbeat();
    await agent.cycleDevice(serial);
    api.mode = "acceptThenDrop";
    expect(await agent.sendPending()).toBe(false);
    expect(agent.report().devices[0]!.outboxRecords).toBe(1);
    expect(await agent.sendPending()).toBe(true);
    expect(api.storedFor(serial)).toEqual(["18|2026-10-04 09:00:00"]);
    expect(agent.report().devices[0]!.outboxRecords).toBe(0);
  });

  it("a rejected agent key: punches keep collecting; the restarted agent with the new key sends them all", async () => {
    const { api, device, serial, make } = await setup({ devices: [{ serial: "AEXY225060969", records: [rec("18", "2026-10-04 09:00:00")] }] });
    const agent = make();
    await turn(agent, [serial]);
    api.key = "wsa_rotated"; // rotated on the Devices screen; the PC still has the old one
    device.punch("44", "2026-10-04 09:30:00");
    await agent.cycleDevice(serial); // reading goes on with the settings it already has
    expect(await agent.sendPending()).toBe(false);
    expect(agent.report()).toMatchObject({ keyRejected: true, outboxRecords: 1 });
    const fixed = make("wsa_rotated");
    expect(await turn(fixed, [serial])).toBe(true);
    expect(api.storedFor(serial)).toEqual(["18|2026-10-04 09:00:00", "44|2026-10-04 09:30:00"]);
  });

  it("after a rejected key, the agent reads the key again: a corrected key works without a restart", async () => {
    const { api, serial, make } = await setup({ devices: [{ serial: "AEXY225060969", records: [rec("18", "2026-10-04 09:00:00")] }] });
    const env: NodeJS.ProcessEnv = { WELLSURE_AGENT_KEY: "wsa_old" };
    const agent = make(KEY, { secrets: new EnvSecretStore(env) });
    expect(await agent.heartbeat()).toBe(false); // 401
    env.WELLSURE_AGENT_KEY = KEY; // the right key stored (Credential Manager, from F2)
    expect(await turn(agent, [serial])).toBe(true);
    expect(api.storedFor(serial)).toEqual(["18|2026-10-04 09:00:00"]);
  });

  it("one device refused (403) is held back in the outbox; the other's punches still go", async () => {
    const { api, make } = await setup({ devices: [{ serial: "DEV-A", records: [rec("1", "2026-10-04 09:00:00")] }, { serial: "DEV-B", records: [rec("2", "2026-10-04 09:00:00")] }] });
    api.deviceMode.set("DEV-A", "403");
    const agent = make();
    expect(await turn(agent, ["DEV-A", "DEV-B"])).toBe(true);
    expect(api.storedFor("DEV-B")).toEqual(["2|2026-10-04 09:00:00"]);
    expect(api.storedFor("DEV-A")).toEqual([]);
    expect(agent.report().devices.find((d) => d.device === "DEV-A")!.outboxRecords).toBe(1);
  });

  it("a batch the API refuses as it stands (400) is set aside, never deleted, and the next ones go", async () => {
    const { api, device, serial, make } = await setup({ devices: [{ serial: "AEXY225060969", records: [rec("18", "2026-10-04 09:00:00")] }] });
    const agent = make();
    await agent.heartbeat();
    await agent.cycleDevice(serial);
    api.mode = "400";
    expect(await agent.sendPending()).toBe(true);
    expect(agent.outbox.quarantinedCount()).toBe(1);
    api.mode = "ok";
    device.punch("44", "2026-10-04 09:30:00");
    await turn(agent, [serial]);
    expect(api.storedFor(serial)).toEqual(["44|2026-10-04 09:30:00"]);
  });
});

describe("what isn't read, and why", () => {
  it("SERIAL_MISMATCH: the device at that address reports another serial — nothing is read or sent", async () => {
    const { api, device, make } = await setup({
      devices: [{ serial: "SOMEONE-ELSE", records: [rec("1", "2026-10-04 09:00:00")] }],
      server: [serverDevice("AEXY225060969")],
      configDevices: (devs) => [{ serial: "AEXY225060969", host: "127.0.0.1", port: devs[0]!.port, transport: "tcp" }], // the wrong IP in config.json
    });
    const agent = make();
    await agent.heartbeat();
    await agent.cycleDevice("AEXY225060969");
    const r = agent.report().devices[0]!;
    expect(r).toMatchObject({ state: "SERIAL_MISMATCH", reportedSerial: "SOMEONE-ELSE", outboxRecords: 0 });
    expect(r.lastError).toMatch(/Nothing was read or sent/);
    expect(prepares(device)).toBe(0);
    expect(api.accepted).toEqual([]);
  });

  it("NOT_YET_READ before the server's settings arrive; NOT_ASSIGNED for a device the server doesn't give this agent", async () => {
    const { api, serial, make } = await setup({ devices: [{ serial: "AEXY225060969", records: [rec("1", "2026-10-04 09:00:00")] }], server: [] });
    const agent = make();
    await agent.cycleDevice(serial);
    expect(agent.report().devices[0]!.state).toBe("NOT_YET_READ");
    await agent.heartbeat();
    await agent.cycleDevice(serial);
    expect(agent.report().devices[0]!.state).toBe("NOT_ASSIGNED");
    expect(prepares(fakes[0]!)).toBe(0);
    expect(api.accepted).toEqual([]);
  });

  it("one device down doesn't stop the other", async () => {
    const { api, make } = await setup({ devices: [{ serial: "DEV-DOWN", down: true }, { serial: "DEV-UP", records: [rec("5", "2026-10-04 09:00:00")] }] });
    const agent = make();
    await agent.heartbeat();
    await Promise.all([agent.cycleDevice("DEV-DOWN"), agent.cycleDevice("DEV-UP")]);
    await agent.sendPending();
    const states = Object.fromEntries(agent.report().devices.map((d) => [d.device, d.state]));
    expect(states).toEqual({ "DEV-DOWN": "UNREACHABLE", "DEV-UP": "OK" });
    expect(api.storedFor("DEV-UP")).toHaveLength(1);
  });

  it("a simulated driver is refused for a real device (CONFIG_REFUSED) and works for a simulated one (P2-F rule 3)", async () => {
    const source = new InMemorySimulatedSource({ serial: "SIM-1", records: [{ deviceUserId: "7", localTime: "2026-10-04 09:00:00", status: "1", verifyMode: "255", workcode: "0" }] });
    const configDevices = () => [{ serial: "SIM-1", host: "127.0.0.1", driver: "simulated", simulatedStateFile: "unused.json" }];
    const real = await setup({ devices: [], configDevices, server: [serverDevice("SIM-1", { isSimulated: false })] });
    const refused = real.make(KEY, { driverFor: () => new SimulatedDriver(source) });
    await refused.heartbeat();
    await refused.cycleDevice("SIM-1");
    expect(refused.report().devices[0]!.state).toBe("CONFIG_REFUSED");
    const sim = await setup({ devices: [], configDevices, server: [serverDevice("SIM-1", { isSimulated: true })] });
    const ok = sim.make(KEY, { driverFor: () => new SimulatedDriver(source) });
    await turn(ok, ["SIM-1"]);
    expect(sim.api.storedFor("SIM-1")).toEqual(["7|2026-10-04 09:00:00"]);
  });
});

describe("the retention guard, the log, and the clock", () => {
  it("WARNING at 50% and RISK at 75% of the retention window since the last successful read — with the API unreachable too — then back to OK", async () => {
    let clock = Date.parse("2026-10-06T04:30:00Z");
    const alarms: string[] = [];
    const { api, devs, serial, make, logger } = await setup({
      devices: [{ serial: "AEXY225060969", records: [rec("18", "2026-10-06 09:00:00")] }],
      now: () => new Date(clock),
      // The agent's clock is fixed in this test while the fake device's runs on, so the
      // agent rightly sees a drifting device clock too: only retention is counted here.
      hooks: { onAlarm: (_s, kind, level) => kind === "RETENTION" && alarms.push(`${kind}:${level}`) },
    });
    const agent = make();
    await turn(agent, [serial]); // read at t0; settings (3 days) remembered on disk
    api.mode = "down";
    await devs[0]!.device.stop(); // the device's network goes too
    const stateAfter = async (hours: number) => {
      clock = Date.parse("2026-10-06T04:30:00Z") + hours * 3_600_000;
      await agent.cycleDevice(serial);
      return agent.report().devices[0]!.retention.state;
    };
    expect(await stateAfter(30)).toBe("OK"); // 42% of 72 h
    expect(await stateAfter(40)).toBe("WARNING"); // 56%
    expect(await stateAfter(41)).toBe("WARNING");
    expect(await stateAfter(56)).toBe("RISK"); // 78%
    expect(alarms).toEqual(["RETENTION:warning", "RETENTION:error"]); // once per change, not every cycle
    expect(logger.lines.filter((l) => l.msg === "retention")).toHaveLength(2);
    await devs[0]!.device.start({ tcpPort: devs[0]!.port, udpPort: null });
    expect(await stateAfter(57)).toBe("OK");
    expect(alarms.at(-1)).toBe("RETENTION:recovered");
  });

  it("a nearly full log is its own alarm (90% by default)", async () => {
    const records = Array.from({ length: 95 }, (_, i) => rec(String(i + 2), `2026-10-06 09:${String(i % 60).padStart(2, "0")}:${String(Math.floor(i / 60)).padStart(2, "0")}`));
    const alarms: string[] = [];
    const { serial, make } = await setup({ devices: [{ serial: "AEXY225060969", records, logCapacity: 100 }], hooks: { onAlarm: (_s, kind, level) => alarms.push(`${kind}:${level}`) } });
    const agent = make();
    await turn(agent, [serial]);
    expect(agent.report().devices[0]!.retention).toMatchObject({ logFullPercent: 95, logNearlyFull: true, capacityUsed: 100 });
    expect(alarms).toContain("LOG_NEARLY_FULL:warning");
  });

  it("measures the device clock against the server's — not the PC's — and warns beyond the threshold; never sets it", async () => {
    const alarms: string[] = [];
    const { api, device, serial, make } = await setup({ devices: [{ serial: "AEXY225060969", clockOffsetSeconds: 200 }], hooks: { onAlarm: (_s, kind, level) => alarms.push(`${kind}:${level}`) } });
    const agent = make();
    await turn(agent, [serial]);
    expect(Math.abs(agent.report().devices[0]!.clockOffsetSeconds! - 200)).toBeLessThanOrEqual(2);
    expect(alarms).toEqual(["CLOCK_DRIFT:warning"]);
    // Now the PC's clock is the wrong one: 10 min ahead of the server, the device right.
    api.serverClockOffsetSeconds = -600;
    device.setClockOffset(-600);
    await turn(agent, [serial]);
    expect(Math.abs(agent.report().devices[0]!.clockOffsetSeconds!)).toBeLessThanOrEqual(2);
    expect(Math.abs(agent.report().pcClockOffsetSeconds! - 600)).toBeLessThanOrEqual(2);
    expect(alarms.at(-1)).toBe("CLOCK_DRIFT:recovered");
    expect(device.commands).not.toContain(202); // CMD_SET_TIME: never
  });
});

describe("running", () => {
  it("start(): reports in first, reads, sends, keeps going every poll; stop() finishes cleanly with the state on disk", async () => {
    const { api, device, serial, make } = await setup({ devices: [{ serial: "AEXY225060969", records: [rec("18", "2026-10-07 09:00:00")] }], pollSeconds: 5 });
    const agent = make();
    agent.start();
    const until = async (cond: () => boolean, ms = 12_000) => {
      const end = Date.now() + ms;
      while (!cond()) {
        if (Date.now() > end) throw new Error("timed out");
        await new Promise((r) => setTimeout(r, 50));
      }
    };
    await until(() => api.storedFor(serial).length === 1);
    expect(api.heartbeats[0]!.version).toBe("0.2.0");
    device.punch("44", "2026-10-07 09:05:00");
    await until(() => api.storedFor(serial).length === 2); // the next poll, 5 s later
    await agent.stop();
    const restarted = make();
    expect(restarted.store.device(serial).cursor?.position).toBe(2);
  }, 30_000);
});
