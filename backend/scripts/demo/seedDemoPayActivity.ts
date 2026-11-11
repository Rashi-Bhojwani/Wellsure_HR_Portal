import request from "supertest";
import { createApp } from "../../src/app";
import { addCalendarDays, businessToday } from "../../src/lib/businessDate";
import { signAccessToken } from "../../src/lib/jwt";
import { prisma } from "../../src/lib/prisma";
import { confirmComponent, previewComponentConfirm, previewComponentSave, saveComponent } from "../../src/modules/payroll/salary/components";
import { loanSchedule } from "../../src/modules/payroll/loans/schedule";
import { scheduleJson } from "../../src/modules/payroll/loans/service";
import { executeCalculation, setCalculationEnqueuer } from "../../src/modules/payroll/run/engine";
import { registerPayrollSeams } from "../../src/modules/payroll/wiring";
import { DEMO_SETTING } from "../../src/modules/payroll/setup/status";

// THE DEMO COMPANY'S PAY HISTORY (docs/plans/DEMO_PAY_ACTIVITY.md). Run after seedDemoCompany(), on the demo company only. Everything is made up and labelled DEMO:
// two finished payroll runs (three months back and two months back; the month the demo test pays stays untouched), loans in four states, claims of two types in five
// states, a director hold and a missing bank account, two settlements (one confirmed and unpaid, one paid) and one finished off-cycle run with its bank file.
//
// It goes through the same API the screens use, as the demo's two directors and its employees, with one exception: a loan request cannot be made for a month that has
// passed, and a run cannot be made for a month that has not ended, so no loan requested today could ever be recovered by a run the demo can make. The loan REQUESTS are
// therefore written dated in the demo's past (makeDemoLoan below); their sanction, payment, recovery and settlement all go through the real services.

const iso = (d: Date) => d.toISOString().slice(0, 10);
const monthStart = (offset: number) => {
  const t = businessToday();
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + offset, 1));
};
const monthEnd = (offset: number) => addCalendarDays(monthStart(offset + 1), -1);

export interface DemoActivityResult {
  runs: string[];
  loans: Record<"active" | "closed" | "stopped" | "shortfall" | "leaver", string>;
  claims: Record<string, string>;
  settlements: { paid: string; unpaid: string };
  offCycleRunId: string;
}

