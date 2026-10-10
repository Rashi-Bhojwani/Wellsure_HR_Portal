import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildRoster,
  generateFor,
  intentMismatches,
  linesOf,
  planMonth,
  referenceDay,
  scenarios,
  SIM_DAY,
  SIM_NIGHT,
  simMasters,
  type RefDay,
  type SimPolicy,
  type SimShift,
} from "@shared/attendance/simulator";

// The scenario library's own tests (docs/plans/PHASE_2.md "P2-G build design"):
// no database, no engine. They prove the simulator is sound BEFORE it is used to
// judge the engine.

const M = simMasters("2026-08");
const STD = M.policies.find((p) => p.code === "SIM-STD")!;
const STRICT = M.policies.find((p) => p.code === "SIM-STRICT")!;
const COMBOS: Array<[SimShift, SimPolicy]> = [
  [SIM_DAY, STD],
  [SIM_DAY, STRICT],
  [SIM_NIGHT, STD],
  [SIM_NIGHT, STRICT],
];

const plainDay = (shift: SimShift, policy: SimPolicy, g: NonNullable<ReturnType<typeof generateFor>>): RefDay => ({
  date: "2026-08-12",
  employed: true,
  holiday: null,
  weekOff: false,
  leave: { first: null, second: null },
  capture: g.manual !== undefined && g.manual !== null ? "MANUAL" : "DEVICE",
  manual: g.manual ?? null,
  punches: g.punches.filter((p) => p.delivery !== "stale").map((p) => p.at),
  flaggedExcluded: g.punches.filter((p) => p.delivery === "stale").length,
  outsideWindowPunches: g.outside?.length ?? 0,
  shift,
  policy,
});

describe("each scenario's declared intent agrees with the reference model (leg 1 against leg 2)", () => {
  const working = scenarios.WORKING_DAY_SCENARIOS.map(([s]) => s);

  for (const scenario of working) {
    it(`${scenario.name}: 3,000 seeded draws on every shift and policy`, () => {
      let built = 0;
      for (const [shift, policy] of COMBOS) {
        for (let seed = 1; seed <= 3_000; seed++) {
          const g = generateFor(scenario, shift, policy, seed * 7919);
          if (!g) continue;
          built++;
          const ref = referenceDay(plainDay(shift, policy, g));
          const bad = intentMismatches(g.intent, ref);
          if (bad.length) throw new Error(`${scenario.name} on ${shift.code}/${policy.code}, seed ${seed * 7919}, ${JSON.stringify(g.params)}: ${bad.join("; ")}`);
        }
      }
      // A scenario that can never be built is dead weight: each must build on at least one shift and policy.
      expect(built, `${scenario.name} was never buildable`).toBeGreaterThan(0);
    });
  }

  it("the scenarios that every shift and policy must support do build everywhere", () => {
    for (const name of ["normal-day", "late-arrival", "missing-punch", "never-punches", "duplicate-seconds", "threshold-edges", "below-half-day", "catch-up"]) {
      const s = working.find((x) => x.name === name)!;
      for (const [shift, policy] of COMBOS) {
        const built = Array.from({ length: 200 }, (_, i) => generateFor(s, shift, policy, i + 1)).filter(Boolean).length;
        expect(built, `${name} on ${shift.code}/${policy.code}`).toBeGreaterThan(20);
      }
    }
  });

  it("manual and leave generators agree too", () => {
    for (let seed = 1; seed <= 2_000; seed++) {
      for (const [shift, policy] of [[SIM_DAY, STD]] as const) {
        const ctx = { rng: undefined as never, shift, policy, layout: undefined as never };
        void ctx;
        const t = generateFor({ name: "manual-timed", description: "", intentText: "", generate: (c) => scenarios.manualTimed(c) }, shift, policy, seed);
        if (t) {
          const ref = referenceDay({ ...plainDay(shift, policy, t), capture: "MANUAL" });
          expect(intentMismatches(t.intent, ref), JSON.stringify(t.params)).toEqual([]);
        }
        const s = generateFor({ name: "manual-status", description: "", intentText: "", generate: (c) => scenarios.manualStatus(c) }, shift, policy, seed)!;
        expect(intentMismatches(s.intent, referenceDay({ ...plainDay(shift, policy, s), capture: "MANUAL" })), JSON.stringify(s.params)).toEqual([]);
      }
    }
  });
});

