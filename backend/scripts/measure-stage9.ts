import { performance } from "node:perf_hooks";
import { assertDevelopmentEnvironment } from "../src/lib/devGuard";

// `npm run measure:stage9`: Stage 9 re-measure at 500 people (docs/plans/STAGE_REPORTS.md, Session A Stage 9, item 4b). Development only, on the scratch database
// that `npm run seed:demo-company`, `npm run measure:payroll -- 500` and `npm run measure:new-readers` prepared (500 made-up people, a finalised month for ~500).
// Times, against the recorded 500-person figures doubled (PHASE_6_REVIEW.md §6; the "inside 2x" rule of Phase 2 Gate 2): the full calculation and the approval
// re-check, payslip content, publishing and PDFs, every payroll report with and without branch grouping, and the greytHR parallel-run comparison of a statement
// generated from the run. Everything it adds (one comparison, the payslips of that month) is made up and labelled MEASUREMENT.
assertDevelopmentEnvironment("measuring payroll at 500 people (publishes the scratch month's payslips, adds a comparison)");

const { prisma } = await import("../src/lib/prisma");
const { computeRun } = await import("../src/modules/payroll/run/engine");
const { liveHashOf } = await import("../src/modules/payroll/run/closing");
const { buildPayslips } = await import("../src/modules/payroll/run/payslip");
const { payslipHtml } = await import("../src/modules/payroll/run/payslipHtml");
const { renderPdf, closePdfRenderer } = await import("../src/lib/pdf/renderer");
const { registerPayrollSeams } = await import("../src/modules/payroll/wiring");
const { PAYROLL_REPORTS, PAYROLL_REPORT_KEYS } = await import("@shared/constants/payrollReports");
const { writeXls } = await import("../src/lib/__tests__/xlsWriter");
const { default: request } = await import("supertest");
const { createApp } = await import("../src/app");
const { signAccessToken } = await import("../src/lib/jwt");

const results: Array<[string, number, number | null, string?]> = [];
async function timed<T>(what: string, budget: number | null, fn: () => Promise<T>, note?: string): Promise<T> {
  const t = performance.now();
  const out = await fn();
  results.push([what, (performance.now() - t) / 1000, budget, note]);
  return out;
}
const withLimit = <T>(p: Promise<T>, ms: number, what: string) => Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(new Error(`${what}: no answer in ${ms / 1000} s`)), ms))]);

