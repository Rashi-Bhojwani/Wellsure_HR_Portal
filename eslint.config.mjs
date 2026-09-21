import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

// Flat ESLint config shared by every app/package in the monorepo.
// Per-app rule overrides (React hooks, Node globals, etc.) are added once
// each app's real source code lands, starting Phase 0.
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/cdk.out/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
);
