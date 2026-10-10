import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

// NSSM rotates agent.log at 10 MB into agent-<timestamp>.log but never deletes
// the old ones. The agent keeps the newest few at start, so the log folder
// can't grow without bound on a PC nobody looks at.

export const KEEP_ROTATED_LOGS = 10;

export function pruneRotatedLogs(logDir: string, keep: number = KEEP_ROTATED_LOGS): string[] {
  if (!existsSync(logDir)) return [];
  const rotated = readdirSync(logDir)
    .filter((f) => /^agent-.+\.log$/.test(f)) // never agent.log itself
    .map((f) => ({ f, at: statSync(path.join(logDir, f)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  const gone = rotated.slice(keep).map((x) => x.f);
  for (const f of gone) rmSync(path.join(logDir, f), { force: true });
  return gone;
}
