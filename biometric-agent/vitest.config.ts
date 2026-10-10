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
    // Network tests open real sockets on localhost; generous budgets only
    // change how long a genuinely stuck test takes to fail.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
