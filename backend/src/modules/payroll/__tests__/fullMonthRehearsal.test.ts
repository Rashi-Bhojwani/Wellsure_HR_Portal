import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatAttlogLine } from "@shared/attendance/attlog";
import { deleteWithDependents, purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { writeXls, type TestCell } from "../../../lib/__tests__/xlsWriter";
import { setBusinessTodayForTests } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { setRecomputeHandler } from "../../attendance/recompute";
import { executeProcessRun } from "../../attendance/processService";
import { app, authHeader, loginAs } from "../../employee/__tests__/employeeTestHelpers";
import { REAL_RULES, approve, closeWorld, closingWorld, confirmAllPins, requestStep, staffWith, submit, type Closing } from "./closeTestHelpers";
import { CYCLE, calculateAgain, setRules } from "./runTestHelpers";
import { makeComponent } from "./salaryTestHelpers";
import { setCalculationEnqueuer } from "../run/engine";

// Stage 9 (docs/plans/STAGE_REPORTS.md, Session A Stage 9): ONE month end to end through the API, in order, on made-up people with TEST rule values, each step first
// refused while the step before it has not happened. Punches (the device log) and swipes (greytHR's file) → attendance processed and finalised → leave and a loan
// → the run calculated, approved by a different director, finalised → the bank file, marked sent → payslips published and seen by the employee → PF, ESI and PT
// challan records → the Form 16 draft → a parallel-run comparison against a statement generated from the run. The background worker's place is taken by calling
// its function (executeProcessRun) directly; everything else goes through the routes.
const SAMPLES = path.join(__dirname, "..", "..", "..", "..", "..", "docs", "samples");
const MONTH = CYCLE.start.slice(0, 7);
const FY = "2026-27";
const tag = Date.now().toString(36).slice(-5);
const LAYOUT = {
  format: "DELIMITED", delimiter: ",", quote: true, lineEnding: "CRLF", extension: "csv", dateFormat: "DD-MM-YYYY", amountDecimals: 2, columnHeaders: true,
  header: [], trailer: [],
  columns: [{ header: "A/C no.", source: "FIELD", value: "ACCOUNT_NUMBER" }, { header: "Beneficiary Name", source: "FIELD", value: "NAME" }, { header: "Amount", source: "FIELD", value: "AMOUNT" }, { header: "IFSC code", source: "FIELD", value: "IFSC" }],
};

describe("Stage 9 — a full month, rehearsed end to end", () => {
  let world: Closing;
  let runId = "";
  let deviceId = "";
  let shiftId = "";
  let policyId = "";
  let batchId = "";
  let loanId = "";
  let leaveId = "";
  const comparisonIds: string[] = [];
  const challanIds: string[] = [];
  const startedAt = new Date();
  const tok: Record<string, string> = {};
  const who = (n: string) => world.named[n]!.employeeId;
  const code = (n: string) => world.named[n]!.employeeCode;
  const maker = () => world.tokens.maker;
  const api = (token: string, method: "get" | "post" | "put", p: string, body?: object) => request(app)[method](`/api${p}`).set(...authHeader(token)).send(body);
  const pay = (token: string, method: "get" | "post", p: string, body?: object) => api(token, method, `/payroll${p}`, body);

  beforeAll(async () => {
    world = await closingWorld(["a", "b"]);
    await staffWith(world, ["a", "b"], { lock: false }); // salaries, but NO attendance: the month is rehearsed from punches
    await setRules(world.maker.userId, REAL_RULES);
    setCalculationEnqueuer(async () => undefined); // the calculation job is run directly (calculateAgain)
    setRecomputeHandler(async () => undefined); // days are processed by the explicit process run below
    tok.a = await loginAs(code("a"));
    tok.b = await loginAs(code("b"));
    // A confirmed shift and policy (the defaults carry placeholder values, which block finalising, as they should).
    shiftId = (await prisma.shift.create({ data: { code: `RH${tag}`, name: "Rehearsal shift", startTime: "09:30", endTime: "18:30", sessions: { create: [{ sortOrder: 1, kind: "WORK", label: "Day", startTime: "09:30", endTime: "18:30" }] } } })).id;
    policyId = (await prisma.attendancePolicy.create({ data: { code: `RH${tag}`, name: "Rehearsal policy", fullDayMinMinutes: 450, halfDayMinMinutes: 225 } })).id;
    await prisma.attendanceAssignment.updateMany({ where: { employeeId: { in: [who("a"), who("b")] } }, data: { shiftId, policyId } });
    deviceId = (await api(world.supToken, "post", "/biometric/devices", { serialNumber: `RH-${tag}`, name: "Rehearsal device", locationId: world.org.locationId, route: "PUSH" })).body.id;
    expect(deviceId).toBeTruthy();
    await makeComponent(world, `${world.prefix}_LOANPAY`, { name: "Loan paid out", payslipLabel: "Loan paid out", payslipOrder: 30, taxable: false, prorates: false });
    await makeComponent(world, `${world.prefix}_LOANPRIN`, { name: "Principal Part", type: "DEDUCTION", payslipLabel: "Principal Part", payslipOrder: 31, taxable: false, prorates: false });
    await makeComponent(world, `${world.prefix}_LOANINT`, { name: "Interest Part", type: "DEDUCTION", payslipLabel: "Interest Part", payslipOrder: 32, taxable: false, prorates: false });
  }, 900_000);

  afterAll(async () => {
    setBusinessTodayForTests(null);
    setRecomputeHandler(null);
    setCalculationEnqueuer(null);
    await deleteWithDependents("PayrollParallelComparison", comparisonIds);
    await deleteWithDependents("StatutoryChallan", challanIds);
    // The finalisation is for the whole August cycle, company-wide: the lock this test made (and its audit row) goes, or every later August test meets a
    // finalised period (found by the Stage 9 full suite: muster, regularization and the attendance golden replay).
    await deleteWithDependents("AttendancePeriodLock", (await prisma.attendancePeriodLock.findMany({ where: { periodStart: new Date(`${CYCLE.start}T00:00:00Z`), createdAt: { gte: startedAt } }, select: { id: true } })).map((r) => r.id));
    await purgeAppendOnly("AuditLog", { entityId: `${CYCLE.start}..${CYCLE.end}`, createdAt: { gte: startedAt } });
    expect(await prisma.attendancePeriodLock.count({ where: { periodStart: new Date(`${CYCLE.start}T00:00:00Z`), createdAt: { gte: startedAt } } })).toBe(0);
    expect(await prisma.statutoryChallan.count({ where: { id: { in: challanIds } } })).toBe(0);
    await closeWorld(world);
    await deleteWithDependents("Device", [deviceId]);
    await deleteWithDependents("Shift", [shiftId]);
    await deleteWithDependents("AttendancePolicy", [policyId]);
  }, 300_000);

  /** Every working day of the month (Monday to Saturday here: Sunday is the week-off), 09:30 to 18:40. */
  const workdays = () => {
    const out: string[] = [];
    for (let d = new Date(`${CYCLE.start}T00:00:00Z`); d <= new Date(`${CYCLE.end}T00:00:00Z`); d = new Date(d.getTime() + 86_400_000)) if (d.getUTCDay() !== 0) out.push(d.toISOString().slice(0, 10));
    return out;
  };

  it("1. before any attendance, the run cannot be calculated into anything payable: the month is not finalised", async () => {
    const created = await pay(maker(), "post", "/runs", { cycleStart: CYCLE.start });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    runId = created.body.id;
    await calculateAgain(world, runId);
    const early = await prisma.payrollRunItem.findMany({ where: { runId, employeeId: { in: [who("a"), who("b")] } } });
    expect(early.map((i) => [i.status, i.holdReason])).toEqual([["EXCLUDED", "ATTENDANCE_NOT_FINAL"], ["EXCLUDED", "ATTENDANCE_NOT_FINAL"]]); // nobody is paid for an unfinalised month
    const fin = await api(world.supToken, "post", "/attendance/finalisation", { from: CYCLE.start, to: CYCLE.end, confirm: true });
    expect(fin.status).toBeGreaterThanOrEqual(400); // nothing processed yet: the readiness blockers refuse it
  });

  it("2. punches arrive: the device log for one person, greytHR's swipes file for the other; both previewed, then committed", async () => {
    const att = workdays().filter((d) => d !== "2026-08-12" && d !== "2026-08-13").flatMap((d) => [formatAttlogLine({ deviceUserId: code("a"), localTime: `${d} 09:30:00` }), formatAttlogLine({ deviceUserId: code("a"), localTime: `${d} 18:40:00` })]).join("\n");
    const p1 = await request(app).post("/api/biometric/import/preview").set(...authHeader(world.supToken)).field("deviceId", deviceId).attach("file", Buffer.from(att), "ATTLOG.dat");
    expect([p1.status, p1.body.rejectedCount], JSON.stringify(p1.body)).toEqual([200, 0]);
    expect((await api(world.supToken, "post", `/biometric/import/${p1.body.batchId}/commit`, { reason: "Rehearsal: device log" })).status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join(SAMPLES, "Attendance_Swipes_template.xlsx"));
    const sheet = wb.worksheets[0]!;
    for (let r = 2; r <= sheet.rowCount; r++) sheet.getRow(r).values = [];
    let r = 2;
    for (const d of workdays()) {
      const [y, m, dd] = d.split("-");
      sheet.getRow(r++).values = [code("b"), "B", "In", "Main Door", `${dd}/${m}/${y} 09:31`];
      sheet.getRow(r++).values = [code("b"), "B", "Out", "Main Door", `${dd}/${m}/${y} 18:41`];
    }
    const p2 = await request(app).post("/api/biometric/import/preview").set(...authHeader(world.supToken)).field("deviceId", deviceId).attach("file", Buffer.from(await wb.xlsx.writeBuffer()), "Attendance_Swipes.xlsx");
    expect([p2.status, p2.body.source, p2.body.rejectedCount], JSON.stringify(p2.body).slice(0, 400)).toEqual([200, "SWIPES", 0]);
    batchId = p2.body.batchId;
    expect((await api(world.supToken, "post", `/biometric/import/${batchId}/commit`, { reason: "Rehearsal: greytHR swipes" })).status).toBe(200);
    expect(await prisma.rawPunch.count({ where: { deviceId } })).toBe(workdays().length * 4 - 4);
    // An August file uploaded later is older than the plausibility limit, so its punches are flagged TOO_OLD and finalising is refused until a person accepts them.
    const blocked = await api(world.supToken, "get", `/attendance/finalisation/readiness?from=${CYCLE.start}&to=${CYCLE.end}`);
    const flagged = await prisma.rawPunch.count({ where: { deviceId, flag: { not: null } } });
    if (flagged > 0) {
      expect(JSON.stringify(blocked.body.blockers)).toContain("FLAGGED_PUNCHES");
      const pv = await api(world.supToken, "post", "/biometric/flagged/bulk-accept/preview", { filter: { deviceId } });
      expect([pv.status, pv.body.count], JSON.stringify(pv.body).slice(0, 300)).toEqual([200, flagged]);
      const acc = await api(world.supToken, "post", "/biometric/flagged/bulk-accept", { filter: { deviceId }, fingerprint: pv.body.fingerprint, reason: "Rehearsal: the month's file, uploaded late", confirm: true });
      expect(acc.status, JSON.stringify(acc.body).slice(0, 300)).toBeLessThan(300);
    }
  });

  it("3. leave: a PL is refused without a balance, granted, applied and approved for the two days without punches", async () => {
    const pl = await prisma.leaveType.findFirstOrThrow({ where: { code: "PL" } });
    const ask = () => api(tok.a!, "post", "/leave/requests", { leaveTypeId: pl.id, fromDate: "2026-08-12", toDate: "2026-08-13", fromDayPart: "FULL", toDayPart: "FULL", reason: "Rehearsal: two days off" });
    const before = await ask();
    expect(before.status).toBeGreaterThanOrEqual(400); // no balance yet
    const grant = await api(world.supToken, "post", "/leave/grants", { employeeId: who("a"), leaveTypeId: pl.id, days: 5, entryDate: "2026-08-01", remarks: "Rehearsal opening balance (TEST)" });
    expect(grant.status, JSON.stringify(grant.body)).toBeLessThan(300);
    // FIX-C3 (independent audit 2026-11-20): a grant is a proposal; a different director confirms it.
    const confirmed = await api(world.tokens.checkerA, "post", `/leave/change-requests/${grant.body.id}/confirm`, {});
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    const applied = await ask();
    expect(applied.status, JSON.stringify(applied.body)).toBe(201);
    leaveId = applied.body.id ?? applied.body.request?.id;
    expect(leaveId, JSON.stringify(applied.body).slice(0, 300)).toBeTruthy();
    const ok = await api(world.supToken, "post", `/leave/requests/${leaveId}/approve`, { comments: "Rehearsal" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it("4. attendance is processed, then finalised for the whole cycle; finalising twice is refused", async () => {
    const run = await api(world.supToken, "post", "/attendance/process", { fromDate: CYCLE.start, toDate: CYCLE.end, employeeIds: [who("a"), who("b")], reason: "Rehearsal: the month's punches" });
    expect(run.status, JSON.stringify(run.body)).toBe(202);
    await executeProcessRun(run.body.id); // the worker's job, done here
    const ready = await api(world.supToken, "get", `/attendance/finalisation/readiness?from=${CYCLE.start}&to=${CYCLE.end}`);
    expect([ready.status, ready.body.blockers], JSON.stringify(ready.body.blockers)).toEqual([200, []]);
    const fin = await api(world.supToken, "post", "/attendance/finalisation", { from: CYCLE.start, to: CYCLE.end, confirm: true });
    expect(fin.status, JSON.stringify(fin.body)).toBe(200);
    expect((await api(world.supToken, "post", "/attendance/finalisation", { from: CYCLE.start, to: CYCLE.end, confirm: true })).status).toBeGreaterThanOrEqual(400);
    const days = await prisma.dailyAttendance.findMany({ where: { employeeId: who("a"), date: { gte: new Date("2026-08-12T00:00:00Z"), lte: new Date("2026-08-13T00:00:00Z") } } });
    expect(days.every((d) => d.isLocked)).toBe(true);
  });

  it("5. a loan: requested, refused to its own sanctioner, sanctioned by a different director", async () => {
    const typeKey = `RH${tag}`.toUpperCase();
    expect((await api(maker(), "put", "/loans/types", { typeKey, name: "Rehearsal advance", maxAmount: "100000", maxInstalments: 12, ratePercent: "0", employeesMayRequest: false, disbursementHead: `${world.prefix}_LOANPAY`, principalHead: `${world.prefix}_LOANPRIN`, interestHead: `${world.prefix}_LOANINT`, reason: "TEST" })).status).toBe(200);
    setBusinessTodayForTests(new Date("2026-08-10T00:00:00Z"));
    try {
      const made = await api(world.tokens.checkerB, "post", "/loans", { employeeId: who("b"), typeKey, principal: "12000", instalments: 3, firstMonth: CYCLE.start, purpose: "rehearsal" });
      expect(made.status, JSON.stringify(made.body)).toBe(201);
      loanId = made.body.id;
      const view = await api(world.tokens.checkerB, "get", `/loans/${loanId}`);
      expect((await api(world.tokens.checkerB, "post", `/loans/${loanId}/sanction`, { fingerprint: view.body.fingerprint })).status).toBe(200);
      expect((await api(world.tokens.checkerB, "post", `/loans/${loanId}/sanction/decision`, { fingerprint: view.body.fingerprint, decision: "APPROVE" })).status).toBe(403); // not their own
      expect((await api(world.tokens.checkerA, "post", `/loans/${loanId}/sanction/decision`, { fingerprint: view.body.fingerprint, decision: "APPROVE" })).status).toBe(200);
    } finally {
      setBusinessTodayForTests(null);
    }
  });

  it("6. the run is calculated from the finalised month: the leave days are paid, the loan is paid out and recovered", async () => {
    await calculateAgain(world, runId); // preview → request (202) → the calculation job, run directly
    await confirmAllPins(world, runId);
    const items = await prisma.payrollRunItem.findMany({ where: { runId, employeeId: { in: [who("a"), who("b")] } }, include: { lines: true } });
    expect(items.map((i) => i.status).sort()).toEqual(["PAYABLE", "PAYABLE"]);
    const a = items.find((i) => i.employeeId === who("a"))!;
    expect(a.lopDays.toString()).toBe("0"); // the two leave days are paid leave, not loss of pay
    const b = items.find((i) => i.employeeId === who("b"))!;
    expect(b.lines.map((l) => l.code)).toEqual(expect.arrayContaining([`${world.prefix}_LOANPAY`, `${world.prefix}_LOANPRIN`]));
  });

  it("7. the bank file is refused before the run is finalised; the run is approved only by a different director, then finalised", async () => {
    expect((await pay(maker(), "post", `/runs/${runId}/bank-file/generate`)).status).toBeGreaterThanOrEqual(400);
    await submit(world, runId);
    expect((await pay(maker(), "post", `/runs/${runId}/approvals/run/decide`, { decision: "APPROVE", note: "self" })).status).toBeGreaterThanOrEqual(400); // the preparer never approves
    await approve(world, world.tokens.checkerA, runId, "run");
    await requestStep(maker(), runId, "finalise");
    await approve(world, world.tokens.checkerB, runId, "finalise");
    const done = await pay(maker(), "post", `/runs/${runId}/finalise`);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
  });

  it("8. the bank file: refused without a confirmed bank layout; made once a second director confirms the TEST layout; marked sent only after it was downloaded", async () => {
    expect((await pay(maker(), "post", `/runs/${runId}/bank-file/generate`)).status).toBeGreaterThanOrEqual(400);
    const pre = await pay(maker(), "post", "/layouts/BANK_TEMPLATE/save-preview", { value: { ...LAYOUT, debitAccountNumber: "000099990001" } });
    expect(pre.status, JSON.stringify(pre.body)).toBe(200);
    await api(maker(), "put", "/payroll/layouts/BANK_TEMPLATE", { value: { ...LAYOUT, debitAccountNumber: "000099990001" }, fingerprint: pre.body.fingerprint });
    expect((await pay(maker(), "post", `/runs/${runId}/bank-file/generate`)).status).toBeGreaterThanOrEqual(400); // saved, not confirmed
    const cp = await pay(world.tokens.checkerA, "post", "/layouts/BANK_TEMPLATE/confirm-preview");
    expect((await pay(world.tokens.checkerA, "post", "/layouts/BANK_TEMPLATE/confirm", { version: cp.body.version, note: "TEST layout", fingerprint: cp.body.fingerprint })).status).toBe(200);
    expect((await pay(maker(), "post", `/runs/${runId}/bank-file/generate`)).body.error.code).toBe("APPROVAL_REQUIRED"); // layout confirmed, file not approved
    await requestStep(maker(), runId, "bank-file");
    await approve(world, world.tokens.checkerB, runId, "bank-file");
    const gen = await pay(maker(), "post", `/runs/${runId}/bank-file/generate`);
    expect(gen.status, JSON.stringify(gen.body)).toBe(201);
    const id = (await prisma.bankTransferBatch.findUniqueOrThrow({ where: { runId } })).id;
    const early = await pay(maker(), "post", `/bank-batches/${id}/sent`, {});
    expect([early.status, early.body.error?.code]).toEqual([409, "NOT_DOWNLOADED"]);
    expect((await pay(maker(), "get", `/bank-batches/${id}/file`)).status).toBe(200);
    expect((await pay(maker(), "post", `/bank-batches/${id}/sent`, { note: "uploaded (rehearsal)" })).status).toBe(201);
  });

  it("9. payslips: unseen by the employee before they are published (only after a second director approves); then the employee sees their own", async () => {
    expect((await api(tok.a!, "get", "/payslips/mine")).body.payslips?.length ?? 0).toBe(0);
    expect((await pay(maker(), "post", `/runs/${runId}/payslips/publish`)).body.error.code).toBe("APPROVAL_REQUIRED");
    await requestStep(maker(), runId, "publish");
    await approve(world, world.tokens.checkerA, runId, "publish");
    expect((await pay(maker(), "post", `/runs/${runId}/payslips/publish`)).status).toBe(201);
    const mine = await api(tok.a!, "get", "/payslips/mine");
    expect(mine.status).toBe(200);
    expect(JSON.stringify(mine.body)).toContain(CYCLE.label.split(" ")[0]!);
  });

  it("10. PF, ESI and PT challan records: each entered by one director and confirmed only by a different one", async () => {
    for (const [kind, ref] of [["PF", "ZZTRRN1000001"], ["ESI", "ZZESI10000001"], ["PT", "ZZPT100000001"]] as const) {
      const e = await api(maker(), "post", "/tax/statutory-challans", { kind, month: MONTH, depositedOn: "2026-09-10", amount: "100.00", reference: ref });
      expect(e.status, `${kind} ${JSON.stringify(e.body)}`).toBe(201);
      challanIds.push(e.body.id);
      expect((await api(maker(), "post", `/tax/statutory-challans/${e.body.id}/confirm`, { amount: "100.00", reference: ref })).status).toBe(403);
      expect((await api(world.tokens.checkerA, "post", `/tax/statutory-challans/${e.body.id}/confirm`, { amount: "100.00", reference: ref })).status).toBe(200);
    }
    const reg = await api(maker(), "get", `/tax/statutory-challans?fy=${FY}&kind=PF`);
    expect(reg.body.challans.filter((c: { confirmed: boolean }) => c.confirmed).length).toBeGreaterThanOrEqual(1);
  });

  it("11. the Form 16 draft: refused before the year closes; after it, the employee downloads their own, marked DRAFT", async () => {
    expect((await api(tok.a!, "get", `/tax/me/form16/pdf?fy=${FY}`)).body.error.code).toBe("YEAR_NOT_CLOSED");
    setBusinessTodayForTests(new Date("2027-04-10T00:00:00Z"));
    try {
      const pdf = await request(app).get(`/api/tax/me/form16/pdf?fy=${FY}`).set(...authHeader(tok.a!)).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on("data", (d: Buffer) => c.push(d)); res.on("end", () => cb(null, Buffer.concat(c))); });
      expect(pdf.status).toBe(200);
      expect(pdf.headers["content-disposition"]).toContain("-DRAFT.pdf");
      expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");
    } finally {
      setBusinessTodayForTests(null);
    }
  });

  it("12. a parallel-run comparison against a statement generated from the run matches exactly; a wrong file is refused", async () => {
    expect((await request(app).post("/api/payroll-greythr/parallel").set(...authHeader(maker())).field("runId", runId).attach("file", readFileSync(path.join(SAMPLES, "Bank_Transfer_template.xls")), "b.xls")).body.error.code).toBe("WRONG_COLUMNS");
    const items = await prisma.payrollRunItem.findMany({ where: { runId, status: { in: ["PAYABLE", "HELD"] } }, include: { employee: { select: { employeeCode: true } }, lines: true } });
    const label = (l: { label: string; kind: string }) => (l.kind === "EMPLOYER_CONTRIBUTION" ? `${l.label} (employer)` : l.label);
    const heads = [...new Set(items.flatMap((i) => i.lines.filter((l) => l.kind !== "ROUNDING").map(label)))];
    const header = ["EmployeeNo", "Name", "DAYS IN MONTH", "EMP EFFECTIVE WORKDAYS", "LOP", ...heads, "GROSS", "TOTAL DEDUCTIONS", "NET PAY"];
    const rows: TestCell[][] = items.map((i) => {
      const by = new Map<string, number>();
      for (const l of i.lines.filter((x) => x.kind !== "ROUNDING")) by.set(label(l), (by.get(label(l)) ?? 0) + Number(l.amount.toString())); // allow-number: generated cells
      return [i.employee.employeeCode, "Rehearsal", 31, Number(i.paidDays.toString()), Number(i.lopDays.toString()), ...heads.map((h) => by.get(h) ?? 0), Number(i.gross.toString()), Number(i.deductions.toString()), Number(i.netPay.toString())]; // allow-number
    });
    const file = writeXls([{ name: "Report", rows: [[], ["TEST COMPANY (synthetic)"], [`Salary Statement - ${CYCLE.label}`], [], header, ...rows] }], { sst: true });
    const c = await request(app).post("/api/payroll-greythr/parallel").set(...authHeader(maker())).field("runId", runId).attach("file", file, "statement.xls");
    expect(c.status, JSON.stringify(c.body).slice(0, 300)).toBe(201);
    comparisonIds.push(c.body.id);
    expect(c.body.result.counts).toMatchObject({ peopleWithDifferences: 0, greythrOnly: 0, portalOnly: 0, differences: 0 });
  });
});
