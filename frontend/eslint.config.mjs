import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat["recommended-latest"],
  reactRefresh.configs.vite,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  // Design-system guard (docs/DESIGN_SYSTEM.md, CLAUDE.md "UI rules"): colours and font sizes come from src/theme/tokens.ts, never written inline.
  // scripts/check-design-tokens.mjs repeats the colour check for files ESLint does not parse (CSS, HTML) and runs in CI.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/theme/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![0-9a-zA-Z])/]",
          message: "No raw hex colours outside src/theme: use a token (v.* CSS variables or theme.useToken()).",
        },
        {
          selector: "TemplateElement[value.raw=/#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![0-9a-zA-Z])/]",
          message: "No raw hex colours outside src/theme: use a token (v.* CSS variables or theme.useToken()).",
        },
        {
          selector: "Literal[value=/\\b(?:rgba?|hsla?)\\(/]",
          message: "No raw rgb()/hsl() colours outside src/theme: use a token.",
        },
        {
          selector: "Property[key.name='fontSize'][value.type='Literal']",
          message: "No one-off font sizes: use the type scale (fs.* from src/theme/tokens.ts).",
        },
      ],
    },
  },
  eslintConfigPrettier,
);
