import { performance } from "node:perf_hooks";
import argon2 from "argon2";
import { assertDevelopmentEnvironment } from "../src/lib/devGuard";

// `npm run measure:payroll -- 500`: how long payroll takes, and how much memory it uses, at a full headcount (LOCAL_ASSUMPTIONS rows 21, 25 and 31).
// Development only, on a database that `npm run db:seed` and `npm run seed:demo-company` have prepared. It adds made-up people (codes DEMO013 upward, so the
// same fences that guard the demo company cover them), gives them salaries through the real revision flow, locks a month of attendance, then times the
// calculation, the re-check that every approval step repeats, the register workbook and a sample of payslip PDFs. Nothing here is real data.
assertDevelopmentEnvironment("measuring payroll at full headcount (adds made-up people)");

const { prisma } = await import("../src/lib/prisma");
const { addCalendarDays, businessToday } = await import("../src/lib/businessDate");
const { setSetting } = await import("../src/lib/settings");
const { createPerson, fillPayDetails, DEMO_PASSWORD } = await import("./demo/seedDemoCompany");
const { applyRevision, createRevision, decideRevision, getRevision, previewRevision } = await import("../src/modules/payroll/salary/revisions");
const { createRun, previewCalculation, requestCalculation, listItems } = await import("../src/modules/payroll/run/service");
const { executeCalculation, setCalculationEnqueuer, computeRun } = await import("../src/modules/payroll/run/engine");
const { buildRunWorkbook } = await import("../src/modules/payroll/run/export");
const { liveHashOf } = await import("../src/modules/payroll/run/closing");
const { buildPayslips } = await import("../src/modules/payroll/run/payslip");
const { payslipHtml } = await import("../src/modules/payroll/run/payslipHtml");
const { renderPdf, closePdfRenderer } = await import("../src/lib/pdf/renderer");

const target = Number(process.argv[2] ?? "500");
const iso = (d: Date) => d.toISOString().slice(0, 10);
let peakRss = 0;
const sampler = setInterval(() => (peakRss = Math.max(peakRss, process.memoryUsage().rss)), 50);
const results: Array<[string, string]> = [];
async function timed<T>(what: string, fn: () => Promise<T>): Promise<T> {
  const before = peakRss;
  peakRss = process.memoryUsage().rss;
  const t = performance.now();
  const out = await fn();
  const s = (performance.now() - t) / 1000;
  results.push([what, `${s.toFixed(1)} s, peak memory ${(Math.max(peakRss, process.memoryUsage().rss) / 1048576).toFixed(0)} MB`]);
  peakRss = Math.max(peakRss, before);
  return out;
}