try {
  registerPayrollSeams();
  const app = createApp();
  const user = async (c: string) => (await prisma.employee.findUniqueOrThrow({ where: { employeeCode: c }, select: { user: { select: { id: true } } } })).user!.id;
  const d1 = await user("DEMO001");
  const d2 = await user("DEMO013");
  const call = (u: string, method: "get" | "post", path: string, body?: object) => request(app)[method](`/api${path}`).set("Authorization", `Bearer ${signAccessToken(u)}`).send(body);
  const must = async (what: string, r: Promise<{ status: number; body: unknown }>, ok: number[] = [200, 201]) => {
    const res = await r;
    if (!ok.includes(res.status)) throw new Error(`${what}: ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
    return res as { status: number; body: Record<string, unknown> & { [k: string]: never } };
  };

  const runs = await prisma.payrollRun.findMany({ where: { status: "FINALISED" }, include: { _count: { select: { items: true } } } });
  const run = runs.sort((a, b) => b._count.items - a._count.items)[0];
  if (!run || run._count.items < 400) throw new Error("Run `npm run measure:payroll -- 500` and `npm run measure:new-readers` first: no finalised month with ~500 people.");
  const month = run.cycleStart.toISOString().slice(0, 7);
  const prevMonth = new Date(Date.UTC(run.cycleStart.getUTCFullYear(), run.cycleStart.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const monthEnd = run.cycleEnd.toISOString().slice(0, 10);
  const people = run._count.items;

  // ── The payroll run ──
  await timed(`full calculation in memory, ${people} people (computeRun: what the job and a screen read cost)`, 1.6, () => computeRun({ start: run.cycleStart, end: run.cycleEnd, label: run.cycleLabel }));
  await timed("the re-check every approval step repeats (liveHashOf)", 1.4, () => liveHashOf(run));

  // ── Payslips ──
  const slips = await timed(`payslip content for all ${people}`, 1.0, () => buildPayslips(run));
  if (!(await prisma.payrollRunRelease.findFirst({ where: { runId: run.id, kind: "PAYSLIPS_PUBLISHED" } }))) {
    const p = await must("publish preview", call(d1, "post", `/payroll/runs/${run.id}/approvals/publish/preview`));
    await must("publish request", call(d1, "post", `/payroll/runs/${run.id}/approvals/publish/request`, { fingerprint: p.body.fingerprint, note: "MEASUREMENT" }));
    const st = await must("approvals", call(d2, "get", `/payroll/runs/${run.id}/approvals`));
    const live = (st.body.steps as unknown as Array<{ slug: string; live: { hash: string } }>).find((s) => s.slug === "publish")!.live;
    await must("publish decision", call(d2, "post", `/payroll/runs/${run.id}/approvals/publish/decision`, { decision: "APPROVE", hash: live.hash, note: "MEASUREMENT" }));
    await timed(`publish ${people} payslips (the route: re-check, write every payslip, queue delivery)`, 1.6, () => must("publish", call(d1, "post", `/payroll/runs/${run.id}/payslips/publish`)), "no recorded figure; held to a screen read's budget");
  } else results.push(["publish payslips", Number.NaN, 1.6, "already published on this database; not re-timed"]);
  const sample = [...slips.values()].slice(0, 15);
  try {
    await timed(`render ${sample.length} payslip PDFs with Chromium, one at a time`, 0.5 * sample.length, () =>
      withLimit((async () => {
        for (const s of sample) await renderPdf(payslipHtml(s.content, { watermark: "MEASUREMENT: MADE UP" }), new Date());
      })(), 120_000, "PDF rendering"),
    "budget 0.5 s each (recorded 0.25 s)");
  } catch (err) {
    results.push([`render ${sample.length} payslip PDFs`, Number.NaN, 0.5 * sample.length, `FAILED: ${(err as Error).message}`]);
  }

  // ── Payroll reports, each as a director opens it, then grouped by branch ──
  const filtersFor = (key: (typeof PAYROLL_REPORT_KEYS)[number]) => {
    const f = PAYROLL_REPORTS[key].filters as readonly string[];
    const q: Record<string, string> = {};
    if (f.includes("month")) q.month = month;
    if (f.includes("compareMonth")) q.compareMonth = prevMonth;
    if (f.includes("fromMonth")) Object.assign(q, { fromMonth: `${run.cycleStart.getUTCFullYear()}-01`, toMonth: month });
    if (f.includes("fromDate")) Object.assign(q, { fromDate: run.cycleStart.toISOString().slice(0, 10), toDate: monthEnd });
    if (f.includes("asOf")) q.asOf = monthEnd;
    return q;
  };
  const qs = (q: Record<string, string>) => new URLSearchParams(q).toString();
  let groups = 0;
  for (const key of PAYROLL_REPORT_KEYS) {
    const q = filtersFor(key);
    const r = await timed(`report ${key}`, 1.6, () => must(key, call(d1, "get", `/payroll-reports/${key}?${qs(q)}`)));
    const rows = (r.body.rows as unknown as unknown[]).length;
    results.at(-1)![3] = `${rows} rows`;
    if ((PAYROLL_REPORTS[key].filters as readonly string[]).includes("groupBy")) {
      const g = await timed(`report ${key}, grouped by branch`, 1.6, () => must(`${key} grouped`, call(d1, "get", `/payroll-reports/${key}?${qs({ ...q, groupBy: "branch" })}`)));
      const n = (g.body.groups as unknown as unknown[] | undefined)?.length ?? 0;
      groups = Math.max(groups, n);
      results.at(-1)![3] = `${n} branches`;
    }
  }
  await timed("report head-wise exported as .xlsx, grouped by branch", 2.2, () => must("export", call(d1, "get", `/payroll-reports/head-wise/export?${qs({ ...filtersFor("head-wise"), groupBy: "branch", format: "xlsx" })}`)), "budget: the register workbook's 1.1 s doubled");

  // ── The greytHR parallel-run comparison against a statement generated from the run ──
  const items = await prisma.payrollRunItem.findMany({ where: { runId: run.id, status: { in: ["PAYABLE", "HELD"] } }, include: { employee: { select: { employeeCode: true } }, lines: true } });
  const label = (l: { label: string; kind: string }) => (l.kind === "EMPLOYER_CONTRIBUTION" ? `${l.label} (employer)` : l.label);
  const heads = [...new Set(items.flatMap((i) => i.lines.filter((l) => l.kind !== "ROUNDING").map(label)))];
  const header = ["EmployeeNo", "Name", "DAYS IN MONTH", "EMP EFFECTIVE WORKDAYS", "LOP", ...heads, "GROSS", "TOTAL DEDUCTIONS", "NET PAY"];
  const rows = items.map((i) => {
    const by = new Map<string, number>();
    for (const l of i.lines.filter((x) => x.kind !== "ROUNDING")) by.set(label(l), (by.get(label(l)) ?? 0) + Number(l.amount.toString())); // allow-number: generated cells
    return [i.employee.employeeCode, "Made-up person", 31, Number(i.paidDays.toString()), Number(i.lopDays.toString()), ...heads.map((h) => by.get(h) ?? 0), Number(i.gross.toString()), Number(i.deductions.toString()), Number(i.netPay.toString())]; // allow-number
  });
  const file = writeXls([{ name: "Report", rows: [[], ["MEASUREMENT COMPANY (made up)"], [`Salary Statement - ${run.cycleLabel}`], [], header, ...rows] }], { sst: true });
  const cmp = await timed(`parallel-run comparison: upload a ${rows.length}-row statement (${Math.round(file.length / 1024)} KB .xls), read, match, store`, 1.6, () =>
    must("compare", request(app).post("/api/payroll-greythr/parallel").set("Authorization", `Bearer ${signAccessToken(d1)}`).field("runId", run.id).attach("file", file, "statement.xls")),
  "no recorded figure; held to a screen read's budget");
  const counts = (cmp.body.result as unknown as { counts: Record<string, number> }).counts;
  results.at(-1)![3] = `${counts.matched ?? "?"} matched, ${counts.differences} differences`;
  const id = cmp.body.id as unknown as string;
  await timed("parallel-run comparison: open it again", 1.6, () => must("open", call(d1, "get", `/payroll-greythr/parallel/${id}`)));
  await timed("parallel-run comparison: export the differences (.xlsx)", 2.2, () => must("export", call(d1, "get", `/payroll-greythr/parallel/${id}/export?format=xlsx`)));

  console.log(`\nStage 9 at ${people} people (${run.cycleLabel}; up to ${groups} branches; this machine, a development database):\n`);
  for (const [what, s, budget, note] of results) {
    const over = budget !== null && Number.isFinite(s) && s > budget;
    console.log(`  ${what.padEnd(100)} ${Number.isFinite(s) ? `${s.toFixed(2)} s` : "—"}${budget === null ? "" : ` / ${budget.toFixed(1)} s`}${over ? "  OVER BUDGET" : ""}${note ? `  (${note})` : ""}`);
  }
  const overs = results.filter(([, s, b]) => b !== null && Number.isFinite(s) && s > b);
  console.log(overs.length ? `\n${overs.length} over budget.` : "\nNothing over budget.");
} finally {
  await closePdfRenderer().catch(() => undefined);
  await prisma.$disconnect();
  process.exit(process.exitCode ?? 0); // notices leave queue connections open (as in measure-new-readers)
}
