import { defineConfig, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Wires the @shared/* path alias to ../shared (mirrors tsconfig.json's
// "paths"), and explicitly allows serving files from ../shared during dev
// since it sits outside this project's root and has no package.json of
// its own for Vite to auto-detect as a workspace root.
const config: UserConfig = {
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  build: {
    // dist/.vite/manifest.json: scripts/check-bundle.mjs reads it to hold the JS budgets (DESIGN_SYSTEM.md §7: login < 250 KB gzip, shell + home < 400 KB).
    manifest: true,
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname, ".."), path.resolve(__dirname, "../shared")],
    },
  },
};

export default defineConfig(({ command }) => {
  // A build is always a production build, whatever NODE_ENV the shell
  // happens to export (Phase 5 commit G found a dev container with
  // NODE_ENV=development silently producing React's dev bundle with
  // import.meta.env.PROD false — so no service worker, and slower code).
  if (command === "build") process.env.NODE_ENV = "production";
  return config;
});
