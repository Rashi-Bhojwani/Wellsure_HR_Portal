import path from "node:path";
import { instantToLocalTime } from "@shared/attendance/attlog";
import { describeClockOffset } from "@shared/attendance/agentProtocol";
import { ConfigError, defaultConfigPath, loadConfig, type LoadedConfig } from "./config/load";
import { DeviceError } from "./device/driver";
import { createDriver } from "./device/factory";
import { Zk4370Driver } from "./device/zk/zkDriver";
import { createLogger } from "./log";
import { createSecretStore, EnvFirstSecretStore, type SecretStore } from "./secrets";
import { importSecretInbox } from "./secrets/inbox";
import { WindowsCredentialStore } from "./secrets/windowsCredentials";
import { Agent } from "./sync/agent";
import { acquireAgentLock, AgentAlreadyRunningError } from "./sync/lock";
import { Outbox } from "./sync/outbox";
import { alarmToEventLog, createEventLog, EVENT_IDS } from "./service/eventLog";
import { pruneRotatedLogs } from "./service/logs";
import { describeStatus } from "./service/status";
import { deviceMinusPcSeconds } from "./sync/clock";
import { AGENT_VERSION } from "./version";

// wellsure-agent <command> [--config <path>]
//   run           the sync agent (what the Windows service runs)
//   diagnose      connect to each device and print what it says; sends nothing
//   check-config  validate config.json and say which secrets are present (never their values)
//   status        what is true right now, in sentences; exit 0 only if it is working
//   quarantine    list the punch batches the server refused and the agent set aside;
//                 --export <folder> writes them as files Import Center accepts;
//                 --done moves them aside once a person has dealt with them
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
  if (secrets instanceof WindowsCredentialStore) {
    // The key and comm keys belong to the service account's Credential Manager, which this window can't see.
    out("agent key     held by the service account's Windows Credential Manager (not visible from here; `status` shows whether it works)");
    for (const d of config.devices) out(`device        ${d.serial} at ${d.host}:${d.port} (${d.driver})`);
    return 0;
  }
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

function quarantine(config: LoadedConfig): number {
  // Works on the data folder directly; safe beside a running agent, which only counts the files.
  const outbox = new Outbox(config.dataDir);
  const batches = outbox.quarantined();
  if (flag("done")) {
    const n = outbox.markQuarantinedHandled();
    out(n ? `${n} set-aside batch(es) moved to ${path.join(config.dataDir, "outbox-rejected", "handled")} (not deleted). The warning in the app clears within a minute.` : "Nothing was set aside.");
    return 0;
  }
  if (!batches.length) {
    out("Nothing is set aside: no punch batch has been refused by the server.");
    return 0;
  }
  out(`${batches.length} batch(es) of punches the server refused, kept on this PC (never deleted). They are NOT in attendance yet.`);
  for (const b of batches) {
    out(`  ${b.name}: ${b.lines.length} punch(es) from device ${b.serial}${b.oldestLocalTime ? `, earliest ${b.oldestLocalTime}` : ""}`);
    out(`    refused ${b.refusedAt ?? "(time not recorded)"}: ${b.reason}`);
  }
  const to = arg("export");
  if (to) {
    const files = outbox.exportQuarantined(to);
    out(`Wrote ${files.length} file(s) to ${to}. Upload each in the app: Import Center → Punches (ATTLOG), choosing the device ${batches[0]!.serial}. Then run: quarantine --done`);
  } else {
    out("To get them into attendance: quarantine --export <folder>, upload the files in Import Center → Punches (ATTLOG), then quarantine --done. If unsure, ask for help before doing anything.");
  }
  return 0;
}

function status(config: LoadedConfig): number {
  const { lines, working } = describeStatus(config);
  for (const l of lines) out(l);
  return working ? 0 : 1;
}

async function main(): Promise<number> {
  const command = process.argv.slice(2).find((a) => !a.startsWith("--") && process.argv[process.argv.indexOf(a) - 1]?.startsWith("--") !== true) ?? "run";
  if (command === "version") {
    out(`${AGENT_VERSION} (node ${process.versions.node})`);
    return 0;
  }
  const file = arg("config") ?? defaultConfigPath();
  const config = loadConfig(file);
  const secrets = createSecretStore(config.secrets);
  if (command === "check-config") return checkConfig(config, file, secrets);
  if (command === "diagnose") return diagnose(config, secrets instanceof WindowsCredentialStore ? new EnvFirstSecretStore(secrets) : secrets);
  if (command === "quarantine") return quarantine(config);
  if (command === "status") return status(config);
  if (command !== "run") {
    out(`Unknown command "${command}". Use run, status, diagnose, check-config, quarantine or version.`);
    return 2;
  }
  const release = acquireAgentLock(config.dataDir);
  const logger = createLogger(config.logLevel);
  const events = createEventLog(process.platform, logger);
  pruneRotatedLogs(path.join(config.dataDir, "logs"));
  // Windows: secrets the installer dropped in the inbox go into this account's Credential Manager first.
  if (secrets instanceof WindowsCredentialStore) {
    const inbox = await importSecretInbox(config.dataDir, secrets, logger);
    if (inbox.failed.length) events.write(EVENT_IDS.SECRETS_FAILED, "ERROR", `Could not store ${inbox.failed.length} secret(s) in Windows Credential Manager: ${inbox.failed[0]!.error}`);
  }
  const agent = new Agent({ config, secrets, logger, hooks: { onAlarm: alarmToEventLog(events) } });
  agent.start();
  events.write(EVENT_IDS.STARTED, "INFORMATION", `Wellsure Agent ${AGENT_VERSION} started, reading ${config.devices.map((d) => d.serial).join(", ")}.`);
  await new Promise<void>((resolve) => {
    const stop = () => void agent.stop().then(resolve);
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    process.once("SIGBREAK", stop); // Windows: Ctrl+Break, which a console stop can send instead of Ctrl+C
  });
  release();
  events.write(EVENT_IDS.STOPPED, "INFORMATION", `Wellsure Agent ${AGENT_VERSION} stopped.`);
  await new Promise((r) => setTimeout(r, 500)); // let the last event-log write leave
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`${err instanceof ConfigError || err instanceof AgentAlreadyRunningError ? err.message : (err as Error).stack ?? String(err)}\n`);
    process.exit(1);
  },
);
