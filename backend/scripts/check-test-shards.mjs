// CI: the backend suite runs in shards (one test file is in exactly one shard). This checks, after every shard has finished, that the shards together are the whole suite:
//   - every shard produced its report and none had a failed test or a failed file;
//   - every test file `vitest list` knows is in exactly one shard, and no shard ran a file the list does not have;
//   - the number of tests the shards report adds up to the number `vitest list` counts (every test ran exactly once; none was lost or doubled).
// Usage: node scripts/check-test-shards.mjs <list.json> <shard-report.json>...   (exits 1 with the reason on any mismatch)
import { readFileSync } from "node:fs";
import path from "node:path";

const [listFile, ...shardFiles] = process.argv.slice(2);
if (!listFile || shardFiles.length === 0) {
  console.error("usage: node scripts/check-test-shards.mjs <list.json> <shard-report.json>...");
  process.exit(2);
}
const rel = (f) => f.slice(f.indexOf("src/")).split(path.sep).join("/");
const problems = [];
const listed = JSON.parse(readFileSync(listFile, "utf8"));
const listedFiles = new Map();
for (const t of listed) listedFiles.set(rel(t.file), (listedFiles.get(rel(t.file)) ?? 0) + 1);

const seen = new Map();
let total = 0;
for (const f of shardFiles) {
  let report;
  try {
    report = JSON.parse(readFileSync(f, "utf8"));
  } catch (err) {
    problems.push(`${f}: no readable report (${err instanceof Error ? err.message : err}) — the shard did not finish`);
    continue;
  }
  if (!report.success || report.numFailedTests > 0 || report.numFailedTestSuites > 0) problems.push(`${f}: ${report.numFailedTests} failed tests, ${report.numFailedTestSuites} failed files`);
  total += report.numTotalTests;
  for (const r of report.testResults) {
    const file = rel(r.name);
    if (seen.has(file)) problems.push(`${file} ran in two shards (${seen.get(file)} and ${f})`);
    seen.set(file, f);
    const ran = r.assertionResults.length;
    const expected = listedFiles.get(file);
    if (expected === undefined) problems.push(`${file} ran in ${f} but is not in the suite list`);
    else if (ran !== expected) problems.push(`${file}: ${ran} tests reported, ${expected} listed`);
  }
}
for (const file of listedFiles.keys()) if (!seen.has(file)) problems.push(`${file} is in the suite but ran in no shard`);
if (total !== listed.length) problems.push(`the shards report ${total} tests; the suite has ${listed.length}`);

if (problems.length) {
  console.error(`Backend shards do NOT add up to the suite:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`Backend shards add up: ${shardFiles.length} shards, ${seen.size} files, ${total} tests — each exactly once, none failed.`);
