import { defineConfig } from "vitest/config";
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
    // Integration tests share one real Postgres/Redis instance and some
    // genuinely global rows (SystemSetting keys, rate-limit buckets keyed
    // by IP) — running test files in parallel races those. Small suite,
    // so sequential is cheap.
    fileParallelism: false,
  },
});
