import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildRoster, planMonth, type DayPlan, type MonthPlan } from "@shared/attendance/simulator";
import { prisma } from "../../../../lib/prisma";
import { recomputeWorld, diffWorld, formatMismatches, runReplay, type ReplayResult } from "./replay";
import { createWorld, existingHolidays, manualEntriesOf, type SimWorld } from "./world";

// The golden replay, small enough for every CI run (docs/plans/PHASE_2.md
// "P2-G build design"): 40 employees, the whole of August 2026, every named
// scenario, through the real ingestion service and the real recompute path,
// and every stored day compared field by field with what its scenario says it
// should be. The same code runs at 500 employees in `npm run test:replay`.
// It also proves the diff CAN fail, so an empty diff means something.

const SEED = 20260801;
const MONTH = "2026-08";
const tag = Date.now().toString(36).slice(-5);

describe("the month replay against the scenarios' intended outcomes (40 employees)", () => {
  let plan: MonthPlan;
  let world: SimWorld;
  let result: ReplayResult;

  beforeAll(async () => {
    const roster = buildRoster({ seed: SEED, month: MONTH, employees: 40, existingHolidays: await existingHolidays(MONTH) });
    plan = planMonth(roster);
    expect(plan.problems.slice(0, 5), "the simulator disagrees with itself").toEqual([]);
    world = await createWorld(roster, tag, manualEntriesOf(plan));
    result = await runReplay(world, plan);
  }, 300_000);

  afterAll(async () => {
    await world?.cleanup();
  }, 300_000);

  it("every employee-day is stored exactly as its scenario says: not one difference", () => {
    expect(formatMismatches(result.mismatches)).toBe("no differences");
    expect(result.employeeDays).toBe(40 * 31);
  });

  // Found by this very replay (P2-G, 2026-10-10): once a night-shift employee's assignment ended, the next
  // calendar day got a shift-less 00:00–24:00 punch window nearer to the final morning's out punch than the
  // shift's own window, so their LAST night read as absent with a missing punch (a day of lost pay on their final
  // day). The loader now gives a date on which the person isn't employed no window at all.
  it("a night-shift employee's last night counts on the day it started, out-punch next morning and all", async () => {
    const leaver = plan.roster.employees.find((e) => e.archetype === "night-leaver")!;
    const last = plan.days.find((d) => d.employee === leaver.code && d.date === leaver.lastWorking)!;
    expect(last.scenario).toBe("normal-day"); // the roster always makes the last day an ordinary working one
    const row = await prisma.dailyAttendance.findFirstOrThrow({ where: { employeeId: world.employeeId.get(leaver.code)!, date: new Date(`${leaver.lastWorking}T00:00:00Z`) } });
    expect(row).toMatchObject({ status: "P", punchCount: 2, shiftCode: `SIM-NIGHT-${tag}` });
    expect(row.exceptionFlags).toEqual([]);
    expect(Number(row.lopDays)).toBe(0);
    expect(row.lastOut!.getTime()).toBeGreaterThan(new Date(`${leaver.lastWorking}T18:30:00Z`).getTime()); // the next morning (IST) is after 18:30 UTC of the start date
  });

  it("ingestion reports what the plan says it should: every line new, the right ones unmapped, the right ones flagged as too old", () => {
    expect(result.accounting).toEqual([]);
    expect(result.ingest.lines).toBeGreaterThan(500);
    expect(result.ingest.unmapped).toBeGreaterThan(0);
    expect(result.ingest.flagged).toBeGreaterThan(0);
  });

  it("recomputing again changes nothing (the engine is idempotent over a whole month)", async () => {
    const again = await recomputeWorld(world);
    expect(again.changed).toBe(0);
  });

  it("the replay exercised the engine broadly: many scenarios, many outcomes", () => {
    expect(Object.keys(result.perScenario).length).toBeGreaterThanOrEqual(25);
    expect(Object.keys(result.perStatus).length).toBeGreaterThanOrEqual(10);
  });

  // ── The diff must be able to fail ─────────────────────────────────────────
  describe("the diff has teeth", () => {
    it("changing ONE policy value (the standard half-day minimum +30 min) is caught, in the half-day scenarios and nowhere else", async () => {
      const policy = await prisma.attendancePolicy.findUniqueOrThrow({ where: { code: `SIM-STD-${tag}` } });
      await prisma.attendancePolicy.update({ where: { id: policy.id }, data: { halfDayMinMinutes: policy.halfDayMinMinutes + 30 } });
      try {
        await recomputeWorld(world);
        const diff = await diffWorld(world, plan);
        expect(diff.length, "the change went unnoticed").toBeGreaterThan(0);
        const scenarios = new Set(diff.map((m) => m.scenario));
        const allowed = new Set(["half-day-first", "half-day-second", "half-day-tie", "below-half-day", "threshold-edges", "leave-half-worked"]);
        expect([...scenarios].filter((s) => !allowed.has(s)), formatMismatches(diff)).toEqual([]);
        // and it is the half-day OUTCOME that differs, not noise
        expect(diff.every((m) => ["status", "firstHalf", "secondHalf", "lopDays", "flags"].includes(m.field)), formatMismatches(diff)).toBe(true);
      } finally {
        await prisma.attendancePolicy.update({ where: { id: policy.id }, data: { halfDayMinMinutes: policy.halfDayMinMinutes } });
        await recomputeWorld(world);
      }
      expect(formatMismatches(await diffWorld(world, plan))).toBe("no differences"); // and putting it back puts it all back
    });

    it("one expected value corrupted is reported as exactly one difference, naming the scenario, field, expected and actual", async () => {
      const target = plan.days.find((d) => d.scenario === "normal-day" && d.expected?.status === "P")!;
      const diff = await diffWorld(world, plan, (d: DayPlan) => (d === target ? { ...d.expected!, status: "A" } : d.expected));
      expect(diff).toHaveLength(1);
      expect(diff[0]).toMatchObject({ employee: target.employee, date: target.date, scenario: "normal-day", field: "status", expected: "A", actual: "P" });
      const report = formatMismatches(diff);
      expect(report).toMatch(/normal-day: 1 day\(s\)/);
      expect(report).toContain('status: expected "A", the engine stored "P"');
    });

    it("a day whose record the engine should not have written (or should have) is a difference too", async () => {
      const noRecord = plan.days.find((d) => d.expected === null)!;
      const diff = await diffWorld(world, plan, (d) => (d === noRecord ? ({ ...plan.days.find((x) => x.expected)!.expected! } as never) : d.expected));
      expect(diff.some((m) => m.employee === noRecord.employee && m.date === noRecord.date && m.field === "record")).toBe(true);
    });
  });
});
