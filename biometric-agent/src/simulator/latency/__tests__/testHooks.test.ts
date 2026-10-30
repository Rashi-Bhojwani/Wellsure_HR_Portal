import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The latency test reads the live screens through stable hooks, never through their look. A redesign that drops a hook fails here, in the unit tests, instead of silently turning the
// punch-to-screen job red (that is what happened after the UI pass).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("the screens the latency test watches keep their test hooks", () => {
  it("Who Is In? rows carry the employee code, the group and whether they worked anyway", () => {
    const page = read("frontend/src/pages/admin/attendance/WhoIsInPage.tsx");
    for (const hook of ['"data-testid": "whoisin-row"', '"data-employee-code"', '"data-group"', '"data-worked"']) expect(page, hook).toContain(hook);
    expect(page).toContain('searchPlaceholder="Search name or code"');
  });
  it("the employee's day panel lists each punch with its device and time", () => {
    const panel = read("frontend/src/components/attendance/DayPanel.tsx");
    for (const hook of ['data-testid="day-punches"', 'data-testid="day-punch"', "data-device={p.device}", "data-time={p.time}"]) expect(panel, hook).toContain(hook);
  });
  it("the harness uses those hooks and no longer the old markup", () => {
    const run = read("biometric-agent/src/simulator/latency/run.ts");
    expect(run).toContain('data-testid="day-punch"');
    expect(run).toContain('[data-testid="whoisin-row"]');
    for (const old of [".ant-list-item", ".ant-card", ".ant-statistic"]) expect(run, old).not.toContain(old);
  });
});
