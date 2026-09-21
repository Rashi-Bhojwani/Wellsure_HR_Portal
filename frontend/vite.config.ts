import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Minimal Vite config — the React + Ant Design plugin setup lands in
// Phase 0. Wires the @shared/* path alias to ../shared (mirrors
// tsconfig.json's "paths"), and explicitly allows serving files from
// ../shared during dev since it sits outside this project's root and has
// no package.json of its own for Vite to auto-detect as a workspace root.
export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname, ".."), path.resolve(__dirname, "../shared")],
    },
  },
});
