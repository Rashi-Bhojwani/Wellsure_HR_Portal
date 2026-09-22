import { spawnSync } from "node:child_process";
import { logger } from "../lib/logger";

// Runs `prisma migrate deploy` (non-interactive, production-safe) and
// exits with its status code. CI/CD runs this as a one-off task before
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

  logger.info("migrate complete");
  process.exit(0);
}
