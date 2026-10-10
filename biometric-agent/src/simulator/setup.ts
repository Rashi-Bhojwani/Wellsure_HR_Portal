import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ServerApi } from "./serverApi";

// `simulate setup`: registers the simulator's own agent and one simulated device
// per route through the same admin endpoints the Devices screen uses, and keeps
// the agent key in a private, gitignored folder (the key is shown by the server
// only once). Safe to run again: it reuses what exists.

export interface LocalSimulatorConfig {
  apiUrl: string;
  agentKey: string;
  agentId: string;
  serials: { agent: string; push: string; file: string };
  deviceIds: { agent: string; push: string; file: string };
}

export const LOCAL_DIR = ".simulator";
const AGENT_NAME = "Punch simulator agent (development)";
const SYNC_FROM = "2020-01-01"; // far back: a replay of any past day is not "before sync-from"

export const localConfigPath = (root: string) => path.join(root, LOCAL_DIR, "local.json");

export function readLocalConfig(root: string): LocalSimulatorConfig | null {
  const file = localConfigPath(root);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as LocalSimulatorConfig) : null;
}

interface DeviceRow {
  id: string;
  serialNumber: string;
  route: string;
  isSimulated: boolean;
}

export async function setupSimulator(api: ServerApi, root: string, suffix = "DEV"): Promise<LocalSimulatorConfig> {
  const existing = readLocalConfig(root);
  const agents = await api.request<{ agents: Array<{ id: string; name: string }> }>("GET", "/api/biometric/agents");
  let agent = agents.agents.find((a) => a.name === AGENT_NAME);
  let key = existing && existing.apiUrl === api.baseUrl ? existing.agentKey : "";
  if (!agent) {
    const made = await api.request<{ agent: { id: string; name: string }; key: string }>("POST", "/api/biometric/agents", { json: { name: AGENT_NAME } });
    agent = made.agent;
    key = made.key;
  } else if (!key) {
    key = (await api.request<{ key: string }>("POST", `/api/biometric/agents/${agent.id}/rotate-key`)).key;
  }

  const locations = await api.request<unknown>("GET", "/api/org/locations");
  const list = (Array.isArray(locations) ? locations : (locations as { locations: unknown[] }).locations) as Array<{ id: string; isActive: boolean; hasBiometricDevice: boolean }>;
  const location = list.find((l) => l.isActive && l.hasBiometricDevice) ?? list.find((l) => l.isActive);
  if (!location) throw new Error("There is no active location to attach the simulated devices to.");

  const devices = await api.request<{ devices: DeviceRow[] } | DeviceRow[]>("GET", "/api/biometric/devices");
  const rows = Array.isArray(devices) ? devices : devices.devices;
  const ensure = async (serial: string, route: "AGENT" | "PUSH", name: string) => {
    const found = rows.find((d) => d.serialNumber === serial);
    if (found) return found.id;
    const made = await api.request<{ id: string }>("POST", "/api/biometric/devices", {
      json: { serialNumber: serial, name, locationId: location.id, route, agentId: route === "AGENT" ? agent!.id : null, isSimulated: true, lanIp: "127.0.0.1", syncFrom: SYNC_FROM },
    });
    return made.id;
  };
  const serials = { agent: `SIM-AGENT-${suffix}`, push: `SIM-PUSH-${suffix}`, file: `SIM-FILE-${suffix}` };
  const deviceIds = {
    agent: await ensure(serials.agent, "AGENT", "Simulator device (agent route)"),
    push: await ensure(serials.push, "PUSH", "Simulator device (ADMS push route)"),
    file: await ensure(serials.file, "AGENT", "Simulator device (file route)"),
  };

  const config: LocalSimulatorConfig = { apiUrl: api.baseUrl, agentKey: key, agentId: agent.id, serials, deviceIds };
  mkdirSync(path.join(root, LOCAL_DIR), { recursive: true });
  writeFileSync(localConfigPath(root), JSON.stringify(config, null, 2), { mode: 0o600 });
  chmodSync(localConfigPath(root), 0o600);
  return config;
}
