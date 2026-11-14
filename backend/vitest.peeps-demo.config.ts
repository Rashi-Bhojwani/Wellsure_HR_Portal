import { defineConfig } from "vitest/config";
import path from "node:path";

// Peeps Stage 4 confidentiality scan on the demo company: `npm run test:peeps-demo`. Like `test:demo`, it seeds the whole fictional company into the
// suite's own test database (built from scratch by the global setup), so it is its own run, never part of `npm test` or `npm run test:demo`.
export default defineConfig({
  resolve: { alias: { "@shared": path.resolve(import.meta.dirname, "../shared") } },
  test: {
    environment: "node",
    include: ["src/**/*.peepsdemo.ts"], // not *.test.ts, so the main suite (vitest.config.ts) never picks it up
    globalSetup: ["./vitest.globalSetup.ts"],
    fileParallelism: false,
    testTimeout: 1_200_000,
    hookTimeout: 900_000,
  },
});
