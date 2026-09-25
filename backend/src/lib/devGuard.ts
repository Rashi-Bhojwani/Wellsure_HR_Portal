import { env } from "../config/env";

// Refuses to proceed unless APP_ENV is development — the last line of
// defense in front of anything destructive (currently: wiping and
// reseeding the database). Used by prisma/seed.ts and scripts/reset-db.ts.
export function assertDevelopmentEnvironment(action: string): void {
  if (env.APP_ENV !== "development") {
    console.error(`Refusing to run ${action}: APP_ENV is "${env.APP_ENV}", not "development".`);
    process.exit(1);
  }
}
