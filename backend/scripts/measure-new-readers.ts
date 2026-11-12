import { performance } from "node:perf_hooks";
import { assertDevelopmentEnvironment } from "../src/lib/devGuard";

// `npm run measure:new-readers`: the readers and the off-cycle road added in P7-4…P7-7, P7-6b and D-37, timed at a full headcount with made-up volume.
// Development only, AFTER `npm run seed:demo-company` and `npm run measure:payroll -- 500` on a fresh database (it reuses their 500 made-up people and their run).
// Adds, all labelled MEASUREMENT and made up: 150 loans (sanctioned by two directors), 200 claims (half decided), 30 leavers with confirmed settlements.
assertDevelopmentEnvironment("measuring the new payroll readers at full headcount (adds made-up loans, claims and settlements)");

const { prisma } = await import("../src/lib/prisma");
const { addCalendarDays, businessToday } = await import("../src/lib/businessDate");
const { loanSchedule } = await import("../src/modules/payroll/loans/schedule");
const loans = await import("../src/modules/payroll/loans/service");
const claims = await import("../src/modules/payroll/reimbursements/service");
const fnf = await import("../src/modules/payroll/settlements/service");
const offcycle = await import("../src/modules/payroll/offcycle/service");
const tax = await import("../src/modules/payroll/tax/form16");
const { listLeavers } = await import("../src/modules/workforce/leavers");
const behaviours = await import("../src/modules/behaviours/service");
const { buildSetupReport, readinessOf } = await import("../src/modules/payroll/setup/status");
const { computeRun } = await import("../src/modules/payroll/run/engine");
const { resolveAccess } = await import("../src/lib/permissions");
const { registerPayrollSeams } = await import("../src/modules/payroll/wiring");
const { financialYearOf } = await import("@shared/utils/financialYear");
const { default: request } = await import("supertest");
const { createApp } = await import("../src/app");
const { signAccessToken } = await import("../src/lib/jwt");
const { executeCalculation, setCalculationEnqueuer } = await import("../src/modules/payroll/run/engine");

const iso = (d: Date) => d.toISOString().slice(0, 10);
const results: Array<[string, number, number | null]> = [];
async function timed<T>(what: string, budget: number | null, fn: () => Promise<T>): Promise<T> {
  const t = performance.now();
  const out = await fn();
  results.push([what, (performance.now() - t) / 1000, budget]);
  return out;
}

