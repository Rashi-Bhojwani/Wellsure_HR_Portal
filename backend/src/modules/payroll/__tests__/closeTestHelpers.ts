import { prisma } from "../../../lib/prisma";
import { setArrearsBasisProvider } from "../salary/arrears";
import { setPayrollConsumptionCheck, setPayrollInputsListener, setPayrollLockCheck } from "../../../lib/effectiveDating";
import { cleanupFullTestEmployee, createFullTestEmployee, loginAs } from "../../employee/__tests__/employeeTestHelpers";
import { SettingsBasedEncashmentRateProvider, setEncashmentRateProvider } from "../../leave/encashmentRate";
import { registerPayrollSeams } from "../wiring";
import { confirmRule, previewConfirm } from "../rules/governed";
import type { RulePin } from "../rules/context";
import { CYCLE, api, buildRunWorld, lockCycle, sidelineEveryoneBut, teardownRunWorld, type RunWorld } from "./runTestHelpers";
import { FIRST_SALARY_DAY, giveSalary } from "./salaryTestHelpers";

// The pieces of the closing tests that other payroll tests need too (a world with a Super Admin and nobody else in the run, staff with salary and locked attendance,
// every rule confirmed, and the whole road to a final run). Moved out of runClosing.test.ts so the release tests use the same road.

export const REAL_RULES = { PT_SLABS: { states: {} }, LWF_TABLE: { states: {} }, STATE_NAME_MAP: { "Test State": "TEST_STATE" }, PT_STATE_OF_PLACEMENT: "LAST_DAY_OF_PERIOD" };

export type Closing = RunWorld & { sup: { employeeId: string; userId: string; employeeCode: string }; supToken: string; restore: () => Promise<void> };

export async function closingWorld(names: string[]): Promise<Closing> {
  registerPayrollSeams();
  const world = (await buildRunWorld(names)) as Closing;
  world.sup = await createFullTestEmployee(world.org, { roleCode: "SUPER_ADMIN" });
  world.supToken = await loginAs(world.sup.employeeCode);
  world.userIds.push(world.sup.userId);
  world.restore = await sidelineEveryoneBut(Object.values(world.named).map((p) => p.employeeId)); // see sidelineEveryoneBut: the seeded staff are not part of these runs
  return world;
}
export async function closeWorld(world: Closing): Promise<void> {
  await world.restore();
  await cleanupFullTestEmployee(world.sup.employeeId);
  await teardownRunWorld(world);
}

export async function staffWith(world: RunWorld, who: string[], over: { salary?: boolean; lock?: boolean } = {}): Promise<void> {
  for (const n of who) {
    const id = world.named[n]!.employeeId;
    if (over.salary !== false) await giveSalary(world, id, "600000", FIRST_SALARY_DAY);
    if (over.lock !== false) await lockCycle(id, CYCLE.start, CYCLE.end);
  }
}

/** Confirms every rule a run pinned, as a different person from the one who set them, so the run is real. */
export async function confirmAllPins(world: RunWorld, runId: string): Promise<void> {
  const run = await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } });
  for (const p of (run.pins as unknown as RulePin[]).filter((x) => (x.kind ?? "RULE") === "RULE")) {
    const pre = await previewConfirm(p.key, world.checkerA.userId);
    if (pre.blocked) continue;
    await confirmRule(p.key, { version: pre.version, typedValue: pre.requiresRetype ? pre.value : undefined, note: "checked in the test", fingerprint: pre.fingerprint }, { userId: world.checkerA.userId });
  }
}

export const step = (token: string, runId: string, slug: string, what: string, body?: object) => api(token, "post", `/runs/${runId}/approvals/${slug}/${what}`, body);
export const state = async (token: string, runId: string) => (await api(token, "get", `/runs/${runId}/approvals`)).body as { runStatus: string; steps: Array<{ slug: string; live: { status: string; hash: string; checker: { name: string } | null } | null; last: { status: string; decisionNote: string | null; voidReason: string | null } | null; checkers: { state: string; message: string } | null; you: { canMake: boolean; canDecide: boolean } }> };
export const stepOf = async (token: string, runId: string, slug: string) => (await state(token, runId)).steps.find((s) => s.slug === slug)!;
export const runRow = (runId: string) => prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } });

export async function submit(world: RunWorld, runId: string, note = "please check") {
  const p = await step(world.tokens.maker, runId, "run", "preview");
  if (p.status !== 200 || !p.body.canRequest) throw new Error(`submit preview: ${JSON.stringify(p.body)}`);
  const r = await step(world.tokens.maker, runId, "run", "request", { fingerprint: p.body.fingerprint, note });
  if (r.status !== 201) throw new Error(`submit: ${JSON.stringify(r.body)}`);
}
export async function approve(world: Closing, token: string, runId: string, slug: string) {
  const live = (await stepOf(token, runId, slug)).live;
  const r = await step(token, runId, slug, "decision", { decision: "APPROVE", hash: live!.hash, note: "looks right" });
  if (r.status !== 200) throw new Error(`approve ${slug}: ${JSON.stringify(r.body)}`);
}
export async function requestStep(token: string, runId: string, slug: string, note?: string) {
  const p = await step(token, runId, slug, "preview");
  if (p.status !== 200 || !p.body.canRequest) throw new Error(`${slug} preview: ${JSON.stringify(p.body)}`);
  const r = await step(token, runId, slug, "request", { fingerprint: p.body.fingerprint, ...(note ? { note } : {}) });
  if (r.status !== 201) throw new Error(`${slug} request: ${JSON.stringify(r.body)}`);
}
/** The whole road: submit, approve, request the lock, approve it, carry it out. */
export async function driveToFinal(world: Closing, runId: string): Promise<void> {
  await submit(world, runId);
  await approve(world, world.tokens.checkerA, runId, "run");
  await requestStep(world.tokens.maker, runId, "finalise");
  await approve(world, world.tokens.checkerB, runId, "finalise");
  const done = await api(world.tokens.maker, "post", `/runs/${runId}/finalise`);
  if (done.status !== 200) throw new Error(`finalise: ${JSON.stringify(done.body)}`);
}

export const resetSeams = () => {
  setPayrollLockCheck(null);
  setPayrollConsumptionCheck(null);
  setPayrollInputsListener(null);
  setArrearsBasisProvider(null);
  setEncashmentRateProvider(new SettingsBasedEncashmentRateProvider());
};
