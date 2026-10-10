import { differences } from "@shared/attendance/simulator/diff";
import type { DayPlan } from "@shared/attendance/simulator/model";
import { linesOf, type MonthPlan } from "@shared/attendance/simulator/month";
import type { PunchLine, Route } from "./routes";
import { RefusedError, type ServerApi } from "./serverApi";

// Sending a plan through a route and, if asked, checking what the server made
// of it (docs/plans/PHASE_2.md "P2-G, commit G2 build design"). The simulator
// only ever sends punches; the checking reads the server's stored days.

export interface Mismatch {
  employee: string;
  date: string;
  scenario: string;
  why: string;
  field: string;
  expected: unknown;
  actual: unknown;
}

export interface RunReport {
  route: string;
  employees: number;
  employeeDays: number;
  /** Employee-days left out because their punches reach the server late (that needs the server's clock moved). */
  leftOutDays: number;
  punchesSent: number;
  sendMs: number;
  /** Time from the last punch sent until every checked day matched (null: not verified, or it never did). */
  convergedMs: number | null;
  checkedDays: number;
  mismatches: Mismatch[];
}

/** Days whose punches all arrive as they happen: the only ones a real route can deliver without moving the server's clock. */
export const sendableDay = (d: DayPlan): boolean => [...d.punches, ...d.outside, ...d.unmapped].every((p) => p.delivery === "live");

export function sendablePlan(plan: MonthPlan): { plan: MonthPlan; leftOut: number } {
  const days = plan.days.filter(sendableDay);
  return { plan: { ...plan, days }, leftOut: plan.days.length - days.length };
}

export function punchLinesOf(plan: MonthPlan): PunchLine[] {
  // In the order a device records them.
  return linesOf(plan)
    .map((l) => ({ deviceUserId: l.deviceUserId, localTime: l.localTime, line: l.line }))
    .sort((a, b) => a.localTime.localeCompare(b.localTime) || a.deviceUserId.localeCompare(b.deviceUserId));
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Asks the server to recompute a range exactly as HR does (Process Attendance), and waits for it. */
export async function processRange(api: ServerApi, from: string, to: string, timeoutMs: number): Promise<void> {
  const run = await api.request<{ id: string }>("POST", "/api/attendance/process", { json: { fromDate: from, toDate: to, reason: "Punch simulator (development)" } });
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const r = await api.request<{ status: string; error?: string | null }>("GET", `/api/attendance/process/${run.id}`);
    if (r.status === "COMPLETED") return;
    if (r.status === "FAILED") throw new Error(`The server's recompute failed: ${r.error ?? "no reason given"}`);
    await sleep(500);
  }
  throw new Error(`The server had not finished recomputing after ${Math.round(timeoutMs / 1000)} s. Is the worker running?`);
}

export async function compareWithServer(api: ServerApi, plan: MonthPlan, today: string): Promise<{ checked: number; mismatches: Mismatch[] }> {
  const days = plan.days.filter((d) => d.date < today); // today and later are provisional or not yet computed
  const stored = await api.days([...new Set(days.map((d) => d.employee))], plan.roster.from, plan.roster.to);
  const mismatches: Mismatch[] = [];
  for (const d of days) {
    for (const diff of differences(d.expected, stored[`${d.employee}|${d.date}`] ?? null)) {
      mismatches.push({ employee: d.employee, date: d.date, scenario: d.scenario, why: d.why, ...diff });
    }
  }
  return { checked: days.length, mismatches };
}

/**
 * A second run over the same employee-days would add its punches to the first run's
 * and the comparison would be against a mix. The simulator cannot clear what it
 * sent (it never writes to the database), so it refuses instead of reporting nonsense.
 */
export async function assertDaysUntouched(api: ServerApi, plan: MonthPlan): Promise<void> {
  const stored = await api.days([...new Set(plan.days.map((d) => d.employee))], plan.roster.from, plan.roster.to);
  const touched = plan.days.filter((d) => Number(stored[`${d.employee}|${d.date}`]?.punchCount ?? 0) > 0);
  if (touched.length) {
    const e = touched[0]!;
    throw new RefusedError(`${touched.length} of the planned employee-days already have punches on the server (e.g. ${e.employee} on ${e.date}), probably from an earlier simulator run. Sending more would make the comparison meaningless, and the simulator cannot remove punches. Choose other days or other employees, or use a freshly seeded development database.`);
  }
}

export async function runPlan(opts: { api: ServerApi; route: Route; plan: MonthPlan; verify: boolean; today: string; timeoutMs?: number; log?: (line: string) => void }): Promise<RunReport> {
  const { api, route, verify } = opts;
  const log = opts.log ?? (() => undefined);
  const timeoutMs = opts.timeoutMs ?? 300_000;
  const { plan, leftOut } = sendablePlan(opts.plan);
  const lines = punchLinesOf(plan);
  if (verify) await assertDaysUntouched(api, plan);
  const sendStart = Date.now();
  await route.send(lines);
  await route.settled(timeoutMs);
  const sendMs = Date.now() - sendStart;
  log(`sent ${lines.length} punch(es) by the ${route.name} route in ${(sendMs / 1000).toFixed(1)} s`);

  let convergedMs: number | null = null;
  let checked = 0;
  let mismatches: Mismatch[] = [];
  if (verify) {
    const t0 = Date.now();
    await processRange(api, plan.roster.from, opts.today < plan.roster.to ? previousDay(opts.today) : plan.roster.to, timeoutMs);
    ({ checked, mismatches } = await compareWithServer(api, plan, opts.today));
    convergedMs = mismatches.length === 0 ? Date.now() - t0 : null;
  }
  return { route: route.name, employees: new Set(plan.days.map((d) => d.employee)).size, employeeDays: plan.days.length, leftOutDays: leftOut, punchesSent: lines.length, sendMs, convergedMs, checkedDays: checked, mismatches };
}

function previousDay(d: string): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/** A report a person can act on: the differences grouped by scenario with one worked example each. */
export function formatReport(r: RunReport): string {
  const out = [`route ${r.route}: ${r.employees} employee(s), ${r.employeeDays} employee-day(s) planned, ${r.punchesSent} punch(es) sent in ${(r.sendMs / 1000).toFixed(1)} s`];
  if (r.leftOutDays) out.push(`  ${r.leftOutDays} employee-day(s) left out: their punches reach the server late, which needs the server's clock moved (the replay tests cover them)`);
  if (r.checkedDays === 0 && r.convergedMs === null && r.mismatches.length === 0) return out.join("\n");
  const days = new Set(r.mismatches.map((m) => `${m.employee}|${m.date}`)).size;
  out.push(`  checked ${r.checkedDays} day(s) against the server: ${days === 0 ? "no differences" : `${days} day(s) differ`}${r.convergedMs !== null ? `; all recomputed and matching ${(r.convergedMs / 1000).toFixed(1)} s after the last punch` : ""}`);
  const byScenario = new Map<string, Mismatch[]>();
  for (const m of r.mismatches) byScenario.set(m.scenario, [...(byScenario.get(m.scenario) ?? []), m]);
  for (const [scenario, ms] of byScenario) {
    const e = ms[0]!;
    out.push(`    ${scenario}: ${new Set(ms.map((m) => `${m.employee}|${m.date}`)).size} day(s). e.g. ${e.employee} ${e.date}: ${e.why}`);
    for (const m of ms.filter((x) => x.employee === e.employee && x.date === e.date).slice(0, 6)) out.push(`        ${m.field}: expected ${JSON.stringify(m.expected)}, the server stored ${JSON.stringify(m.actual)}`);
  }
  return out.join("\n");
}
