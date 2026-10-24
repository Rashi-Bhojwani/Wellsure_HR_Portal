// Design-system guard for CI (docs/DESIGN_SYSTEM.md §13, CLAUDE.md "UI rules"):
//   1. no raw colour (hex, rgb(), hsl()) in src/ outside src/theme/ — in .ts, .tsx and .css files (ESLint covers TS too; this also covers CSS);
//   2. every light token in src/theme/tokens.ts has a dark twin, and the reverse.
// Run: npm run check:tokens  (also part of npm run lint). Exit code 1 lists every problem.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "src");
const problems = [];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const COLOUR = /(#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-]))|\b(rgba?|hsla?)\(/g;
for (const file of walk(src)) {
  const rel = path.relative(root, file);
  if (rel.startsWith(path.join("src", "theme") + path.sep)) continue;
  if (!/\.(tsx?|css)$/.test(file) || /\.test\.tsx?$/.test(file) || rel.includes(`${path.sep}__tests__${path.sep}`)) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
    // Skip CSS custom-property references and JSX entity-like ids (e.g. href="#main").
    for (const m of code.matchAll(COLOUR)) {
      const before = code.slice(0, m.index);
      if (m[1] && /(href|id|to|key)=["'`]?$|#main/.test(before + m[1])) continue;
      if (m[1] && /url\(\s*$/.test(before)) continue;
      problems.push(`${rel}:${i + 1}: raw colour "${m[0]}" — use a token from src/theme/tokens.ts`);
    }
  });
}

function keysOf(name) {
  const text = readFileSync(path.join(src, "theme", "tokens.ts"), "utf8");
  const start = text.indexOf(`export const ${name}: Palette = {`);
  if (start < 0) {
    problems.push(`src/theme/tokens.ts: no "export const ${name}: Palette" block`);
    return new Set();
  }
  const end = text.indexOf("\n};", start);
  return new Set([...text.slice(start, end).matchAll(/^\s{2}([a-zA-Z0-9]+):/gm)].map((m) => m[1]));
}
const light = keysOf("light");
const dark = keysOf("dark");
for (const k of light) if (!dark.has(k)) problems.push(`src/theme/tokens.ts: dark theme is missing "${k}"`);
for (const k of dark) if (!light.has(k)) problems.push(`src/theme/tokens.ts: light theme is missing "${k}"`);

if (problems.length) {
  console.error(`Design-token check failed (${problems.length}):\n - ${problems.join("\n - ")}`);
  process.exit(1);
}
console.log(`Design tokens OK: no raw colours outside src/theme, ${light.size} tokens in both themes.`);