describe("a planned month", () => {
  const roster = buildRoster({ seed: 20260801, month: "2026-08", employees: 500 });

  it("has no disagreement between any scenario's intent and the reference model", () => {
    const plan = planMonth(roster);
    expect(plan.problems.slice(0, 5)).toEqual([]);
    expect(plan.days).toHaveLength(500 * 31);
  });

  it("is identical for the same seed, and different for another", () => {
    const a = JSON.stringify(planMonth(roster).days);
    expect(JSON.stringify(planMonth(buildRoster({ seed: 20260801, month: "2026-08", employees: 500 })).days)).toBe(a);
    expect(JSON.stringify(planMonth(buildRoster({ seed: 20260802, month: "2026-08", employees: 500 })).days)).not.toBe(a);
    const lines = linesOf(planMonth(roster)).map((l) => l.line);
    expect(linesOf(planMonth(buildRoster({ seed: 20260801, month: "2026-08", employees: 500 }))).map((l) => l.line)).toEqual(lines);
  });

  it("is the same whatever order the days are built in (each employee-day has its own random stream)", () => {
    const plan = planMonth(roster);
    const single = planMonth({ ...roster, employees: [roster.employees[137]!] });
    const mine = plan.days.filter((d) => d.employee === roster.employees[137]!.code);
    expect(JSON.stringify(single.days)).toBe(JSON.stringify(mine));
  });

  for (const [label, employees, seed] of [["500 employees", 500, 20260801], ["the 40-employee CI roster", 40, 20260801]] as const) {
    it(`covers every status, flag, scenario and special case (${label})`, () => {
      const plan = planMonth(buildRoster({ seed, month: "2026-08", employees }));
      const days = plan.days.flatMap((d) => (d.expected ? [d.expected] : []));
      const statuses = new Set(days.map((d) => d.status));
      const flags = new Set(days.flatMap((d) => d.flags));
      const names = new Set(plan.days.map((d) => d.scenario));

      for (const s of ["P", "A", "H", "O", "NM", "HD", "P:A", "A:P", "SIMPL", "SIMLOP"]) expect(statuses, `status ${s}`).toContain(s);
      expect([...statuses].some((s) => s.includes(":") && s.includes("SIM")), "a split leave status").toBe(true);
      for (const f of ["MISSING_PUNCH", "SHORTFALL", "LATE_IN", "EARLY_OUT", "HALF_DAY_MIN_NOT_MET", "CLOCK_FLAGGED"]) expect(flags, `flag ${f}`).toContain(f);

      const expectedNames = [...scenarios.WORKING_DAY_SCENARIOS.map(([s]) => s.name), "off-day-quiet", "holiday-work", "weekoff-work", "leave-full", "leave-half-worked", "leave-half-no-show", "not-employed", "manual-nothing", "manual-status", "manual-timed", "manual-in-only"];
      for (const n of expectedNames) expect(names, `scenario ${n}`).toContain(n);

      expect(days.some((d) => d.collapsedPunches > 0), "a collapsed duplicate").toBe(true);
      expect(days.some((d) => d.shiftCode === "SIM-NIGHT" && d.status === "P" && d.lastOut !== null && d.lastOut.slice(0, 10) > d.firstIn!.slice(0, 10)), "a night shift out the next calendar day").toBe(true);
      expect(days.some((d) => d.outsideWindowPunches > 0), "a punch in no window").toBe(true);
      expect(days.some((d) => d.workedOnOffDay), "worked on an off day").toBe(true);
      expect(plan.days.some((d) => d.expected === null), "a not-employed day").toBe(true);
      expect(plan.days.some((d) => d.unmapped.length > 0), "punches before a mapping starts").toBe(true);
      expect(days.some((d) => d.capture === "MANUAL") && days.some((d) => d.capture === "DEVICE"), "both captures").toBe(true);
      // a mapping that starts mid-month: one employee with both captures in the same month
      const byEmp = new Map<string, Set<string>>();
      for (const d of plan.days) if (d.expected) byEmp.set(d.employee, (byEmp.get(d.employee) ?? new Set()).add(d.expected.capture));
      expect([...byEmp.values()].some((s) => s.size === 2), "a mapping starting mid-month").toBe(true);
      // a joiner and a leaver: an employee with both no-record days and record days
      const norecord = new Set(plan.days.filter((d) => d.expected === null).map((d) => d.employee));
      const withRecords = new Set(plan.days.filter((d) => d.expected !== null).map((d) => d.employee));
      expect([...norecord].filter((e) => withRecords.has(e)).length, "joiners and leavers").toBeGreaterThanOrEqual(2);
    });
  }

  it("every mapped line is in the device's own format", () => {
    for (const l of linesOf(planMonth(buildRoster({ seed: 1, month: "2026-08", employees: 40 }))).slice(0, 2_000)) {
      expect(l.line).toMatch(/^\d+\t\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\t1\t255\t1\t0$/);
    }
  });
});

describe("the simulator never marks its own homework", () => {
  it("imports nothing from the engine, the backend or the database", () => {
    const dir = path.resolve(import.meta.dirname, "../../../../shared/attendance/simulator");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const imports = [...readFileSync(path.join(dir, f), "utf8").matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]!);
      for (const i of imports) {
        expect(i, `${f} imports ${i}`).not.toMatch(/backend|prisma|engine|modules\/|@prisma/);
        // only its own files, and the shared ATTLOG format helper
        expect(i.startsWith("./") || i === "../attlog", `${f} imports ${i}`).toBe(true);
      }
    }
  });
});
