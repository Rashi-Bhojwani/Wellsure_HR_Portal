import { mkdtempSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { pruneRotatedLogs } from "../logs";

it("keeps the newest rotated logs and the live one, deletes the rest", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wsa-logs-"));
  const make = (name: string, daysAgo: number) => {
    writeFileSync(path.join(dir, name), "x");
    const t = (Date.now() - daysAgo * 86_400_000) / 1000;
    utimesSync(path.join(dir, name), t, t);
  };
  make("agent.log", 0);
  for (let i = 1; i <= 14; i++) make(`agent-2026100${i % 10}-${i}.log`, i);
  make("other.txt", 99);
  const gone = pruneRotatedLogs(dir, 10);
  expect(gone).toHaveLength(4);
  const left = readdirSync(dir);
  expect(left).toContain("agent.log");
  expect(left).toContain("other.txt");
  expect(left.filter((f) => f.startsWith("agent-"))).toHaveLength(10);
  expect(pruneRotatedLogs(path.join(dir, "nope"))).toEqual([]);
});
