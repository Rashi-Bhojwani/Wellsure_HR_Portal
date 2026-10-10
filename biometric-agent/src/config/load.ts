import { readFileSync } from "node:fs";
import path from "node:path";
import { agentConfigSchema, type AgentConfig } from "./schema";

/** Windows: under %ProgramData% (C:\ProgramData on a normal PC), so the service needs no path arguments; elsewhere the working directory. */
const winDir = () => path.win32.join(process.env.ProgramData ?? "C:\\ProgramData", "Wellsure Agent");

export function defaultConfigPath(platform: NodeJS.Platform = process.platform): string {
  return process.env.WELLSURE_AGENT_CONFIG ?? (platform === "win32" ? path.win32.join(winDir(), "config.json") : path.resolve("config.json"));
}

export function defaultDataDir(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? winDir() : path.resolve("agent-data");
}

export interface LoadedConfig extends AgentConfig {
  dataDir: string;
  secrets: "credential-manager" | "env";
}

export class ConfigError extends Error {
  readonly name = "ConfigError";
}

export function parseConfig(raw: unknown, platform: NodeJS.Platform = process.platform): LoadedConfig {
  const parsed = agentConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(top level)"}: ${i.message}`).join("\n");
    throw new ConfigError(`config.json isn't valid:\n${problems}`);
  }
  return {
    ...parsed.data,
    dataDir: parsed.data.dataDir ?? defaultDataDir(platform),
    secrets: parsed.data.secrets ?? (platform === "win32" ? "credential-manager" : "env"),
  };
}

export function loadConfig(file: string = defaultConfigPath()): LoadedConfig {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    throw new ConfigError(`Can't read ${file}: ${(err as Error).message}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, "")); // Notepad and PowerShell 5 can save UTF-8 with a byte-order mark
  } catch (err) {
    throw new ConfigError(`${file} isn't valid JSON: ${(err as Error).message}`);
  }
  return parseConfig(raw);
}
