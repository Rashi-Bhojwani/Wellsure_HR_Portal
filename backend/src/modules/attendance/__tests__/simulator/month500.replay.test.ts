import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildRoster, planMonth, type MonthPlan } from "@shared/attendance/simulator";
import { daysDiffering, formatMismatches, runReplay, type ReplayResult } from "./replay";
import { createWorld, existingHolidays, manualEntriesOf, type SimWorld } from "./world";

// THE MONTH FOR 500 EMPLOYEES (docs/plans/PHASE_2.md "P2-G build design", gate
// G2): `npm run test:replay --prefix backend`. A whole month, every named
// scenario, through the real ingestion service and the real recompute path, and
// it FAILS if any employee-day is stored differently from what its scenario says
// it should be. Speed is the secondary measure: absolute limits, and a
// regression guard against a committed baseline recorded by the CI runner.

const EMPLOYEES = Number(process.env.REPLAY_EMPLOYEES ?? 500);
const SEED = Number(process.env.REPLAY_SEED ?? 20260801);
const MONTH = "2026-08";
const tag = Date.now().toString(36).slice(-5);

const INGEST_LIMIT_MS = 2 * 60_000; // gate G2: ingest ≤ 2 min
const RECOMPUTE_LIMIT_MS = 5 * 60_000; // gate G2: recompute ≤ 5 min
// Fail if any figure is more than 3× the baseline. It was 2×, and a shared CI runner took 2.03× (46.9 s against 23.0 s) on code that did not touch attendance. A real
// regression (a loop that became quadratic, a query per day) costs many times more than 3×; the hard limits above (gate G2) stay as they were.
const REGRESSION_FACTOR = 3;

const perfDir = path.resolve(import.meta.dirname, "../../../../../perf");
const baselineFile = path.join(perfDir, "baseline.json");
const lastRunFile = path.join(perfDir, "last-run.json");

describe(`a month for ${EMPLOYEES} employees against the scenarios' intended outcomes`, () => {
  let plan: MonthPlan;
  let world: SimWorld;
  let result: ReplayResult;

  beforeAll(async () => {
    const roster = buildRoster({ seed: SEED, month: MONTH, employees: EMPLOYEES, existingHolidays: await existingHolidays(MONTH) });
    plan = planMonth(roster);
    expect(plan.problems.slice(0, 5), "the simulator disagrees with itself").toEqual([]);
    world = await createWorld(roster, tag, manualEntriesOf(plan));
    result = await runReplay(world, plan);
    mkdirSync(perfDir, { recursive: true });
    writeFileSync(
      lastRunFile,
      JSON.stringify({ employees: result.employees, employeeDays: result.employeeDays, month: MONTH, seed: SEED, punchesSent: result.ingest.lines, ingestCalls: result.ingest.calls, ingestMs: result.ingestMs, recomputeMs: result.recomputeMs, daysDiffering: daysDiffering(result.mismatches), recordedAt: new Date().toISOString() }, null, 2),
    );
    console.log(
      [
        `\n  ${result.employees} employees × ${MONTH} = ${result.employeeDays} employee-days`,
        `  punches sent: ${result.ingest.lines} in ${result.ingest.calls} ingest calls (${result.ingest.unmapped} unmapped, ${result.ingest.flagged} flagged as too old)`,
        `  ingest ${(result.ingestMs / 1000).toFixed(1)} s, recompute ${(result.recomputeMs / 1000).toFixed(1)} s (${result.recompute.processed} employee-days evaluated, ${result.recompute.changed} written)`,
        `  differences from the scenarios: ${daysDiffering(result.mismatches)} employee-day(s)`,
        `  scenarios: ${Object.entries(result.perScenario).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`,
        `  outcomes: ${Object.entries(result.perStatus).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`,
      ].join("\n"),
    );
  });

  afterAll(async () => {
    await world?.cleanup();
  });

  it("every employee-day is stored exactly as its scenario says: not one difference", () => {
    expect(formatMismatches(result.mismatches)).toBe("no differences");
    expect(result.employeeDays).toBe(EMPLOYEES * 31);
  });

  it("ingestion reports what the plan says it should", () => {
    expect(result.accounting).toEqual([]);
  });

  it(`ingest is within ${INGEST_LIMIT_MS / 1000} s and recompute within ${RECOMPUTE_LIMIT_MS / 1000} s (gate G2)`, () => {
    expect(result.ingestMs).toBeLessThanOrEqual(INGEST_LIMIT_MS);
    expect(result.recomputeMs).toBeLessThanOrEqual(RECOMPUTE_LIMIT_MS);
  });

  it(`neither is more than ${REGRESSION_FACTOR}× the committed baseline (a regression guard, not a target)`, () => {
    if (process.env.REPLAY_UPDATE_BASELINE === "1") {
      writeFileSync(baselineFile, JSON.stringify({ recordedOn: process.env.REPLAY_BASELINE_MACHINE ?? "unspecified", employees: result.employees, month: MONTH, seed: SEED, punchesSent: result.ingest.lines, ingestMs: result.ingestMs, recomputeMs: result.recomputeMs, recordedAt: new Date().toISOString() }, null, 2));
      return;
    }
    if (!existsSync(baselineFile)) {
      console.log("  no baseline committed yet: the CI runner records it (backend/perf/README.md)");
      return;
    }
    const base = JSON.parse(readFileSync(baselineFile, "utf8")) as { ingestMs: number; recomputeMs: number; employees: number };
    expect(base.employees, "the baseline was recorded for a different roster size").toBe(EMPLOYEES);
    expect(result.ingestMs, `ingest ${result.ingestMs} ms against a baseline of ${base.ingestMs} ms`).toBeLessThanOrEqual(base.ingestMs * REGRESSION_FACTOR);
    expect(result.recomputeMs, `recompute ${result.recomputeMs} ms against a baseline of ${base.recomputeMs} ms`).toBeLessThanOrEqual(base.recomputeMs * REGRESSION_FACTOR);
  });
});
