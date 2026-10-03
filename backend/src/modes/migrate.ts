import { spawnSync } from "node:child_process";
import { ensureAccessCatalog } from "../lib/accessCatalog";
import { warnIfHistoryNeedsRepair } from "../lib/historyRepairNotice";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";

// Runs `prisma migrate deploy` (non-interactive, production-safe), then makes
// sure the access catalog exists (lib/accessCatalog.ts), and exits with its
// status code. CI/CD runs this as a one-off task before
// rolling the api/worker/scheduler services — see spec §15.5.
export async function runMigrate(): Promise<void> {
  logger.info("running prisma migrate deploy");
  const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    logger.error({ status: result.status, error: result.error }, "migrate failed");
    process.exit(result.status ?? 1);
  }

  // A database that's never seeded (staging/production) still needs the
  // system roles and permission rows — additive only, never edits a role.
  await ensureAccessCatalog();
  // Effective dating (EF1): report, never repair — a person previews and
  // approves the repair (npm run history:repair).
  await warnIfHistoryNeedsRepair((line) => logger.warn(line));
  await prisma.$disconnect();

  logger.info("migrate complete");
  process.exit(0);
}
