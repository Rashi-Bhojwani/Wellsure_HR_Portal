import { execSync } from "node:child_process";
import "../src/config/env";

// `npm run db:migrate`: applies pending migrations (prisma migrate deploy —
// additive, non-interactive). Importing config/env first runs the same
// validation and development-database guard (config/databaseGuard.ts) the
// backend itself runs, so migrations can't be applied to a remote database
// by accident from a dev machine. The Docker image's `migrate` mode
// (src/modes/migrate.ts) is the staging/production path, not this script.
execSync("npx prisma migrate deploy", { stdio: "inherit" });

// Same as the `migrate` mode: create any missing permission rows/system roles
// (additive only). Imported after the migration so the client sees the
// migrated schema.
const { ensureAccessCatalog } = await import("../src/lib/accessCatalog");
const { prisma } = await import("../src/lib/prisma");
await ensureAccessCatalog();
await prisma.$disconnect();