export async function seedDemoPayActivity(): Promise<DemoActivityResult> {
  if ((await prisma.systemSetting.findUnique({ where: { key: DEMO_SETTING } }))?.value !== true) throw new Error("The demo company does not exist in this database. Run `npm run seed:demo-company` first.");
  if (await prisma.loan.findFirst({ where: { typeKey: "DEMO_ADVANCE" } })) throw new Error("The demo pay history already exists.");
  registerPayrollSeams();
  setCalculationEnqueuer(async () => undefined);
  const app = createApp();
  const people = await prisma.employee.findMany({ where: { employeeCode: { startsWith: "DEMO" } }, select: { id: true, employeeCode: true, user: { select: { id: true } } } });
  const emp = (code: string) => people.find((p) => p.employeeCode === code)!.id;
  const user = (code: string) => people.find((p) => p.employeeCode === code)!.user!.id;
  const tok = (code: string) => signAccessToken(user(code));
  const call = async (who: string, method: "get" | "post" | "put", path: string, body?: object, expect = [200, 201, 202]) => {
    const r = await request(app)[method](`/api/${path}`).set("Authorization", `Bearer ${tok(who)}`).send(body);
    if (!expect.includes(r.status)) throw new Error(`DEMO pay history: ${method.toUpperCase()} ${path} as ${who}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  const OWNER = "DEMO001";
  const SECOND = "DEMO013";
  const m3 = { start: monthStart(-3), end: monthEnd(-3) };
  const m2 = { start: monthStart(-2), end: monthEnd(-2) };

  // ── Pay heads for loans and claims (entered by one director, confirmed by the other) ──
  const heads: Array<[string, string, "EARNING" | "DEDUCTION", number]> = [
    ["DEMO_LOAN_PAY", "Demo loan paid out", "EARNING", 20],
    ["DEMO_LOAN_PRIN", "Demo principal part", "DEDUCTION", 21],
    ["DEMO_LOAN_INT", "Demo interest part", "DEDUCTION", 22],
    ["DEMO_CLAIM_PAY", "Demo reimbursement", "EARNING", 23],
  ];
  for (const [code, name, type, order] of heads) {
    const value = { name, type, taxable: false, pfApplicable: false, esiApplicable: false, prorates: false, payslipLabel: name, payslipOrder: order };
    const p = await previewComponentSave(code, value);
    await saveComponent(code, { value, note: "DEMO COMPANY", fingerprint: p.fingerprint }, { userId: user(OWNER) });
    const c = await previewComponentConfirm(code, user(SECOND));
    await confirmComponent(code, { version: c.version, note: "DEMO COMPANY", fingerprint: c.fingerprint }, { userId: user(SECOND) });
  }

  // ── Loan type and claim types: made-up DEMO values ──
  await call(OWNER, "put", "loans/types", { typeKey: "DEMO_ADVANCE", name: "Demo salary advance", maxAmount: "300000", maxInstalments: 24, ratePercent: "6", employeesMayRequest: true, disbursementHead: "DEMO_LOAN_PAY", principalHead: "DEMO_LOAN_PRIN", interestHead: "DEMO_LOAN_INT", reason: "DEMO COMPANY: made-up values" });
  await call(OWNER, "put", "reimbursements/types", { typeKey: "DEMO_TRAVEL", name: "Demo travel", employeesMayClaim: true, billsRequired: false, monthlyCapSet: true, monthlyCap: "5000", yearlyCapSet: true, yearlyCap: null, payHead: "DEMO_CLAIM_PAY", reason: "DEMO COMPANY: made-up values" });
  await call(OWNER, "put", "reimbursements/types", { typeKey: "DEMO_MEALS", name: "Demo meals", employeesMayClaim: true, billsRequired: false, monthlyCapSet: true, monthlyCap: null, yearlyCapSet: true, yearlyCap: "24000", payHead: "DEMO_CLAIM_PAY", reason: "DEMO COMPANY: made-up values" });

  // ── Loans: the request dated in the demo's past (the one step not through the screens, see the header); sanction by two directors through the API ──
  const type = await prisma.loanTypeVersion.findFirstOrThrow({ where: { typeKey: "DEMO_ADVANCE" }, orderBy: { version: "desc" } });
  const makeDemoLoan = async (code: string, principal: string, rate: string, instalments: number, firstMonth: Date, purpose: string) => {
    const schedule = loanSchedule(principal, rate, instalments, iso(firstMonth));
    const loan = await prisma.loan.create({ data: { employeeId: emp(code), typeKey: type.typeKey, typeVersion: type.version, principal, ratePercent: rate, instalments, firstMonth, schedule: scheduleJson(schedule), purpose, requestedByEmployee: false, createdByUserId: user(OWNER) } });
    const view = await call(OWNER, "get", `loans/${loan.id}`);
    await call(OWNER, "post", `loans/${loan.id}/sanction`, { fingerprint: view.fingerprint });
    await call(SECOND, "post", `loans/${loan.id}/sanction/decision`, { fingerprint: view.fingerprint, decision: "APPROVE" });
    return loan.id;
  };
  const loans = {
    active: await makeDemoLoan("DEMO006", "60000", "6", 6, m2.start, "DEMO: made-up advance, recovered over six months"),
    closed: await makeDemoLoan("DEMO007", "12000", "0", 1, m2.start, "DEMO: made-up advance, one instalment"),
    stopped: await makeDemoLoan("DEMO008", "30000", "0", 3, monthStart(-1), "DEMO: made-up advance whose recovery the directors stopped"),
    shortfall: await makeDemoLoan("DEMO002", "150000", "0", 2, m2.start, "DEMO: made-up advance larger than a month's net pay"),
    leaver: await makeDemoLoan("DEMO011", "24000", "0", 4, m2.start, "DEMO: made-up advance of someone leaving"),
  };
  // Recovery stopped: the remaining instalments cancelled (a loan change, prepared by one director and decided by the other). The balance stays owed.
  const change = await call(OWNER, "post", `loans/${loans.stopped}/changes`, { kind: "CANCEL_PENDING", reference: "DEMO: recovery stopped by the directors" });
  await call(SECOND, "post", `loans/${loans.stopped}/changes/${change.id}/decision`, { decision: "APPROVE", note: "DEMO" });

  // ── Claims, as the employees themselves ──
  const claim = async (code: string, typeKey: string, spentOn: Date, amount: string, description: string) => {
    const r = await request(app).post("/api/reimbursements/mine").set("Authorization", `Bearer ${tok(code)}`).field("typeKey", typeKey).field("spentOn", iso(spentOn)).field("amount", amount).field("description", description);
    if (r.status !== 201) throw new Error(`DEMO claim: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.id as string;
  };
  const spent = addCalendarDays(m3.start, 9);
  const claims = {
    paid: await claim("DEMO003", "DEMO_TRAVEL", spent, "1800", "DEMO: made-up taxi fares to a client visit"),
    approved: await claim("DEMO006", "DEMO_MEALS", spent, "950", "DEMO: made-up team lunch"),
    submitted: await claim("DEMO007", "DEMO_TRAVEL", spent, "4200", "DEMO: a long made-up description to check how long values wrap on narrow screens — a train journey, two hotel nights at a fictional hotel, local travel between three fictional sites, and a parking receipt, all invented for the demo company"),
    rejected: await claim("DEMO008", "DEMO_MEALS", spent, "700", "DEMO: made-up dinner"),
    withdrawn: await claim("DEMO009", "DEMO_TRAVEL", spent, "300", "DEMO: made-up bus fare"),
    leaver: await claim("DEMO011", "DEMO_MEALS", spent, "1200", "DEMO: made-up farewell lunch"),
  };
  await call(OWNER, "post", `reimbursements/${claims.paid}/decision`, { decision: "APPROVE" });
  await call(OWNER, "post", `reimbursements/${claims.rejected}/decision`, { decision: "REJECT", reason: "DEMO: no business purpose given" });
  await call(OWNER, "post", `reimbursements/${claims.leaver}/decision`, { decision: "APPROVE" });
  await call("DEMO009", "post", `reimbursements/mine/${claims.withdrawn}/withdraw`);

  // ── Attendance for the two history months, locked (made up: present on weekdays, Sundays off) ──
  const active = await prisma.employee.findMany({ where: { status: "ACTIVE", dateOfJoining: { lte: businessToday() } }, select: { id: true } });
  await prisma.dailyAttendance.deleteMany({ where: { employeeId: { in: active.map((e) => e.id) }, date: { gte: m3.start, lte: m2.end } } });
  const rows = [];
  for (const e of active) for (let d = m3.start; d <= m2.end; d = addCalendarDays(d, 1)) rows.push({ employeeId: e.id, date: d, status: d.getUTCDay() === 0 ? "O" : "P", lopDays: "0", source: "DEVICE" as const, capture: "DEVICE" as const, engineVersion: 1, isLocked: true });
  await prisma.dailyAttendance.createMany({ data: rows });

  // ── A director hold for the second month ──
  await call(OWNER, "post", "payroll/holds", { input: { employeeId: emp("DEMO009"), cycleStart: iso(m2.start), reason: "DEMO: documents pending" } });

  // ── Two finished runs, each submitted, approved, finalised, published (one director prepares, the other decides) ──
  const finishRun = async (cycleStart: Date) => {
    const created = await call(OWNER, "post", "payroll/runs", { cycleStart: iso(cycleStart) });
    const pre = await call(OWNER, "post", `payroll/runs/${created.id}/calculate-preview`);
    await call(OWNER, "post", `payroll/runs/${created.id}/calculate`, { fingerprint: pre.fingerprint });
    await executeCalculation(created.id, "demo-seed");
    const step = (who: string, slug: string, what: string, body?: object) => call(who, "post", `payroll/runs/${created.id}/approvals/${slug}/${what}`, body);
    for (const slug of ["run", "finalise", "publish"]) {
      const p = await step(OWNER, slug, "preview");
      if (!p.canRequest) throw new Error(`DEMO run ${iso(cycleStart)} ${slug}: ${JSON.stringify(p.blockers)}`);
      await step(OWNER, slug, "request", { fingerprint: p.fingerprint, note: "DEMO" });
      const state = (await call(SECOND, "get", `payroll/runs/${created.id}/approvals`)).steps.find((s: { slug: string }) => s.slug === slug);
      await step(SECOND, slug, "decision", { decision: "APPROVE", hash: state.live.hash, note: "DEMO" });
      if (slug === "finalise") await call(OWNER, "post", `payroll/runs/${created.id}/finalise`);
      if (slug === "publish") await call(OWNER, "post", `payroll/runs/${created.id}/payslips/publish`);
    }
    return created.id as string;
  };
  const runs = [await finishRun(m3.start), await finishRun(m2.start)];
  // This claim is approved after both runs, so it waits, approved, for the next run.
  await call(OWNER, "post", `reimbursements/${claims.approved}/decision`, { decision: "APPROVE" });

  // ── Two leavers (last working day at the end of this month) and their settlements ──
  const lwd = iso(monthEnd(0));
  const leave = async (code: string) => {
    await call("DEMO004", "post", `employees/${emp(code)}/separations`, { lastWorkingDate: lwd, reason: "DEMO: made-up resignation" });
    return (await prisma.separation.findFirstOrThrow({ where: { employeeId: emp(code), status: { not: "CANCELLED" } } })).id;
  };
  const settle = async (separationId: string, notice: string) => {
    const s = await call(OWNER, "post", "settlements", { separationId, directorLines: [{ label: "Notice pay (DEMO figure)", amount: notice, source: "DEMO COMPANY: a made-up figure" }] });
    await call(OWNER, "post", `settlements/${s.id}/confirm`, { fingerprint: s.fingerprint });
    await call(SECOND, "post", `settlements/${s.id}/decision`, { fingerprint: s.fingerprint, decision: "APPROVE" });
    return s.id as string;
  };
  const settlements = { paid: await settle(await leave("DEMO008"), "45000"), unpaid: await settle(await leave("DEMO011"), "20000") };

  // ── The paid settlement through an off-cycle run, its bank file written, downloaded and marked sent ──
  const payOn = iso(addCalendarDays(businessToday(), 3));
  const prepared = await call(OWNER, "post", "offcycle", { kind: "SETTLEMENT", sourceRef: settlements.paid, paymentDate: payOn });
  await call(OWNER, "post", `offcycle/${prepared.id}/approval`, { fingerprint: prepared.fingerprint });
  await call(SECOND, "post", `offcycle/${prepared.id}/decision`, { fingerprint: prepared.fingerprint, decision: "APPROVE" });
  const fin = await call(OWNER, "post", `offcycle/${prepared.id}/finalise`);
  await call(OWNER, "post", `offcycle/${prepared.id}/bank/approval`, { fingerprint: fin.bankFingerprint });
  await call(SECOND, "post", `offcycle/${prepared.id}/bank/decision`, { fingerprint: fin.bankFingerprint, decision: "APPROVE" });
  const file = await call(OWNER, "post", `offcycle/${prepared.id}/bank/file`);
  await call(OWNER, "get", `offcycle/bank/${file.batchId}/download`);
  await call(OWNER, "post", `offcycle/bank/${file.batchId}/sent`, { note: "DEMO: uploaded to the fictional bank" });
  setCalculationEnqueuer(null);
  return { runs, loans, claims, settlements, offCycleRunId: prepared.id };
}
