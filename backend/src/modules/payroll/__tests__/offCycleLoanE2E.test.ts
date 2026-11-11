import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setBusinessTodayForTests } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { app, authHeader } from "../../employee/__tests__/employeeTestHelpers";
import { REAL_RULES, closeWorld, closingWorld, confirmAllPins, driveToFinal, resetSeams, staffWith, type Closing } from "./closeTestHelpers";
import { calculateAgain, calculateRun, lockCycle, setRules } from "./runTestHelpers";
import { makeComponent } from "./salaryTestHelpers";

// Step 4 (2026-11-11): end to end — a settlement that recovers a loan through an off-cycle run. The loan's balance, the ledger rows, paid once, the bank file marked sent once,
// double clicks and retries with no double effect, and a regular run's figures for everyone else unchanged. Made-up people and figures only.
const seam = vi.hoisted(() => ({ ready: false }));
vi.mock("../setup/status", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../setup/status")>();
  return { ...actual, readinessOf: (report: Parameters<typeof actual.readinessOf>[0]) => (seam.ready ? { ...actual.readinessOf(report), ready: true, blockers: [] } : actual.readinessOf(report)) };
});
const paise = (s: string) => {
  const neg = s.startsWith("-");
  const [w, f = ""] = (neg ? s.slice(1) : s).split(".");
  const v = BigInt(w!) * 100n + BigInt((f + "00").slice(0, 2));
  return neg ? -v : v;
};
const LAYOUT = {
  format: "DELIMITED",
  delimiter: ",",
  lineEnding: "LF",
  extension: "csv",
  dateFormat: "DD-MM-YYYY",
  amountDecimals: 2,
  header: [[{ source: "CONSTANT", value: "ZZHDR9917" }, { source: "PATTERN", value: "{COUNT}" }, { source: "PATTERN", value: "{TOTAL}" }]],
  columns: [{ source: "FIELD", value: "SERIAL" }, { source: "FIELD", value: "NAME" }, { source: "FIELD", value: "ACCOUNT_NUMBER" }, { source: "FIELD", value: "IFSC" }, { source: "FIELD", value: "AMOUNT" }, { source: "FIELD", value: "NARRATION" }],
  narrationPattern: "Pay {PERIOD}",
};

