import { createInterface } from "node:readline/promises";
import { env } from "../../src/config/env";
import { maskDatabaseUrl } from "../../src/config/databaseGuard";
import { logger } from "../../src/lib/logger";
import { startSocketEmitter, stopSocketEmitter } from "../../src/realtime/emitter";

// Small helpers shared by the admin CLIs (admin-bootstrap, admin-recover).

// --flag value | --flag=value | --switch  →  { flag: "value", switch: true }
export function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq !== -1) out[a.slice(2, eq)] = a.slice(eq + 1);
    else if (argv[i + 1] !== undefined && !argv[i + 1]!.startsWith("--")) out[a.slice(2)] = argv[++i]!;
    else out[a.slice(2)] = true;
  }
  return out;
}

export const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

export async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

// Printed first, so the operator sees exactly which environment and
// database they're about to change.
export function printTarget(title: string): void {
  console.log(`\n${title}`);
  console.log(`  Environment : ${env.APP_ENV}`);
  console.log(`  Database    : ${maskDatabaseUrl(env.DATABASE_URL)}`);
  console.log(`  Portal URL  : ${env.WEB_BASE_URL}\n`);
}

export async function confirmOrExit(yesFlag: boolean): Promise<void> {
  if (yesFlag) return;
  if (!interactive) {
    console.error("Not running interactively: pass --yes to confirm.");
    process.exit(1);
  }
  const answer = await ask('Type "yes" to continue: ');
  if (answer.toLowerCase() !== "yes") {
    console.log("Cancelled — nothing was changed.");
    process.exit(1);
  }
}

// The CLIs run as their own process with no Socket.IO server, so — like the
// worker — they publish live signals (the Super Admins' security banner)
// through Redis to the api servers. If Redis is down the CLI still works:
// the banner then appears on the next refresh (it also polls every minute).
export async function startLiveSignals(): Promise<void> {
  try {
    await startSocketEmitter();
  } catch (err) {
    logger.warn({ err }, "live signals unavailable (Redis down?) — the security banner will appear on the next refresh");
  }
}
export const stopLiveSignals = stopSocketEmitter;
