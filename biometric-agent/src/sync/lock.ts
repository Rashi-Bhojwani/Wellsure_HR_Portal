import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

// One agent per data folder. Two at once (the service, plus someone running
// the program by hand) would lose nothing — the server drops duplicates — but
// they would race on the cursor and the outbox. So `run` takes this lock.
//
// A process ID alone can't be trusted: Windows reuses IDs after a reboot, so a
// stale lock could point at some unrelated live process and keep the service
// from ever starting. So the running agent refreshes the lock every 20 s, and
// a lock counts as held only if its process exists AND it was refreshed within
// the last 60 s. A stale lock always heals within a minute.

export const LOCK_REFRESH_MS = 20_000;
export const LOCK_STALE_MS = 60_000;

export class AgentAlreadyRunningError extends Error {
  readonly name = "AgentAlreadyRunningError";
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM"; // exists, but not ours to signal
  }
};

/** Who holds the lock, if anyone does right now (`status`): its process exists and it was refreshed within the last minute. */
export function readAgentLock(dataDir: string, now: () => number = Date.now): { pid: number; startedAt: string | null } | null {
  const file = path.join(dataDir, "agent.lock");
  try {
    const holder = JSON.parse(readFileSync(file, "utf8")) as { pid?: number; startedAt?: string };
    if (!holder.pid || now() - statSync(file).mtimeMs >= LOCK_STALE_MS || !alive(holder.pid)) return null;
    return { pid: holder.pid, startedAt: holder.startedAt ?? null };
  } catch {
    return null;
  }
}

export function acquireAgentLock(dataDir: string, pid: number = process.pid, now: () => number = Date.now): () => void {
  mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, "agent.lock");
  const startedAt = new Date(now()).toISOString();
  const write = () => writeFileSync(file, JSON.stringify({ pid, startedAt })); // rewritten to show it is alive; startedAt stays the start
  let holder: { pid?: number; startedAt?: string } | null = null;
  try {
    holder = JSON.parse(readFileSync(file, "utf8")) as { pid?: number; startedAt?: string };
  } catch {
    holder = null; // none, or unreadable: free
  }
  if (holder?.pid && holder.pid !== pid) {
    const fresh = now() - statSync(file).mtimeMs < LOCK_STALE_MS;
    if (fresh && alive(holder.pid)) {
      throw new AgentAlreadyRunningError(`Another agent (process ${holder.pid}, started ${holder.startedAt ?? "?"}) is already running on ${dataDir}. Stop it first; only one agent may use a data folder.`);
    }
  }
  write();
  const timer = setInterval(write, LOCK_REFRESH_MS);
  timer.unref();
  return () => {
    clearInterval(timer);
    try {
      const current = JSON.parse(readFileSync(file, "utf8")) as { pid?: number };
      if (current.pid === pid) rmSync(file, { force: true });
    } catch {
      // already gone
    }
  };
}
