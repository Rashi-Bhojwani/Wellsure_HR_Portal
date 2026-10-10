import type { DailyAttendance } from "@prisma/client";
import { localTimeToInstant } from "@shared/attendance/attlog";
import { linesOf, makeRng, type DayPlan, type ExpectedDay, type MonthPlan, type PlannedLine } from "@shared/attendance/simulator";
import { punchPlausibility } from "../../../../lib/attendanceSettings";
import { prisma } from "../../../../lib/prisma";
import { ingest } from "../../../biometric/ingestion";
import { observedDay } from "../../../dev/simulatorService";
import { computeInChunks } from "../../jobs";
import { setRecomputeHandler } from "../../recompute";
import type { SimWorld } from "./world";

// The month replay (docs/plans/PHASE_2.md "P2-G build design", "The replay"):
// the planned month goes in through the REAL ingestion service, is recomputed by
// the REAL recompute path, and every stored employee-day is compared, field by
// field, with what the plan says it should be. Not a speed test with a check
// bolted on: the diff is the product, the timings are a by-product.

const IST = "Asia/Kolkata";
const MS_DAY = 86_400_000;
const CHUNK = 1_000; // lines per ingest call, as the agent sends

export interface IngestStats {
  calls: number;
  lines: number;
  newPunches: number;
  duplicates: number;
  unmapped: number;
  rejected: number;
  flagged: number;
}

export interface Mismatch {
  employee: string;
  date: string;
  scenario: string;
  params: Record<string, number | string>;
  why: string;
  field: string;
  expected: unknown;
  actual: unknown;
}

export interface ReplayResult {
  employees: number;
  employeeDays: number;
  ingest: IngestStats;
  /** What ingestion should have reported, from the plan, against what it did. Empty is agreement. */
  accounting: string[];
  ingestMs: number;
  recomputeMs: number;
  recompute: { processed: number; changed: number };
  mismatches: Mismatch[];
  perScenario: Record<string, number>;
  perStatus: Record<string, number>;
}

const dayEnd = (localDate: string) => localTimeToInstant(`${localDate} 23:59:59`, IST);

/** When each group of lines reaches the server, and in what order: live as they happen, late after an outage (shuffled), stale beyond the plausibility window. */
function deliveries(lines: PlannedLine[], maxAgeDays: number, seed: number) {
  const groups = new Map<string, { now: Date; lines: PlannedLine[]; delivery: PlannedLine["delivery"] }>();
  for (const l of lines) {
    const punchDate = l.localTime.slice(0, 10);
    const base = dayEnd(punchDate).getTime();
    const now = new Date(base + (l.delivery === "live" ? 0 : l.delivery === "late" ? 3 * MS_DAY : (maxAgeDays + 2) * MS_DAY));
    const key = `${l.delivery}|${punchDate}`;
    const g = groups.get(key) ?? { now, lines: [], delivery: l.delivery };
    g.lines.push(l);
    groups.set(key, g);
  }
  const rng = makeRng(seed);
  return [...groups.values()]
    .sort((a, b) => a.now.getTime() - b.now.getTime() || a.delivery.localeCompare(b.delivery))
    .map((g) => ({ now: g.now, lines: g.delivery === "late" ? rng.shuffle(g.lines) : [...g.lines].sort((a, b) => a.localTime.localeCompare(b.localTime)) }));
}

export async function ingestPlan(world: SimWorld, plan: MonthPlan): Promise<{ stats: IngestStats; ms: number; lines: PlannedLine[] }> {
  setRecomputeHandler(null); // recompute is a separate, timed step below
  const lines = linesOf(plan);
  const { maxPunchAgeDays } = await punchPlausibility();
  const stats: IngestStats = { calls: 0, lines: 0, newPunches: 0, duplicates: 0, unmapped: 0, rejected: 0, flagged: 0 };
  const started = Date.now();
  for (const group of deliveries(lines, maxPunchAgeDays, plan.roster.seed)) {
    for (let i = 0; i < group.lines.length; i += CHUNK) {
      const device = await prisma.device.findUniqueOrThrow({ where: { id: world.deviceId } });
      const r = await ingest({ route: "AGENT", device, text: group.lines.slice(i, i + CHUNK).map((l) => l.line).join("\n"), now: group.now });
      stats.calls += 1;
      stats.lines += r.totalLines;
      stats.newPunches += r.newCount;
      stats.duplicates += r.duplicateCount;
      stats.unmapped += r.unmappedCount;
      stats.rejected += r.rejectedCount;
      stats.flagged += r.flaggedCount;
    }
  }
  return { stats, ms: Date.now() - started, lines };
}

/** What ingestion should have said, from the plan alone. */
export function expectedAccounting(lines: PlannedLine[]): { lines: number; newPunches: number; unmapped: number; flagged: number } {
  return {
    lines: lines.length,
    newPunches: lines.length, // a plan never contains the same punch twice
    unmapped: lines.filter((l) => l.kind === "unmapped").length,
    // stale deliveries are flagged on arrival (too old to be plausible); only mapped ones are ever recomputed, but all are flagged
    flagged: lines.filter((l) => l.delivery === "stale").length,
  };
}

export async function recomputeWorld(world: SimWorld): Promise<{ ms: number; processed: number; changed: number }> {
  const started = Date.now();
  const r = await computeInChunks(world.employeeIds, world.roster.from, world.roster.to);
  return { ms: Date.now() - started, processed: r.processed, changed: r.changed };
}

