import { defineConfig } from "vitest/config";
import path from "node:path";

// The demo company (docs/plans/PHASE_6.md §14J): `npm run test:demo`. It seeds the whole fictional company into the suite's own test database and drives a payroll run through every
// step on it, which changes the company the ordinary tests assume, so it is its own run (its own database, built from scratch like the normal suite's), never part of `npm test`.
export default defineConfig({
  resolve: { alias: { "@shared": path.resolve(import.meta.dirname, "../shared") } },
  test: {
    environment: "node",
    include: ["src/**/*.demo.test.ts"],
    globalSetup: ["./vitest.globalSetup.ts"],
    fileParallelism: false,
    testTimeout: 600_000,
    hookTimeout: 900_000,
  },
});
