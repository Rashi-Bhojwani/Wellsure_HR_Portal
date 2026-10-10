import { defineConfig } from "vitest/config";
import path from "node:path";

// The 500-employee month replay (docs/plans/PHASE_2.md "P2-G build design"):
// `npm run test:replay`. Same services and global setup as the normal suite
// (its own test database, built from scratch), just a different set of files
// and a budget that allows a month of 500 people to be ingested and recomputed.
export default defineConfig({
  resolve: { alias: { "@shared": path.resolve(import.meta.dirname, "../shared") } },
  test: {
    environment: "node",
    include: ["src/**/*.replay.test.ts"],
    globalSetup: ["./vitest.globalSetup.ts"],
    fileParallelism: false,
    testTimeout: 1_800_000,
    hookTimeout: 1_800_000,
  },
});