/** The stored day, in the plan's vocabulary (the same reader the dev endpoint serves the CLI). */
export function observed(row: DailyAttendance, tag: string): Record<keyof ExpectedDay, unknown> {
  return observedDay(row, (code) => code.replace(`-${tag}`, ""));
}

export async function diffWorld(world: SimWorld, plan: MonthPlan, expectedOverride?: (d: DayPlan) => ExpectedDay | null): Promise<Mismatch[]> {
  const rows = await prisma.dailyAttendance.findMany({
    where: { employeeId: { in: world.employeeIds }, date: { gte: new Date(`${plan.roster.from}T00:00:00Z`), lte: new Date(`${plan.roster.to}T00:00:00Z`) } },
  });
  const stored = new Map(rows.map((r) => [`${world.codeOf.get(r.employeeId)}|${r.date.toISOString().slice(0, 10)}`, r]));
  const out: Mismatch[] = [];
  const seen = new Set<string>();
  for (const d of plan.days) {
    const key = `${d.employee}|${d.date}`;
    seen.add(key);
    const expected = expectedOverride ? expectedOverride(d) : d.expected;
    const row = stored.get(key);
    const base = { employee: d.employee, date: d.date, scenario: d.scenario, params: d.params, why: d.why };
    if (!expected) {
      if (row) out.push({ ...base, field: "record", expected: "no record", actual: row.status });
      continue;
    }
    if (!row) {
      out.push({ ...base, field: "record", expected: expected.status, actual: "no record" });
      continue;
    }
    const got = observed(row, world.tag);
    for (const field of Object.keys(expected) as Array<keyof ExpectedDay>) {
      if (JSON.stringify(expected[field]) !== JSON.stringify(got[field])) out.push({ ...base, field, expected: expected[field], actual: got[field] });
    }
  }
  for (const [key, row] of stored) {
    if (!seen.has(key)) out.push({ employee: key.split("|")[0]!, date: key.split("|")[1]!, scenario: "(not in the plan)", params: {}, why: "a stored day the plan has no entry for", field: "record", expected: "none", actual: row.status });
  }
  return out;
}

export async function runReplay(world: SimWorld, plan: MonthPlan): Promise<ReplayResult> {
  const ing = await ingestPlan(world, plan);
  const want = expectedAccounting(ing.lines);
  const accounting: string[] = [];
  const check = (name: string, w: number, got: number) => {
    if (w !== got) accounting.push(`${name}: the plan says ${w}, ingestion reported ${got}`);
  };
  check("lines sent", want.lines, ing.stats.lines);
  check("new punches", want.newPunches, ing.stats.newPunches);
  check("duplicates", 0, ing.stats.duplicates);
  check("rejected", 0, ing.stats.rejected);
  check("unmapped", want.unmapped, ing.stats.unmapped);
  check("flagged (too old)", want.flagged, ing.stats.flagged);
  const unmappedInDb = await prisma.rawPunch.count({ where: { deviceId: world.deviceId, employeeId: null } });
  check("punches stored unmapped", want.unmapped, unmappedInDb);

  const rc = await recomputeWorld(world);
  const mismatches = await diffWorld(world, plan);

  const perScenario: Record<string, number> = {};
  const perStatus: Record<string, number> = {};
  for (const d of plan.days) {
    perScenario[d.scenario] = (perScenario[d.scenario] ?? 0) + 1;
    const s = d.expected?.status ?? "(no record)";
    perStatus[s] = (perStatus[s] ?? 0) + 1;
  }
  return {
    employees: world.employeeIds.length,
    employeeDays: plan.days.length,
    ingest: ing.stats,
    accounting,
    ingestMs: ing.ms,
    recomputeMs: rc.ms,
    recompute: { processed: rc.processed, changed: rc.changed },
    mismatches,
    perScenario,
    perStatus,
  };
}

/** The employee-days that differ (a day with several wrong fields is one day, not several). */
export function daysDiffering(mismatches: Mismatch[]): number {
  return new Set(mismatches.map((m) => `${m.employee}|${m.date}`)).size;
}

/** A report a person can act on: the differences grouped by scenario, one worked example each, with every wrong field of that day. */
export function formatMismatches(mismatches: Mismatch[], limit = 12): string {
  if (!mismatches.length) return "no differences";
  const byScenario = new Map<string, Mismatch[]>();
  for (const m of mismatches) byScenario.set(m.scenario, [...(byScenario.get(m.scenario) ?? []), m]);
  const lines = [`${daysDiffering(mismatches)} employee-day(s) differ from what their scenario says (${mismatches.length} field difference(s)), in ${byScenario.size} scenario(s):`];
  for (const [scenario, ms] of [...byScenario].sort((a, b) => daysDiffering(b[1]) - daysDiffering(a[1])).slice(0, limit)) {
    const e = ms[0]!;
    const sameDay = ms.filter((m) => m.employee === e.employee && m.date === e.date);
    lines.push(`  ${scenario}: ${daysDiffering(ms)} day(s). e.g. ${e.employee} ${e.date} ${JSON.stringify(e.params)}`, `      the scenario says: ${e.why}`);
    for (const m of sameDay.slice(0, 6)) lines.push(`      ${m.field}: expected ${JSON.stringify(m.expected)}, the engine stored ${JSON.stringify(m.actual)}`);
    if (sameDay.length > 6) lines.push(`      … and ${sameDay.length - 6} more field(s) that day`);
  }
  return lines.join("\n");
}
