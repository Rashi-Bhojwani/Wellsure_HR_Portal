import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Route-config tests only, for now (frontend/src/routes/__tests__/) — no
// jsdom/DOM needed, since the check inspects the plain, structurally
// computed `kind` field resolveMenuRoutes.tsx returns for each route,
// never renders anything.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": path.resolve(import.meta.dirname, "../shared"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
