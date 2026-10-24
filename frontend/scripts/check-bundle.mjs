// JS budgets (docs/DESIGN_SYSTEM.md §7): what a browser must download, gzipped, before the screen can render.
//   login            ≤ 250 KB: the entry chunk + the LoginPage chunk + everything they import statically;
//   shell + home     ≤ 400 KB: the entry (which holds both layouts / the app shell) + the employee HomePage chunk + their static imports.
// Run after `vite build` (needs dist/.vite/manifest.json): npm run build && npm run check:bundle.
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const manifest = JSON.parse(readFileSync(path.join(dist, ".vite", "manifest.json"), "utf8"));

function closure(keys) {
  const seen = new Set();
  const visit = (k) => {
    if (seen.has(k) || !manifest[k]) return;
    seen.add(k);
    for (const i of manifest[k].imports ?? []) visit(i);
  };
  keys.forEach(visit);
  return [...seen];
}
const gz = (file) => gzipSync(readFileSync(path.join(dist, file))).length;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const entry = Object.keys(manifest).find((k) => manifest[k].isEntry);
const find = (needle) => Object.keys(manifest).find((k) => k.includes(needle));

const budgets = [
  { name: "login", limit: 250 * 1024, keys: [entry, find("pages/auth/login/LoginPage")] },
  { name: "shell + employee home", limit: 400 * 1024, keys: [entry, find("layouts/EmployeeLayout"), find("pages/employee/home/HomePage")] },
  { name: "shell + admin home", limit: 400 * 1024, keys: [entry, find("layouts/AdminLayout"), find("pages/admin/home/HomePage")] },
];

let failed = false;
for (const b of budgets) {
  const files = closure(b.keys.filter(Boolean)).map((k) => manifest[k].file).filter((f) => f.endsWith(".js"));
  const css = closure(b.keys.filter(Boolean)).flatMap((k) => manifest[k].css ?? []);
  const total = files.reduce((s, f) => s + gz(f), 0);
  const ok = total <= b.limit;
  failed ||= !ok;
  console.log(`${ok ? "ok  " : "FAIL"} ${b.name.padEnd(24)} ${kb(total).padStart(9)} JS gzip (budget ${kb(b.limit)}), ${files.length} chunks; CSS ${kb(css.reduce((s, f) => s + gz(f), 0))}`);
}
process.exit(failed ? 1 : 0);
