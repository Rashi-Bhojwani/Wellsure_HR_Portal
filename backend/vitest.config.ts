import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(import.meta.dirname, "../shared"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The 500-employee month replay is its own job (`npm run test:replay`), not part of every run. Nor is the demo company's (`npm run test:demo`): it seeds a whole
    // fictional company into the test database, which changes the company every other test assumes.
    exclude: [...configDefaults.exclude, "**/*.replay.test.ts", "**/*.demo.test.ts"],
    globalSetup: ["./vitest.globalSetup.ts"],
    // Does nothing unless TEST_FAKE_NOW is set (npm run test:clock).
    setupFiles: ["./vitest.fakeClock.ts"],
    // Integration tests share one real Postgres/Redis instance and some
    // genuinely global rows (SystemSetting keys, rate-limit buckets keyed
    // by IP) — running test files in parallel races those. Small suite,
    // so sequential is cheap.
    fileParallelism: false,
    // Determinism (2026-10-02): vitest's 5 s/10 s defaults made slow CI
    // runners fail healthy tests (run #11: PDF rendering in a cold
    // Chromium; argon2 hashing and file polling are similar). These budgets
    // only change how long a genuinely stuck test takes to fail — never
    // whether a correct one passes.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