try {
  registerPayrollSeams();
  const user = async (c: string) => (await prisma.employee.findUniqueOrThrow({ where: { employeeCode: c }, select: { id: true, user: { select: { id: true } } } }));
  const d1 = { userId: (await user("DEMO001")).user!.id };
  const d2 = { userId: (await user("DEMO013")).user!.id };
  const hrE = await user("DEMO004");
  const devUser = (await user("DEMO005")).user!.id;
  const people = await prisma.employee.findMany({ where: { status: "ACTIVE", employeeCode: { startsWith: "DEMO1" } }, select: { id: true }, orderBy: { employeeCode: "asc" } });
  if (people.length < 400) throw new Error("Run `npm run measure:payroll -- 500` first.");
  const run = await prisma.payrollRun.findFirstOrThrow({ orderBy: { cycleStart: "desc" } });
  const type = await prisma.loanTypeVersion.findFirstOrThrow({ where: { typeKey: "DEMO_ADVANCE" }, orderBy: { version: "desc" } });

  // ── Volume (once; a second run of this script reuses it) ──
  const fresh = (await prisma.loan.count({ where: { purpose: "MEASUREMENT: made up" } })) === 0;
  const loanPeople = fresh ? people.slice(0, 150) : [];
  await timed("add 150 loans (each sanctioned by two directors through the service)", null, async () => {
    for (const [i, p] of loanPeople.entries()) {
      const principal = String(12000 + (i % 10) * 6000);
      const schedule = loanSchedule(principal, "6", 6, iso(run.cycleStart));
      const loan = await prisma.loan.create({ data: { employeeId: p.id, typeKey: type.typeKey, typeVersion: type.version, principal, ratePercent: "6", instalments: 6, firstMonth: run.cycleStart, schedule: loans.scheduleJson(schedule), purpose: "MEASUREMENT: made up", requestedByEmployee: false, createdByUserId: d1.userId } });
      const v = await loans.directorsLoan(loan.id, d1);
      await loans.requestSanction(loan.id, { fingerprint: v.fingerprint }, d1);
      await loans.decideSanction(loan.id, { fingerprint: v.fingerprint, decision: "APPROVE" }, d2);
    }
  });
  const claimPeople = fresh ? people.slice(100, 300) : [];
  const spent = addCalendarDays(run.cycleStart, 4);
  await timed("add 200 claims (100 approved through the service)", null, async () => {
    for (const [i, p] of claimPeople.entries()) {
      const c = await prisma.reimbursementClaim.create({ data: { employeeId: p.id, typeKey: "DEMO_TRAVEL", typeVersion: 1, spentOn: spent, amount: String(100 + i), description: "MEASUREMENT: made-up claim", bills: [] } });
      if (i % 2 === 0) await claims.decide(c.id, { decision: "APPROVE" }, d1);
    }
  });
  const leavers = fresh ? people.slice(300, 330) : [];
  const lwd = addCalendarDays(new Date(Date.UTC(businessToday().getUTCFullYear(), businessToday().getUTCMonth() + 1, 1)), -1);
  const settlementIds: string[] = [];
  await timed("add 30 leavers with settlements (prepared and confirmed by two directors)", null, async () => {
    for (const p of leavers) {
      const sep = await prisma.separation.create({ data: { employeeId: p.id, lastWorkingDate: lwd, reason: "MEASUREMENT: made up", initiatedByUserId: hrE.user!.id } });
      const s = await fnf.prepare({ separationId: sep.id, directorLines: [{ label: "Notice pay (made up)", amount: "25000", source: "MEASUREMENT: made up" }] }, d1);
      await fnf.requestConfirmation(s.id, { fingerprint: s.fingerprint }, d1);
      await fnf.decideConfirmation(s.id, { fingerprint: s.fingerprint, decision: "APPROVE" }, d2);
      settlementIds.push(s.id);
    }
  });
  if (!fresh) {
    const paid = new Set((await prisma.offCycleFinalisation.findMany({ select: { sourceRef: true } })).map((f) => f.sourceRef));
    const open = new Set((await prisma.offCycleRun.findMany({ select: { sourceRef: true } })).map((r) => r.sourceRef));
    for (const s of await prisma.fnfSettlement.findMany({ where: { separation: { reason: "MEASUREMENT: made up" } }, select: { id: true } })) if (!paid.has(s.id) && !open.has(s.id)) settlementIds.push(s.id);
  }
  // The 500-person run made by measure:payroll, finalised through the API by the two directors, so the quarterly reader reads 500 people.
  if (run.status === "CALCULATED") {
    await timed("finalise the 500-person run through the API (not a reader; for the quarterly figure)", null, async () => {
      setCalculationEnqueuer(async () => undefined);
      const app = createApp();
      const tok = (u: string) => signAccessToken(u);
      const call = async (u: string, path: string, body?: object, method: "post" | "get" = "post") => (await request(app)[method](`/api/${path}`).set("Authorization", `Bearer ${tok(u)}`).send(body)).body;
      // The loans and claims added above changed the figures: calculate again first (as a director would).
      const pre = await call(d1.userId, `payroll/runs/${run.id}/calculate-preview`);
      await call(d1.userId, `payroll/runs/${run.id}/calculate`, { fingerprint: pre.fingerprint });
      await executeCalculation(run.id, "measure");
      for (const slug of ["run", "finalise"]) {
        const p = await call(d1.userId, `payroll/runs/${run.id}/approvals/${slug}/preview`);
        if (!p.canRequest) throw new Error(`${slug}: ${JSON.stringify(p.blockers)}`);
        await call(d1.userId, `payroll/runs/${run.id}/approvals/${slug}/request`, { fingerprint: p.fingerprint, note: "MEASUREMENT" });
        const state = (await call(d2.userId, `payroll/runs/${run.id}/approvals`, undefined, "get")).steps.find((x: { slug: string }) => x.slug === slug);
        await call(d2.userId, `payroll/runs/${run.id}/approvals/${slug}/decision`, { decision: "APPROVE", hash: state.live.hash, note: "MEASUREMENT" });
      }
      await call(d1.userId, `payroll/runs/${run.id}/finalise`);
    });
  }

  // ── The readers (budget: the existing figure for one full screen read at 500, 0.8 s, doubled as Gate 2 allows → 1.6 s) ──
  const READ = 1.6;
  await timed("Loans: the directors' list (150 loans)", READ, () => loans.listAll(d1));
  await timed("Reimbursements: the queue, all 200", READ, () => claims.queue(d1, "ALL"));
  await timed("Settlements: the list (30+ leavers)", READ, () => fnf.list(d1));
  await timed("Off-cycle: what can be paid (candidates)", READ, () => offcycle.candidates(d1));
  await timed("Off-cycle: the list of runs", READ, () => offcycle.list(d1));
  const fy = financialYearOf(iso(run.cycleStart)).label;
  const quarter = Math.floor(((run.cycleStart.getUTCMonth() + 1 - 4 + 12) % 12) / 3) + 1;
  await timed(`Quarterly TDS data (${fy} Q${quarter}, 500 people)`, READ, () => tax.quarterly(fy, quarter, d1));
  await timed("TDS: challan register and reconciliation", READ, () => tax.register(fy, d1));
  const hrAccess = await resolveAccess(hrE.user!.id);
  await timed("Leavers list (HR)", READ, () => listLeavers({ userId: hrE.user!.id, employeeId: hrE.id, roleCodes: hrAccess.roleCodes, dataScope: hrAccess.dataScope, permissions: hrAccess.permissions }, {}));
  await timed("Default behaviours", READ, () => behaviours.list(d1));
  await timed("Ready for First Run (with the behaviour rows)", READ, async () => readinessOf(await buildSetupReport()));
  await timed("Access for the Developer (with the swipes switch), 100 times", READ, async () => {
    for (let i = 0; i < 100; i += 1) await resolveAccess(devUser);
  });
  // ── The calculation with 150 loan instalments due (the D-37 shortfall rule runs per person) — budget: the existing screen-read figure doubled ──
  await timed("a full computeRun with 150 loan instalments due (what a screen read costs)", READ, () => computeRun({ start: run.cycleStart, end: run.cycleEnd, label: run.cycleLabel }));
  // ── The off-cycle road for one settlement (budget: under the existing re-check figure doubled per step → 1.4 s each) ──
  const STEP = 1.4;
  const payOn = iso(addCalendarDays(businessToday(), 3));
  const prepared = await timed("Off-cycle: prepare a settlement", STEP, () => offcycle.prepare({ kind: "SETTLEMENT", sourceRef: settlementIds[0]!, paymentDate: payOn }, d1));
  await timed("Off-cycle: ask for approval", STEP, () => offcycle.requestApproval(prepared.id, { fingerprint: prepared.fingerprint }, d1));
  await timed("Off-cycle: approve", STEP, () => offcycle.decideApproval(prepared.id, { fingerprint: prepared.fingerprint, decision: "APPROVE" }, d2));
  const fin = await timed("Off-cycle: finalise", STEP, () => offcycle.finalise(prepared.id, d1));
  await timed("Off-cycle: ask for the bank file", STEP, () => offcycle.requestBank(prepared.id, { fingerprint: fin.bankFingerprint }, d1));
  await timed("Off-cycle: approve the bank file", STEP, () => offcycle.decideBank(prepared.id, { fingerprint: fin.bankFingerprint, decision: "APPROVE" }, d2));
  await timed("Off-cycle: write the bank file", STEP, () => offcycle.generateBank(prepared.id, d1));

  const headcount = await prisma.employee.count({ where: { status: "ACTIVE", dateOfJoining: { lte: run.cycleEnd } } });
  console.log(`\nNew readers at ${headcount} people in the run's month (this machine, a development database; budgets explained in docs/plans/STAGE_REPORTS.md):\n`);
  let over = 0;
  for (const [what, s, budget] of results) {
    const flag = budget !== null && s > budget ? "  OVER BUDGET" : "";
    if (flag) over += 1;
    console.log(`  ${what.padEnd(84)} ${s.toFixed(2).padStart(7)} s${budget !== null ? `   (budget ${budget} s)` : ""}${flag}`);
  }
  console.log(over ? `\n${over} over budget.` : "\nEverything within budget.");
} finally {
  await prisma.$disconnect();
}
// The services enqueue notices, which leave queue connections open; without this the script prints its table and never exits (as the demo seed found).
process.exit(process.exitCode ?? 0);
