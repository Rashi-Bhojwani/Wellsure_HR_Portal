import { spawnSync } from "node:child_process";
import { env } from "../config/env";
import { ensureAccessCatalog } from "../lib/accessCatalog";
import { ensureDatabaseRoles } from "../lib/dbRoles";
import { warnIfHistoryNeedsRepair } from "../lib/historyRepairNotice";
import { ensurePayrollRules } from "../modules/payroll/rules/governed";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";

// Runs `prisma migrate deploy` (non-interactive, production-safe), then makes
// sure the access catalog exists (lib/accessCatalog.ts) and the database roles
// are in place (lib/dbRoles.ts), and exits with its
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
  // Payroll ships no rule value (Stage 3.2): this creates nothing today and is kept so an older database is brought forward the same way.
  await ensurePayrollRules();
  // Who may do what (lib/dbRoles.ts): the app role is created or refreshed, granted the data and denied every write to the append-only tables,
  // on every run, so a table a new migration made append-only is covered the same deploy. Required outside development.
  if (env.DB_APP_PASSWORD) {
    const databaseName = decodeURIComponent(new URL(env.DATABASE_URL).pathname.replace(/^\//, ""));
    const { appendOnly } = await ensureDatabaseRoles(prisma, { appRole: env.DB_APP_ROLE, appPassword: env.DB_APP_PASSWORD, databaseName });
    logger.info({ appRole: env.DB_APP_ROLE, appendOnlyTables: appendOnly.length }, "database roles ensured");
  } else if (env.APP_ENV !== "development") {
    logger.error("DB_APP_PASSWORD is required outside development: the migrate task creates the app's database role with it.");
    process.exit(1);
  }
  // Effective dating (EF1): report, never repair — a person previews and
  // approves the repair (npm run history:repair).
  await warnIfHistoryNeedsRepair((line) => logger.warn(line));
  await prisma.$disconnect();

  logger.info("migrate complete");
  process.exit(0);
}
