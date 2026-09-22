// Single entrypoint, four modes — set APP_MODE or pass it as the first CLI
// arg (`tsx src/index.ts worker`). See docs/PROJECT_SPEC.md §15.2.3: the
// same image runs as the `api`, `worker` and `scheduler` ECS services and
// as the one-off `migrate` task.
import { env } from "./config/env";
import { logger } from "./lib/logger";

const mode = process.argv[2] ?? env.APP_MODE;

async function main(): Promise<void> {
  switch (mode) {
    case "api": {
      const { runApi } = await import("./modes/api");
      await runApi();
      break;
    }
    case "worker": {
      const { runWorker } = await import("./modes/worker");
      await runWorker();
      break;
    }
    case "scheduler": {
      const { runScheduler } = await import("./modes/scheduler");
      await runScheduler();
      break;
    }
    case "migrate": {
      const { runMigrate } = await import("./modes/migrate");
      await runMigrate();
      break;
    }
    default:
      throw new Error(`Unknown APP_MODE: "${mode}". Expected api | worker | scheduler | migrate.`);
  }
}

main().catch((err: unknown) => {
  logger.error({ err }, "fatal error during startup");
  process.exit(1);
});
