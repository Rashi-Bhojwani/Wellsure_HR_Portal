#!/usr/bin/env node
// FIX-M9 (independent audit 2026-11-20, finding M9): fail on any high or critical npm advisory in the root, backend, frontend, biometric-agent or infra project,
// except the ones listed below, each with the reason it cannot be fixed yet. A new advisory, or a listed one appearing in another project, fails the check.
// Usage: node scripts/check-audit.mjs            (runs `npm audit --json` in each project; needs the registry)
//        node scripts/check-audit.mjs --from DIR (reads DIR/<project>.json instead: used by the test)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const PROJECTS = [".", "backend", "frontend", "biometric-agent", "infra"];

/** Known and not fixable without a major upgrade: project -> package -> reason. */
export const ACCEPTED = {
  backend: {
    prisma: "Fixed only in Prisma 7 (a major upgrade: new config and driver adapters). Build-time CLI; deferred, see AUDIT_FIX_REPORT.md M9.",
    "@prisma/config": "Pulled in by the Prisma 6 CLI; fixed only in Prisma 7.",
    "deepmerge-ts": "Pulled in by the Prisma 6 CLI config loader; fixed only in Prisma 7.",
    effect: "Pulled in by the Prisma 6 CLI config loader; fixed only in Prisma 7.",
  },
};

export function problems(reports) {
  const out = [];
  for (const [project, report] of Object.entries(reports)) {
    for (const [name, v] of Object.entries(report.vulnerabilities ?? {})) {
      if (v.severity !== "high" && v.severity !== "critical") continue;
      if (ACCEPTED[project]?.[name]) continue;
      out.push(`${project}: ${name} (${v.severity})`);
    }
  }
  return out;
}

function audit(project) {
  try {
    return JSON.parse(execFileSync("npm", ["audit", "--json"], { cwd: join(ROOT, project), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch (err) {
    // npm audit exits non-zero when it finds anything; its JSON is still on stdout.
    if (err.stdout) return JSON.parse(err.stdout);
    throw err;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fromIdx = process.argv.indexOf("--from");
  const reports = {};
  for (const p of PROJECTS) {
    const key = p === "." ? "root" : p;
    reports[key] = fromIdx > 0 ? JSON.parse(readFileSync(join(process.argv[fromIdx + 1], `${key}.json`), "utf8")) : audit(p);
  }
  const found = problems(reports);
  if (found.length) {
    console.error(`npm audit: ${found.length} high or critical advisory(ies) not accepted:\n  ${found.join("\n  ")}\nUpgrade the package, or (only if it cannot be fixed) list it in scripts/check-audit.mjs with the reason.`);
    process.exit(1);
  }
  console.log("npm audit: no unaccepted high or critical advisories.");
}