try {
  const code = (c: string) => prisma.employee.findUniqueOrThrow({ where: { employeeCode: c }, select: { id: true, user: { select: { id: true } } } });
  const owner = (await code("DEMO001")).user!.id;
  const maker = owner; // D1: the payroll roles are for directors, so the demo's two directors are the maker and the checker
  const checker = (await code("DEMO013")).user!.id;
  const hr = (await code("DEMO004")).user!.id;
  if ((await prisma.systemSetting.findUnique({ where: { key: "demo.company" } }))?.value !== true) throw new Error("Seed the demo company first (npm run seed:demo-company).");


  const have = await prisma.employee.count({ where: { status: "ACTIVE" } });
  const add = Math.max(0, target - have);
  const org = await (async () => {
    const j = await prisma.employeeJobHistory.findFirstOrThrow({ where: { employee: { employeeCode: "DEMO001" } } });
    return { departmentId: j.departmentId, designationId: j.designationId, locationId: j.locationId, gradeId: j.gradeId, costCentreId: j.costCentreId };
  })();
  const hash = await argon2.hash(DEMO_PASSWORD);
  const ids: string[] = [];
  await timed(`add ${add} made-up people (one by one, as the seed does)`, async () => {
    for (let i = 0; i < add; i += 1) {
      const n = have + i + 1;
      const p = await createPerson({ code: `DEMO${String(n + 1000).padStart(4, "0")}`, name: `Demo Employee ${n}`, role: "EMPLOYEE" }, org, hash, n);
      ids.push(p.employeeId);
    }
  });
  await fillPayDetails(hr);

  const today = businessToday();
  const floor = iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 3, 1)));
  const tiers = ["420000", "720000", "1080000"];
  await timed(`salary revisions for ${ids.length} people (3 revisions, each previewed, approved by a second person and applied)`, async () => {
    for (const [t, annual] of tiers.entries()) {
      const group = ids.filter((_, i) => i % tiers.length === t);
      if (group.length === 0) continue;
      const input = { selection: { kind: "EMPLOYEES", employeeIds: group }, change: { ctc: { mode: "SET", annual }, structure: { key: "DEMO_STD", version: 1 } }, effectiveFrom: floor, note: "MEASUREMENT: made-up" };
      const pr = await previewRevision(input as never, maker);
      const made = await createRevision(input as never, pr.fingerprint, { userId: maker });
      const detail = await getRevision(made.id, checker);
      await decideRevision(made.id, { decision: "APPROVE", note: "MEASUREMENT", fingerprint: detail.fingerprint }, { userId: checker });
      await applyRevision(made.id, { userId: maker });
    }
  });

  const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const last = addCalendarDays(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)), -1);
  const active = await prisma.employee.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
  await prisma.dailyAttendance.deleteMany({ where: { employeeId: { in: active.map((e) => e.id) }, date: { gte: first, lte: last } } });
  const rows = [];
  for (const e of active) for (let d = first; d <= last; d = addCalendarDays(d, 1)) rows.push({ employeeId: e.id, date: d, status: d.getUTCDay() === 0 ? "O" : "P", lopDays: "0", source: "DEVICE" as const, capture: "DEVICE" as const, engineVersion: 1, isLocked: true });
  await prisma.dailyAttendance.createMany({ data: rows });
  await setSetting("demo.company", true, owner);

  // A run for the month just locked (run this on a freshly seeded database: a month can have only one run).
  const queued: string[] = [];
  setCalculationEnqueuer(async (id) => void queued.push(id));
  const run = await createRun(iso(first), { userId: maker });
  const preview = await timed(`calculate: the preview of ${active.length} people`, () => previewCalculation(run.id));
  await requestCalculation(run.id, preview.fingerprint, { userId: maker });
  await timed(`calculate: the job for ${active.length} people`, () => executeCalculation(run.id, "measure"));
  const r = await prisma.payrollRun.findUniqueOrThrow({ where: { id: run.id } });
  await timed("the re-check every approval step repeats (liveHashOf)", () => liveHashOf(r));
  await timed("one more full computeRun (what a screen read can cost)", () => computeRun({ start: r.cycleStart, end: r.cycleEnd, label: r.cycleLabel }));
  await timed("the run's people list, one page of 25", () => listItems(run.id, { page: 1, pageSize: 25 } as never, maker));
  const wb = await timed("the register workbook (built in the API process)", () => buildRunWorkbook(run.id));
  const slips = await timed(`build the payslip content for all ${active.length}`, () => buildPayslips(r));
  const sample = [...slips.values()].slice(0, 15);
  await timed(`render ${sample.length} payslip PDFs with Chromium, one at a time`, async () => {
    for (const s of sample) await renderPdf(payslipHtml(s.content, { watermark: "DEMO COMPANY — NOT REAL" }), new Date());
  });
  const perPdf = results.at(-1)![1].split(" s")[0]!;
  results.push(["…so one payslip PDF takes about", `${(Number(perPdf) / sample.length).toFixed(2)} s; ${active.length} take about ${((Number(perPdf) / sample.length) * active.length / 60).toFixed(1)} minutes`]);

  console.log(`\nPayroll at ${active.length} people (workbook ${(wb.buffer.length / 1024).toFixed(0)} KB; this machine, a development database):\n`);
  for (const [what, took] of results) console.log(`  ${what.padEnd(78)} ${took}`);
  console.log("\nA made-up month on a development machine. The real task size, a pooled database connection and a loaded database will differ: repeat on staging (LOCAL_ASSUMPTIONS 21, 25, 31).");
} finally {
  clearInterval(sampler);
  await closePdfRenderer();
  await prisma.$disconnect();
}