describe("end to end: a settlement recovers a loan through an off-cycle run", () => {
  let world: Closing;
  const typeKey = `TE${Date.now().toString(36).slice(-5).toUpperCase()}`;
  let loanId = "";
  let septRun = "";
  let snapshotB: unknown = null;
  let offId = "";
  const who = (n: string) => world.named[n]!.employeeId;
  const api = (token: string, method: "get" | "post" | "put", path: string, body?: object) => request(app)[method](`/api${path}`).set(...authHeader(token)).send(body);
  const maker = () => world.tokens.maker;
  const lines = async (runId: string, employeeId: string) => (await prisma.payrollRunLine.findMany({ where: { runId, employeeId }, orderBy: [{ code: "asc" }, { sourceRef: "asc" }] })).map((l) => [l.code, l.kind, l.amount.toString(), l.sourceRef]);
  const itemOf = async (runId: string, employeeId: string) => {
    const i = await prisma.payrollRunItem.findFirstOrThrow({ where: { runId, employeeId } });
    return { gross: i.gross.toString(), deductions: i.deductions.toString(), net: i.netPay.toString(), status: i.status, lines: await lines(runId, employeeId) };
  };

  beforeAll(async () => {
    world = await closingWorld(["a", "b"]);
    await staffWith(world, ["a", "b"]);
    for (const n of ["a", "b"]) await lockCycle(who(n), "2026-09-01", "2026-09-30");
    await setRules(world.maker.userId, REAL_RULES);
    await makeComponent(world, `${world.prefix}_LOANPAY`, { name: "Loan paid out", payslipLabel: "Loan paid out", payslipOrder: 30, taxable: false, prorates: false });
    await makeComponent(world, `${world.prefix}_LOANPRIN`, { name: "Principal Part", type: "DEDUCTION", payslipLabel: "Principal Part", payslipOrder: 31, taxable: false, prorates: false });
    await makeComponent(world, `${world.prefix}_LOANINT`, { name: "Interest Part", type: "DEDUCTION", payslipLabel: "Interest Part", payslipOrder: 32, taxable: false, prorates: false });
    // A bank layout, confirmed by a second person.
    const pre = await api(maker(), "post", "/payroll/layouts/BANK_TEMPLATE/save-preview", { value: LAYOUT });
    await request(app).put("/api/payroll/layouts/BANK_TEMPLATE").set(...authHeader(maker())).send({ value: LAYOUT, fingerprint: pre.body.fingerprint });
    const cp = await api(world.tokens.checkerA, "post", "/payroll/layouts/BANK_TEMPLATE/confirm-preview");
    expect((await api(world.tokens.checkerA, "post", "/payroll/layouts/BANK_TEMPLATE/confirm", { version: cp.body.version, note: "checked against the bank's specification", fingerprint: cp.body.fingerprint })).status).toBe(200);
    // A loan for "a": 30,000 over three months from August, no interest; sanctioned by a different director.
    expect((await api(maker(), "put", "/loans/types", { typeKey, name: "Test advance", maxAmount: "100000", maxInstalments: 12, ratePercent: "0", employeesMayRequest: false, disbursementHead: `${world.prefix}_LOANPAY`, principalHead: `${world.prefix}_LOANPRIN`, interestHead: `${world.prefix}_LOANINT`, reason: "made up" })).status).toBe(200);
    setBusinessTodayForTests(new Date("2026-08-10T00:00:00Z"));
    const made = await api(world.tokens.checkerB, "post", "/loans", { employeeId: who("a"), typeKey, principal: "30000", instalments: 3, firstMonth: "2026-08-01", purpose: "test" });
    loanId = made.body.id;
    const view = await api(world.tokens.checkerB, "get", `/loans/${loanId}`);
    await api(world.tokens.checkerB, "post", `/loans/${loanId}/sanction`, { fingerprint: view.body.fingerprint });
    expect((await api(world.tokens.checkerA, "post", `/loans/${loanId}/sanction/decision`, { fingerprint: view.body.fingerprint, decision: "APPROVE" })).status).toBe(200);
    setBusinessTodayForTests(null);
    // August: the loan is paid out and the first instalment recovered.
    const aug = await calculateRun(world);
    await confirmAllPins(world, aug);
    await driveToFinal(world, aug);
    // The directors stop recovery (the rest of the balance is now recovered only at exit).
    const change = await api(maker(), "post", `/loans/${loanId}/changes`, { kind: "CANCEL_PENDING", reference: "test: recovery stopped" });
    expect((await api(world.tokens.checkerA, "post", `/loans/${loanId}/changes/${change.body.id}/decision`, { decision: "APPROVE" })).status).toBe(200);
    // September for everyone, calculated before anything off-cycle happens: b's figures are the baseline.
    septRun = await calculateRun(world, "2026-09-01");
    snapshotB = await itemOf(septRun, who("b"));
  }, 900_000);

  afterAll(async () => {
    seam.ready = false;
    setBusinessTodayForTests(null);
    resetSeams();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT set_config('app.audit_purge', 'test', true)");
      await tx.loanTypeVersion.deleteMany({ where: { typeKey } });
    });
    await closeWorld(world);
  }, 300_000);

  it("the settlement shows what is still owed on the loan, from its source", async () => {
    const before = await api(maker(), "get", `/loans/${loanId}`);
    expect(before.body).toMatchObject({ balance: "20000.00", recovery: "STOPPED" });
    const sep = await prisma.separation.create({ data: { employeeId: who("a"), lastWorkingDate: new Date("2026-09-30T00:00:00Z"), reason: "test", initiatedByUserId: world.maker.userId } });
    const s = await api(maker(), "post", "/settlements", { separationId: sep.id, directorLines: [{ label: "Notice pay", amount: "30000", source: "made-up figure" }] });
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    const owed = (s.body.lines as Array<{ kind: string; amount: string; source: string }>).find((l) => l.kind === "LOAN_OWED")!;
    expect([owed.amount, owed.source]).toEqual(["-20000.00", `loan ${loanId}`]);
    expect(paise(s.body.total)).toBe(paise("30000") - paise("20000"));
    await api(maker(), "post", `/settlements/${s.body.id}/confirm`, { fingerprint: s.body.fingerprint });
    // A second director's double click on the decision: one decides, the other finds nothing waiting.
    const [d1, d2] = await Promise.all([1, 2].map(() => api(world.tokens.checkerA, "post", `/settlements/${s.body.id}/decision`, { fingerprint: s.body.fingerprint, decision: "APPROVE" })));
    expect([d1!.status, d2!.status].sort()).toEqual([200, 409]);
    seam.ready = true;
    // A double click on Prepare: one run is made, the other click is told it exists.
    const both = await Promise.all([1, 2].map(() => api(maker(), "post", "/offcycle", { kind: "SETTLEMENT", sourceRef: s.body.id, paymentDate: "2099-01-15" })));
    expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(both.find((r) => r.status === 409)!.body.error.code).toBe("ALREADY_PREPARED");
    expect(await prisma.offCycleRun.count({ where: { sourceRef: s.body.id } })).toBe(1);
    const off = both.find((r) => r.status === 201)!;
    offId = off.body.id;
    expect(paise(off.body.net)).toBe(paise("10000"));
  });

  it("approved once, finalised once (a double click and a retry change nothing), the loan recovered at exit, the ledger written once", async () => {
    const v = (await api(maker(), "get", "/offcycle")).body.runs.find((r: { id: string }) => r.id === offId);
    expect((await api(maker(), "post", `/offcycle/${offId}/approval`, { fingerprint: v.fingerprint })).status).toBe(200);
    expect((await api(maker(), "post", `/offcycle/${offId}/approval`, { fingerprint: v.fingerprint })).status).toBe(409); // asked twice: already waiting
    const [a1, a2] = await Promise.all([1, 2].map(() => api(world.tokens.checkerA, "post", `/offcycle/${offId}/decision`, { fingerprint: v.fingerprint, decision: "APPROVE" })));
    expect([a1!.status, a2!.status].sort()).toEqual([200, 409]);
    const [f1, f2] = await Promise.all([1, 2].map(() => api(maker(), "post", `/offcycle/${offId}/finalise`)));
    expect([f1!.status, f2!.status].sort()).toEqual([200, 409]);
    expect((await api(maker(), "post", `/offcycle/${offId}/finalise`)).status).toBe(409); // a retry later
    expect(await prisma.offCycleFinalisation.count({ where: { runId: offId } })).toBe(1);
    const recoveries = await prisma.offCycleLoanRecovery.findMany({ where: { loanId } });
    expect(recoveries.map((r) => r.amount.toFixed(2))).toEqual(["20000.00"]);
    const loan = await api(maker(), "get", `/loans/${loanId}`);
    expect(loan.body).toMatchObject({ balance: "0.00", recovery: "RECOVERED_AT_EXIT" });
    expect(paise(loan.body.recovered)).toBe(paise("10000")); // what payroll recovered; the rest at exit
    // Ledger: the August instalment consumed by the regular run; the other two cancelled by the change; nothing pending; the exit recovery once.
    const adj = await prisma.payrollAdjustment.findMany({ where: { source: { in: ["LOAN_PRINCIPAL", "LOAN_INTEREST"] }, sourceRef: { startsWith: loanId } } });
    expect(adj.map((a) => a.status).sort()).toEqual(["CANCELLED", "CANCELLED", "CONSUMED"]);
    // Paying the same settlement again is refused at every door.
    const sid = (await prisma.offCycleRun.findUniqueOrThrow({ where: { id: offId } })).sourceRef;
    expect((await api(maker(), "post", "/offcycle", { kind: "SETTLEMENT", sourceRef: sid, paymentDate: "2099-01-15" })).body.error.code).toBe("ALREADY_PAID");
  });

  it("the bank file is written once (double click), downloaded, and marked sent once (double click)", async () => {
    const v = (await api(maker(), "get", "/offcycle")).body.runs.find((r: { id: string }) => r.id === offId);
    expect((await api(maker(), "post", `/offcycle/${offId}/bank/approval`, { fingerprint: v.bankFingerprint })).status).toBe(200);
    expect((await api(world.tokens.checkerB, "post", `/offcycle/${offId}/bank/decision`, { fingerprint: v.bankFingerprint, decision: "APPROVE" })).status).toBe(200);
    const [g1, g2] = await Promise.all([1, 2].map(() => api(maker(), "post", `/offcycle/${offId}/bank/file`)));
    expect([g1!.status, g2!.status].sort()).toEqual([201, 409]);
    expect(await prisma.offCycleBankBatch.count({ where: { runId: offId } })).toBe(1);
    const batch = await prisma.offCycleBankBatch.findUniqueOrThrow({ where: { runId: offId } });
    expect(paise(batch.amount.toFixed(2))).toBe(paise("10000"));
    expect((await api(maker(), "get", `/offcycle/bank/${batch.id}/download`)).status).toBe(200);
    const [s1, s2] = await Promise.all([1, 2].map(() => api(maker(), "post", `/offcycle/bank/${batch.id}/sent`)));
    expect([s1!.status, s2!.status].sort()).toEqual([200, 409]);
    expect(await prisma.bankFileSentMark.count({ where: { offCycleBatchId: batch.id } })).toBe(1);
    expect((await api(maker(), "get", "/offcycle")).body.runs.find((r: { id: string }) => r.id === offId)).toMatchObject({ state: "FILE_WRITTEN", file: { sentToBank: true } });
  });

  it("the regular September run: everyone else's figures are exactly what they were; the leaver's loan has nothing left to recover", async () => {
    await calculateAgain(world, septRun);
    expect(await itemOf(septRun, who("b"))).toEqual(snapshotB);
    const aLines = await lines(septRun, who("a"));
    expect(aLines.filter((l) => String(l[0]).endsWith("_LOANPRIN") || String(l[0]).endsWith("_LOANINT"))).toEqual([]);
  });
});

