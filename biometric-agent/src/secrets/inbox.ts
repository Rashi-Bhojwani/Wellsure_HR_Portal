import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import type { Logger } from "../log";
import type { WindowsCredentialStore } from "./windowsCredentials";

// The secrets inbox (docs/plans/PHASE_2.md "P2-F, commit F2 build design").
//
// Credential Manager belongs to a Windows user, so the agent key and comm keys
// have to be written BY the service account. Rather than have the installer
// impersonate that account (which needs its password, and resetting a local
// account's password destroys its saved credentials), the installer — running
// as administrator — drops each value into <dataDir>\secrets-inbox\, a folder
// only administrators, SYSTEM and the service account can open. At start the
// agent, which already runs as that account, stores each value in Credential
// Manager and deletes the file. Rotating the key is the same: drop a file,
// restart the service.
//
//   agent-key.txt            → the agent key
//   commkey-<serial>.txt     → that device's comm key
//
// A value is never logged. A file that can't be stored is left in place (and
// the failure logged and raised in the event log) so a retry on the next start
// still has it.

export const INBOX_DIR = "secrets-inbox";

type Store = Pick<WindowsCredentialStore, "setAgentKey" | "setCommKey">;

export interface InboxResult {
  imported: string[];
  failed: Array<{ file: string; error: string }>;
}

export async function importSecretInbox(dataDir: string, store: Store, log: Logger): Promise<InboxResult> {
  const dir = path.join(dataDir, INBOX_DIR);
  const result: InboxResult = { imported: [], failed: [] };
  if (!existsSync(dir)) return result;
  for (const file of readdirSync(dir).sort()) {
    const full = path.join(dir, file);
    const comm = /^commkey-([A-Za-z0-9_.-]{1,64})\.txt$/.exec(file);
    if (file !== "agent-key.txt" && !comm) {
      log.warn("ignoring an unexpected file in the secrets inbox", { file });
      continue;
    }
    try {
      const value = readFileSync(full, "utf8").trim();
      if (!value) {
        rmSync(full, { force: true });
        continue;
      }
      if (comm) await store.setCommKey(comm[1]!, value);
      else await store.setAgentKey(value);
      rmSync(full, { force: true }); // only once it is safely in Credential Manager
      result.imported.push(file);
      log.info("stored a secret from the inbox in Windows Credential Manager", { file });
    } catch (err) {
      result.failed.push({ file, error: (err as Error).message });
      log.error("could not store a secret from the inbox; the file is left for the next start", { file, error: (err as Error).message });
    }
  }
  return result;
}

/** Files still waiting in the inbox (for `status`). */
export function inboxWaiting(dataDir: string): number {
  const dir = path.join(dataDir, INBOX_DIR);
  return existsSync(dir) ? readdirSync(dir).length : 0;
}
