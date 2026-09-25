import { execSync } from "node:child_process";
import { assertDevelopmentEnvironment } from "../src/lib/devGuard";

// Wipes and rebuilds the database from scratch: `prisma migrate reset
// --force` drops the database, recreates it, reapplies every migration,
// then runs prisma/seed.ts (wired via package.json's `prisma.seed`).
// Guarded independently of Prisma's own confirmation prompts — refuses
// outright unless APP_ENV is development, so this can never fire against
// staging/production even if invoked non-interactively there.
assertDevelopmentEnvironment("prisma migrate reset --force (drops and recreates the database)");

execSync("npx prisma migrate reset --force", { stdio: "inherit" });
