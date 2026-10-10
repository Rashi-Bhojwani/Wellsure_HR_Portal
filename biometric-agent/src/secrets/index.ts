// Where the two kinds of secret come from (D-F4). config.json never holds
// either:
//   - the agent key (Admin Tools → Devices → Sync agents, shown once);
//   - each device's comm key (its connection password; absent or 0 = none).
// Windows: Credential Manager, under the service's own account (windowsCredentials.ts).
// Linux (development, CI): environment variables.

import { WindowsCredentialStore } from "./windowsCredentials";

export interface SecretStore {
  agentKey(): Promise<string | null>;
  commKey(serial: string): Promise<number | null>;
}

/** WELLSURE_COMMKEY_<serial with non-alphanumerics as _>, e.g. WELLSURE_COMMKEY_AEXY225060969. */
export const commKeyEnvName = (serial: string) => `WELLSURE_COMMKEY_${serial.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
export const AGENT_KEY_ENV = "WELLSURE_AGENT_KEY";

export class EnvSecretStore implements SecretStore {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async agentKey(): Promise<string | null> {
    return this.env[AGENT_KEY_ENV]?.trim() || null;
  }

  async commKey(serial: string): Promise<number | null> {
    const raw = this.env[commKeyEnvName(serial)]?.trim();
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 999_999_999) throw new Error(`${commKeyEnvName(serial)} must be a whole number (the device's comm key).`);
    return n;
  }
}

/**
 * `diagnose` runs in an administrator's window, but on Windows the real secrets
 * belong to the service account's Credential Manager, which that window can't
 * see. So a comm key typed into the environment for the diagnosis
 * (WELLSURE_COMMKEY_<SERIAL>) wins, and anything else falls through.
 */
export class EnvFirstSecretStore implements SecretStore {
  private readonly env = new EnvSecretStore();
  constructor(private readonly fallback: SecretStore) {}
  async agentKey(): Promise<string | null> {
    return (await this.env.agentKey()) ?? this.fallback.agentKey();
  }
  async commKey(serial: string): Promise<number | null> {
    return (await this.env.commKey(serial)) ?? this.fallback.commKey(serial);
  }
}

export function createSecretStore(kind: "credential-manager" | "env"): SecretStore {
  return kind === "env" ? new EnvSecretStore() : new WindowsCredentialStore();
}
