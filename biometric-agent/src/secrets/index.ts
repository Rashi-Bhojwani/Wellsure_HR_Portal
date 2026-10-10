// Where the two kinds of secret come from (D-F4). config.json never holds
// either:
//   - the agent key (Admin Tools → Devices → Sync agents, shown once);
//   - each device's comm key (its connection password; absent or 0 = none).
// Windows: Credential Manager, under the service's own account (F2).
// Linux (development, CI): environment variables.

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

export function createSecretStore(kind: "credential-manager" | "env"): SecretStore {
  if (kind === "env") return new EnvSecretStore();
  // Windows Credential Manager under the service's account is built with the
  // Windows packaging (P2-F commit F2).
  throw new Error('secrets: "credential-manager" arrives with the Windows service (P2-F F2). Use secrets: "env" until then.');
}
