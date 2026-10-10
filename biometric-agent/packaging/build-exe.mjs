// Builds the single executable (docs/plans/PHASE_2.md "P2-F, commit F2 build
// design"): esbuild bundles the agent into one CommonJS file (zod is the only
// runtime dependency; zkteco-js is test-only and never ships), then it becomes
// a Node single-executable application — the SEA blob injected into a copy of
// the node binary running this script. Run on Windows (CI) it makes
// wellsure-agent.exe; the same recipe on Linux makes an executable we can run
// and test here.
//
//   node packaging/build-exe.mjs [--out dist]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outIdx = process.argv.indexOf("--out");
const outDir = path.resolve(root, outIdx >= 0 ? process.argv[outIdx + 1] : "dist");
const exeName = process.platform === "win32" ? "wellsure-agent.exe" : "wellsure-agent";
const bundle = path.join(outDir, "agent.cjs");
const blob = path.join(outDir, "sea-prep.blob");
const exe = path.join(outDir, exeName);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [path.join(root, "src/main.ts")],
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  alias: { "@shared": path.join(root, "../shared") },
  logLevel: "warning",
  legalComments: "none",
});

const seaConfig = path.join(outDir, "sea-config.json");
writeFileSync(seaConfig, JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true, useCodeCache: false }));
execFileSync(process.execPath, ["--experimental-sea-config", seaConfig], { stdio: "inherit" });

copyFileSync(process.execPath, exe);
const postject = path.join(root, "node_modules/postject/dist/cli.js");
const args = [postject, exe, "NODE_SEA_BLOB", blob, "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"];
if (process.platform === "darwin") args.push("--macho-segment-name", "NODE_SEA");
execFileSync(process.execPath, args, { stdio: "inherit" });

const sha = createHash("sha256").update(readFileSync(exe)).digest("hex");
console.log(`built ${exe}\n  ${(statSync(exe).size / 1048576).toFixed(1)} MB, node ${process.versions.node}, sha256 ${sha}`);
