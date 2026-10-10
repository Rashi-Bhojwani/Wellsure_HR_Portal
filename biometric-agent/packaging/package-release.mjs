// Assembles the release folder that CI zips: the executable, NSSM, the
// PowerShell scripts, an example config, INSTALL.md, VERSION.txt and
// SHA256SUMS.txt (docs/plans/PHASE_2.md, "P2-F, commit F2 build design").
//
//   node packaging/package-release.mjs --nssm <path to nssm.exe> --out <folder> [--exe dist/wellsure-agent.exe]
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
const nssm = arg("nssm");
if (!nssm) throw new Error("--nssm <path to nssm.exe> is required");
const exe = path.resolve(root, arg("exe", "dist/wellsure-agent.exe"));
const out = path.resolve(root, arg("out", "release"), `wellsure-agent-${version}`);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const put = (from, name = path.basename(from)) => copyFileSync(from, path.join(out, name));

put(exe, "wellsure-agent.exe");
put(path.resolve(root, nssm), "nssm.exe");
for (const f of ["lib.ps1", "install.ps1", "upgrade.ps1", "uninstall.ps1", "set-key.ps1", "config.example.json"]) put(path.join(root, "windows", f));
put(path.join(root, "INSTALL.md"));

writeFileSync(
  path.join(out, "VERSION.txt"),
  [`Wellsure Agent ${version}`, `Node ${process.versions.node} (embedded)`, `Built ${new Date().toISOString()}`, process.env.GITHUB_SHA ? `Commit ${process.env.GITHUB_SHA}` : "Commit (local build)", ""].join("\r\n"),
);

const sums = readdirSync(out)
  .sort()
  .map((f) => `${createHash("sha256").update(readFileSync(path.join(out, f))).digest("hex")} *${f}`);
writeFileSync(path.join(out, "SHA256SUMS.txt"), `${sums.join("\r\n")}\r\n`);
console.log(`release folder: ${out}\n${sums.join("\n")}`);
