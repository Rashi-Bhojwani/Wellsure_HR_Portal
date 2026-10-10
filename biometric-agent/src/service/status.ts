import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describeClockOffset } from "@shared/attendance/agentProtocol";
import type { LoadedConfig } from "../config/load";
import { inboxWaiting } from "../secrets/inbox";
import { Outbox } from "../sync/outbox";
import { readAgentLock } from "../sync/lock";
import { StateStore } from "../sync/state";
import { AGENT_VERSION } from "../version";

// `wellsure-agent status`: what is true right now, in sentences, for whoever is
// at the PC (possibly on the phone). Read-only: it looks at the data folder and
// the lock file and changes nothing. Exit code 0 means "working": an agent is
// running, the server has answered it lately, and every device is being read.
// install.ps1 waits for exactly that before it says the install worked.

const STATE_WORDS: Record<string, string> = {
  OK: "is being read normally",
  NOT_YET_READ: "has not been read yet",
  UNREACHABLE: "cannot be reached over the network (check it is switched on, and its IP address in config.json)",
  SERIAL_MISMATCH: "is a different machine from the one in config.json, so nothing is read from it (check the IP address)",
  AUTH_FAILED: "refused the connection password (the comm key); check it",
  NOT_ASSIGNED: "is not assigned to this agent in the app (Admin Tools → Devices)",
  UNSUPPORTED_FORMAT: "stores punches in a format this agent cannot read",
  CONFIG_REFUSED: "is set up as simulated here but is a real device in the app (or the reverse)",
};

export const SERVER_FRESH_MS = 5 * 60_000;

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function describeStatus(config: LoadedConfig, now: Date = new Date()): { lines: string[]; working: boolean } {
  const lines: string[] = [];
  const problems: string[] = [];
  lines.push(`Wellsure Agent ${AGENT_VERSION} on ${os.hostname()}`);

  const lock = readAgentLock(config.dataDir, () => now.getTime());
  if (lock) lines.push(`The agent is running (process ${lock.pid}${lock.startedAt ? `, since ${lock.startedAt.replace("T", " ").slice(0, 19)} UTC` : ""}).`);
  else {
    lines.push("The agent is NOT running.");
    problems.push("not running");
  }

  const stateFile = path.join(config.dataDir, "state.json");
  if (!existsSync(stateFile)) {
    lines.push("It has not recorded anything yet (no state.json in the data folder).");
    problems.push("nothing recorded yet");
    return { lines, working: false };
  }
  const state = new StateStore(config.dataDir).state;

  if (state.server && now.getTime() - Date.parse(state.server.receivedAt) < SERVER_FRESH_MS) lines.push(`The server last answered it ${ago(now.getTime() - Date.parse(state.server.receivedAt))}.`);
  else {
    lines.push(state.server ? `The server has not answered it for ${ago(now.getTime() - Date.parse(state.server.receivedAt)).replace(" ago", "")}. Check the internet connection, and that the agent key is right.` : "The server has never answered it. Check the address in config.json, the internet connection, and that the agent key is right.");
    problems.push("server not answering");
  }

  for (const d of config.devices) {
    const ds = state.devices[d.serial];
    const name = state.server?.devices.find((x) => x.serial === d.serial)?.name;
    lines.push("");
    lines.push(`Device ${d.serial}${name ? ` (${name})` : ""} at ${d.host}:`);
    if (!ds) {
      lines.push("  Not read yet.");
      problems.push(`${d.serial} not read yet`);
      continue;
    }
    lines.push(`  This device ${STATE_WORDS[ds.state] ?? ds.state}.`);
    if (ds.state !== "OK") problems.push(`${d.serial}: ${ds.state}`);
    if (ds.lastError && ds.state !== "OK") lines.push(`  Last error: ${ds.lastError}`);
    lines.push(ds.lastReadAt ? `  Last read ${ago(now.getTime() - Date.parse(ds.lastReadAt))}.` : "  Never read successfully.");
    const waiting = Outbox.waitingOnDisk(config.dataDir, d.serial);
    lines.push(waiting.lines ? `  ${waiting.lines} punch(es) waiting to be sent to the server.` : "  Nothing waiting to be sent.");
    if (ds.clockOffsetSeconds !== null) lines.push(`  The device's clock is ${describeClockOffset(ds.clockOffsetSeconds)} (set it from the device's own menu if it is more than a couple of minutes out).`);
  }

  const rejected = path.join(config.dataDir, "outbox-rejected");
  const setAside = existsSync(rejected) ? readdirSync(rejected).filter((f) => f.endsWith(".json") && !f.endsWith(".reason.json")).length : 0;
  lines.push("");
  if (setAside) {
    lines.push(`${setAside} batch(es) of punches the server refused are set aside here, not in attendance yet: run "wellsure-agent quarantine".`);
    problems.push("punches set aside");
  } else lines.push("No punches have been refused by the server.");

  const inbox = inboxWaiting(config.dataDir);
  if (inbox) {
    lines.push(`${inbox} secret(s) are still waiting in the secrets inbox: the agent could not store them in Windows Credential Manager (see its log).`);
    problems.push("secrets not stored");
  }

  lines.push("");
  lines.push(problems.length ? `NEEDS ATTENTION: ${problems.join("; ")}.` : "WORKING.");
  return { lines, working: problems.length === 0 };
}
