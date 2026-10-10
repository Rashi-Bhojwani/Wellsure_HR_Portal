import { instantToLocalTime } from "@shared/attendance/attlog";
import { describeClockOffset } from "@shared/attendance/agentProtocol";
import { ConfigError, defaultConfigPath, loadConfig, type LoadedConfig } from "./config/load";
import { DeviceError } from "./device/driver";
import { createDriver } from "./device/factory";
import { Zk4370Driver } from "./device/zk/zkDriver";
import { createLogger } from "./log";
import { createSecretStore, type SecretStore } from "./secrets";
import { Agent } from "./sync/agent";
import { acquireAgentLock, AgentAlreadyRunningError } from "./sync/lock";
import { deviceMinusPcSeconds } from "./sync/clock";
import { AGENT_VERSION } from "./version";

// wellsure-agent <command> [--config <path>]
//   run           the sync agent (what the Windows service runs)
//   diagnose      connect to each device and print what it says; sends nothing
//   check-config  validate config.json and say which secrets are present (never their values)
//   version
// docs/plans/PHASE_2.md "P2-F build design".

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);
const out = (line = "") => process.stdout.write(`${line}\n`);

async function diagnose(config: LoadedConfig, secrets: SecretStore): Promise<number> {
  // Read only, like the agent itself; nothing is sent anywhere.
  const tz = arg("timezone") ?? "Asia/Kolkata";
  const only = arg("serial");
  let failures = 0;
  for (const d of config.devices.filter((x) => !only || x.serial === only)) {
    out(`Device ${d.serial} at ${d.host}:${d.port} (${d.driver}, transport ${d.transport})`);
    const driver = createDriver(d, await secrets.commKey(d.serial), config.deviceTimeoutSeconds);
    try {
      await driver.connect();
      if (driver instanceof Zk4370Driver) out(`  connected over ${driver.transportKind?.toUpperCase()}`);
      const info = await driver.info();
      out(`  serial        ${info.serial ?? "(not given)"} ${info.serial === d.serial ? "✓ matches config.json" : "✗ DOES NOT MATCH config.json — the agent will read nothing from it"}`);
      out(`  platform      ${info.platform ?? "(not given)"}`);
      out(`  firmware      ${info.firmware ?? "(not given)"}`);
      out(`  users         ${info.userCount ?? "?"}`);
      const pct = info.logCount !== null && info.logCapacity ? ` (${Math.round((info.logCount / info.logCapacity) * 1000) / 10}% full)` : "";
      out(`  log           ${info.logCount ?? "?"} records of ${info.logCapacity ?? "?"} capacity${pct}`);
      const deviceTime = await driver.deviceTime();
      const pcNow = new Date();
      const offset = deviceMinusPcSeconds(deviceTime, tz, pcNow);
      out(`  device clock  ${deviceTime} (${tz})`);
      out(`  PC clock      ${instantToLocalTime(pcNow, tz)} — the device is ${describeClockOffset(offset)} (check the PC's own clock against an internet time source)`);
      if (!flag("no-read")) {
        const started = Date.now();
        const { format, records } = await driver.readAll(info.logCount);
        out(`  read          ${records.length} records (${format}-byte layout) in ${((Date.now() - started) / 1000).toFixed(1)} s`);
        if (records.length) out(`  oldest/newest ${records[0]!.localTime} … ${records[records.length - 1]!.localTime}`);
      }
    } catch (err) {
      failures++;
      out(`  ✗ ${err instanceof DeviceError ? `${err.kind}: ` : ""}${(err as Error).message}`);
    } finally {
      await driver.disconnect().catch(() => undefined);
    }
    out();
  }
  return failures ? 1 : 0;
}

async function checkConfig(config: LoadedConfig, file: string, secrets: SecretStore): Promise<number> {
  out(`config        ${file}: valid`);
  out(`API           ${config.apiUrl}`);
  out(`poll          every ${config.pollSeconds} s`);
  out(`data folder   ${config.dataDir}`);
  out(`secrets from  ${config.secrets}`);
  let ok = true;
  try {
    const key = await secrets.agentKey();
    out(`agent key     ${key ? "present" : "MISSING"}`);
    ok &&= !!key;
    for (const d of config.devices) out(`device        ${d.serial} at ${d.host}:${d.port} (${d.driver}); comm key ${(await secrets.commKey(d.serial)) === null ? "none stored (0)" : "stored"}`);
  } catch (err) {
    out(`secrets       ✗ ${(err as Error).message}`);
    ok = false;
  }
  return ok ? 0 : 1;
}

async function main(): Promise<number> {
  const command = process.argv.slice(2).find((a) => !a.startsWith("--") && process.argv[process.argv.indexOf(a) - 1]?.startsWith("--") !== true) ?? "run";
  if (command === "version") {
    out(AGENT_VERSION);
    return 0;
  }
  const file = arg("config") ?? defaultConfigPath();
  const config = loadConfig(file);
  const secrets = createSecretStore(config.secrets);
  if (command === "check-config") return checkConfig(config, file, secrets);
  if (command === "diagnose") return diagnose(config, secrets);
  if (command !== "run") {
    out(`Unknown command "${command}". Use run, diagnose, check-config or version.`);
    return 2;
  }
  const release = acquireAgentLock(config.dataDir);
  const agent = new Agent({ config, secrets, logger: createLogger(config.logLevel) });
  agent.start();
  await new Promise<void>((resolve) => {
    const stop = () => void agent.stop().then(resolve);
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  release();
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`${err instanceof ConfigError || err instanceof AgentAlreadyRunningError ? err.message : (err as Error).stack ?? String(err)}\n`);
    process.exit(1);
  },
);
