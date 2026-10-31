import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { storageService } from "../../../integrations/storage";
import { decryptField } from "../../../lib/encryption";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupFullTestEmployee, createFullTestEmployee, loginAs } from "../../employee/__tests__/employeeTestHelpers";
import { REAL_RULES, approve, closeWorld, closingWorld, confirmAllPins, driveToFinal, requestStep, resetSeams, staffWith, type Closing } from "./closeTestHelpers";
import { calculateRun, setRules } from "./runTestHelpers";

// Stage 5b, B3: rows the bank rejected are entered by hand by a director with a reason (decision D-34: bank payments are manual, no file comes back),
// stay unpaid and visible to directors only, and are paid again in a repayment batch that needs the same approvals as a bank file. Nothing is paid twice.

const LAYOUT = {
  format: "DELIMITED",
  delimiter: ",",
  lineEnding: "LF",
  extension: "csv",
  dateFormat: "DD-MM-YYYY",
  amountDecimals: 2,
  header: [[{ source: "CONSTANT", value: "ZZHDR9917" }, { source: "PATTERN", value: "{DEBIT_ACCOUNT}" }, { source: "PATTERN", value: "{COUNT}" }, { source: "PATTERN", value: "{TOTAL}" }]],
  columns: [{ source: "FIELD", value: "SERIAL" }, { source: "FIELD", value: "NAME" }, { source: "FIELD", value: "ACCOUNT_NUMBER" }, { source: "FIELD", value: "IFSC" }, { source: "FIELD", value: "AMOUNT" }, { source: "FIELD", value: "NARRATION" }],
  narrationPattern: "Salary {PERIOD}",
};
describe("rejected bank rows and the repayment batch", () => {
  let world: Closing;
  let runId = "";
  let batchId = "";
  let dev: { employeeId: string; userId: string; employeeCode: string };
  let hr: { employeeId: string; userId: string; employeeCode: string };
  let tokens: { dev: string; hr: string; employee: string };
  const who = (n: string) => world.named[n]!.employeeId;
  const code = (n: string) => world.named[n]!.employeeCode;
  const maker = () => world.tokens.maker;
  const p = (token: string, path: string, body: object = {}) => request(app).post(`/api/payroll${path}`).set(...authHeader(token)).send(body);
  const g = (token: string, path: string) => request(app).get(`/api/payroll${path}`).set(...authHeader(token));
  const rowOf = (n: string) => prisma.bankTransferRow.findFirstOrThrow({ where: { batchId, employeeId: who(n) } });
  const putLayout = async (key: string, value: object, token = maker()) => {
    const pre = await p(token, `/layouts/${key}/save-preview`, { value });
    expect(pre.status, JSON.stringify(pre.body)).toBe(200);
    const r = await request(app).put(`/api/payroll/layouts/${key}`).set(...authHeader(token)).send({ value, fingerprint: pre.body.fingerprint });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  };
  const confirmLayout = async (key: string, token: string) => {
    const cp = await p(token, `/layouts/${key}/confirm-preview`);
    return p(token, `/layouts/${key}/confirm`, { version: cp.body.version, note: "checked against the bank's specification", fingerprint: cp.body.fingerprint });
  };

  beforeAll(async () => {
    world = await closingWorld(["a", "b", "c"]);
    await staffWith(world, ["a", "b", "c"]);
    await setRules(world.maker.userId, REAL_RULES);
    runId = await calculateRun(world);
    await confirmAllPins(world, runId);
    await driveToFinal(world, runId);
    await putLayout("BANK_TEMPLATE", { ...LAYOUT, debitAccountNumber: "000111222333444" });
    expect((await confirmLayout("BANK_TEMPLATE", world.tokens.checkerA)).status).toBe(200);
    await requestStep(maker(), runId, "bank-file");
    await approve(world, world.tokens.checkerB, runId, "bank-file");
    expect((await p(maker(), `/runs/${runId}/bank-file/generate`)).status).toBe(201);
    batchId = (await prisma.bankTransferBatch.findUniqueOrThrow({ where: { runId } })).id;
    dev = await createFullTestEmployee(world.org, { roleCode: DEVELOPER_ROLE_CODE });
    hr = await createFullTestEmployee(world.org, { roleCode: "HR_ADMIN" });
    world.userIds.push(dev.userId, hr.userId);
    tokens = { dev: await loginAs(dev.employeeCode), hr: await loginAs(hr.employeeCode), employee: await loginAs(code("a")) };
  }, 900_000);
  afterAll(async () => {
    resetSeams();
    vi.restoreAllMocks();
    for (const x of [hr, dev]) await cleanupFullTestEmployee(x.employeeId);
    await closeWorld(world);
  }, 300_000);

  it("directors only: HR, the Developer role and the employee are refused on every route, and see no rejection", async () => {
    for (const [name, token] of Object.entries(tokens)) {
      const routes: Array<[string, () => request.Test]> = [
        ["GET rejections", () => g(token, `/bank-batches/${batchId}/rejections`)],
        ["POST rejections", () => p(token, `/bank-batches/${batchId}/rejections`, { rows: [{ employeeCode: code("a"), reason: "Account closed" }] })],
        ["POST sent (batch)", () => p(token, `/bank-batches/${batchId}/sent`)],
        ["POST sent (repayment)", () => p(token, "/repayment-batches/x/sent")],
        ["POST plan", () => p(token, `/bank-batches/${batchId}/repayment-plans`, { paymentDate: "2026-09-10" })],
        ["GET plan", () => g(token, "/repayment-plans/x")],
        ["POST request", () => p(token, "/repayment-plans/x/request", { hash: "0123456789" })],
        ["POST decision", () => p(token, "/repayment-plans/x/decision", { decision: "APPROVE", hash: "0123456789" })],
        ["POST generate", () => p(token, "/repayment-plans/x/generate")],
        ["GET file", () => g(token, "/repayment-batches/x/file")],
      ];
      for (const [label, call] of routes) expect((await call()).status, `${name} ${label}`).toBe(403);
    }
    expect((await request(app).get(`/api/payroll/bank-batches/${batchId}/rejections`)).status).toBe(401);
  });

  it("a rejection is recorded by a director with a reason; an unknown person saves nothing; recording twice records once; the database holds it append-only and director-only", async () => {
    expect((await p(maker(), `/bank-batches/${batchId}/rejections`, { rows: [{ employeeCode: code("a"), reason: "x" }] })).status).toBe(400);
    const unknown = await p(maker(), `/bank-batches/${batchId}/rejections`, { rows: [{ employeeCode: code("a"), reason: "Account closed" }, { employeeCode: "NOT-IN-BATCH", reason: "Account closed" }] });
    expect([unknown.status, unknown.body.error.code]).toEqual([400, "VALIDATION_ERROR"]);
    expect(await prisma.bankRowRejection.count({ where: { batchId } })).toBe(0);
    const ok = await p(maker(), `/bank-batches/${batchId}/rejections`, { rows: [{ employeeCode: code("a"), reason: "Account closed" }] });
    expect([ok.status, ok.body]).toEqual([201, { recorded: 1, alreadyRecorded: 0 }]);
    expect((await p(maker(), `/bank-batches/${batchId}/rejections`, { rows: [{ employeeCode: code("a"), reason: "Account closed" }] })).body).toEqual({ recorded: 0, alreadyRecorded: 1 });
    const row = await prisma.bankRowRejection.findFirstOrThrow({ where: { batchId } });
    await expect(prisma.bankRowRejection.update({ where: { id: row.id }, data: { reason: "changed" } })).rejects.toThrow(/BANK_REJECTIONS_APPEND_ONLY/);
    await expect(prisma.bankRowRejection.delete({ where: { id: row.id } })).rejects.toThrow(/BANK_REJECTIONS_APPEND_ONLY/);
    await expect(prisma.bankRowRejection.create({ data: { batchId, rowId: (await rowOf("c")).id, reason: "sneaky", recordedByUserId: hr.userId } })).rejects.toThrow(/BANK_REJECTIONS_DIRECTORS_ONLY/);
    const list = await g(maker(), `/bank-batches/${batchId}/rejections`);
    expect(list.body.rows.map((r: { employeeCode: string }) => r.employeeCode)).toEqual([code("a")]);
    expect(list.body.rows[0]).toMatchObject({ accountLast4: expect.stringMatching(/^\d{4}$/), repaidInBatch: null });
  });

  it("there is no return file: no layout for one, no import route, no stored response file", async () => {
    expect((await p(maker(), "/layouts/BANK_RETURN_TEMPLATE/save-preview", { value: {} })).status).toBe(400);
    expect((await request(app).post(`/api/payroll/bank-batches/${batchId}/rejections/import`).set(...authHeader(maker())).attach("file", Buffer.from("x"), "return.csv")).status).toBe(404);
    expect((await request(app).post(`/api/payroll/bank-batches/${batchId}/response`).set(...authHeader(maker())).attach("file", Buffer.from("x"), "r.csv")).status).toBe(404);
    const layouts = await g(maker(), "/layouts");
    expect(JSON.stringify(layouts.body)).not.toMatch(/BANK_RETURN|return file/i);
  });

  it("a second payment is entered by hand, one row per payment, each with its own reason", async () => {
    const two = await p(maker(), `/bank-batches/${batchId}/rejections`, { rows: [{ employeeCode: code("b"), reason: "Invalid IFSC" }] });
    expect(two.body).toEqual({ recorded: 1, alreadyRecorded: 0 });
    const rej = await prisma.bankRowRejection.findMany({ where: { batchId }, orderBy: { createdAt: "asc" } });
    expect(rej.map((r) => r.reason)).toEqual(["Account closed", "Invalid IFSC"]);
    expect((await p(maker(), `/bank-batches/${batchId}/rejections`, { rows: [{ employeeCode: code("c"), reason: "" }] })).status).toBe(400);
    expect(await prisma.bankRowRejection.count({ where: { batchId } })).toBe(2);
  });

  let planId = "";
  let repaymentBatchId = "";
  it("a plan collects the rejected rows, uses each person's account in force on the new date, and leaves out what the bank did not reject", async () => {
    const rowIds = [(await rowOf("a")).id, (await rowOf("b")).id, (await rowOf("c")).id];
    expect((await p(maker(), `/bank-batches/${batchId}/repayment-plans`, { paymentDate: "2026-9-10" })).status).toBe(400);
    const plan = await p(maker(), `/bank-batches/${batchId}/repayment-plans`, { paymentDate: "2026-09-10", rowIds });
    expect(plan.status, JSON.stringify(plan.body)).toBe(201);
    planId = plan.body.id;
    expect(plan.body.rows.map((r: { employeeCode: string }) => r.employeeCode).sort()).toEqual([code("a"), code("b")].sort());
    expect(plan.body.excluded).toEqual([expect.objectContaining({ employeeCode: code("c"), reason: "The bank did not reject this row" })]);
    expect(plan.body.rows.every((r: { amount: string }) => /^\d+(\.\d+)?$/.test(r.amount))).toBe(true);
    for (const n of ["a", "b"]) expect(JSON.stringify(plan.body)).not.toContain(decryptField((await prisma.employeeBankAccount.findFirstOrThrow({ where: { employeeId: who(n) } })).accountNumberEncrypted)); // last four digits only; never an account number
    await expect(prisma.bankRepaymentPlan.delete({ where: { id: planId } })).rejects.toThrow(/BANK_REJECTIONS_APPEND_ONLY/);
  });

  it("it needs the same approvals as a bank file: not the person who asked, and not the person who approved, carries it out", async () => {
    const hash = (await g(maker(), `/repayment-plans/${planId}`)).body.hash;
    expect((await p(maker(), `/repayment-plans/${planId}/generate`)).body.error.code).toBe("APPROVAL_REQUIRED");
    expect((await p(maker(), `/repayment-plans/${planId}/request`, { hash: "not-the-hash-you-saw" })).body.error.code).toBe("PREVIEW_STALE");
    expect((await p(maker(), `/repayment-plans/${planId}/request`, { hash })).status).toBe(201);
    expect((await p(maker(), `/repayment-plans/${planId}/generate`)).body.error.code).toBe("APPROVAL_REQUIRED"); // asked, not decided
    const own = await p(maker(), `/repayment-plans/${planId}/decision`, { decision: "APPROVE", hash });
    expect([own.status, own.body.error.code]).toEqual([403, "CHECKER_IS_MAKER"]);
    expect((await p(world.tokens.checkerB, `/repayment-plans/${planId}/decision`, { decision: "APPROVE", hash })).status).toBe(200);
    const byChecker = await p(world.tokens.checkerB, `/repayment-plans/${planId}/generate`);
    expect([byChecker.status, byChecker.body.error.code]).toEqual([403, "CHECKER_IS_EXECUTOR"]);
    const done = await p(maker(), `/repayment-plans/${planId}/generate`);
    expect([done.status, done.body.rows], JSON.stringify(done.body)).toEqual([201, 2]);
    repaymentBatchId = done.body.batchId;
    const batch = await prisma.bankRepaymentBatch.findUniqueOrThrow({ where: { id: repaymentBatchId }, include: { rows: true } });
    expect(batch.rows.map((r) => r.sourceRowId).sort()).toEqual([(await rowOf("a")).id, (await rowOf("b")).id].sort());
    const file = (await storageService.getObject(batch.fileKey)).body.toString("utf8").trimEnd().split("\n");
    expect(file).toHaveLength(3); // the header and two rows
    expect(file[0]).toMatch(/^ZZHDR9917,000111222333444,2,/);
    const a = await rowOf("a");
    expect(file.some((l) => l.includes(a.amount.toString().replace(/\.0+$/, "")))).toBe(true);
    // The original batch is untouched, and the download is audited and directors only.
    expect((await prisma.bankTransferBatch.findUniqueOrThrow({ where: { id: batchId } })).rowCount).toBe(3);
    expect((await g(maker(), `/repayment-batches/${repaymentBatchId}/file`)).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "payroll.bank.repayment_downloaded", entityId: repaymentBatchId } })).toBe(1);
    expect((await g(tokens.hr, `/repayment-batches/${repaymentBatchId}/file`)).status).toBe(403);
  });

  it("nothing is paid twice: not by a second file for the plan, not by a second plan, not by the database either", async () => {
    expect([(await p(maker(), `/repayment-plans/${planId}/generate`)).body.error.code]).toEqual(["APPROVAL_REQUIRED"]); // the approval was used up
    const none = await p(maker(), `/bank-batches/${batchId}/repayment-plans`, { paymentDate: "2026-09-11" });
    expect([none.status, none.body.error.code]).toEqual([409, "NOTHING_TO_REPAY"]);
    const again = await p(maker(), `/bank-batches/${batchId}/repayment-plans`, { paymentDate: "2026-09-11", rowIds: [(await rowOf("a")).id] });
    expect(again.body.rows).toEqual([]);
    expect(again.body.excluded).toEqual([expect.objectContaining({ reason: "Already paid again in a repayment batch" })]);
    const hash = (await g(maker(), `/repayment-plans/${again.body.id}`)).body.hash;
    expect((await p(maker(), `/repayment-plans/${again.body.id}/request`, { hash })).body.error.code).toBe("NOTHING_TO_REPAY");
    // The database itself: a rejected row is in one repayment batch at most, and only a rejected row is in any.
    const a = await rowOf("a");
    await expect(prisma.bankRepaymentRow.create({ data: { batchId: repaymentBatchId, sourceRowId: a.id, employeeId: a.employeeId, bankAccountId: a.bankAccountId, accountHash: a.accountHash, accountLast4: a.accountLast4, ifsc: a.ifsc, amount: a.amount, narration: "again", serial: 9 } })).rejects.toThrow(/source_row_id|Unique/);
    const c = await rowOf("c");
    await expect(prisma.bankRepaymentRow.create({ data: { batchId: repaymentBatchId, sourceRowId: c.id, employeeId: c.employeeId, bankAccountId: c.bankAccountId, accountHash: c.accountHash, accountLast4: c.accountLast4, ifsc: c.ifsc, amount: c.amount, narration: "not rejected", serial: 8 } })).rejects.toThrow(/REPAYMENT_NOT_REJECTED/);
    await expect(prisma.bankRepaymentRow.update({ where: { id: (await prisma.bankRepaymentRow.findFirstOrThrow({ where: { batchId: repaymentBatchId } })).id }, data: { amount: "1" } })).rejects.toThrow(/BANK_REJECTIONS_APPEND_ONLY/);
    expect(await prisma.bankRepaymentRow.count({ where: { sourceRow: { batchId } } })).toBe(2);
  });

  it("a bank account changed after the approval voids it, and the row stays unpaid", async () => {
    await p(maker(), `/bank-batches/${batchId}/rejections`, { rows: [{ employeeCode: code("c"), reason: "Beneficiary name mismatch" }] });
    const plan = await p(maker(), `/bank-batches/${batchId}/repayment-plans`, { paymentDate: "2026-09-12" });
    expect(plan.status, JSON.stringify(plan.body)).toBe(201);
    expect(plan.body.rows).toHaveLength(1);
    const hash = plan.body.hash;
    await p(maker(), `/repayment-plans/${plan.body.id}/request`, { hash });
    await p(world.tokens.checkerB, `/repayment-plans/${plan.body.id}/decision`, { decision: "APPROVE", hash });
    const acct = await prisma.employeeBankAccount.findFirstOrThrow({ where: { employeeId: who("c") } });
    await prisma.employeeBankAccount.update({ where: { id: acct.id }, data: { accountNumberHash: "tampered" } });
    try {
      const r = await p(maker(), `/repayment-plans/${plan.body.id}/generate`);
      expect([r.status, r.body.error.code]).toEqual([409, "APPROVAL_VOIDED"]);
    } finally {
      await prisma.employeeBankAccount.update({ where: { id: acct.id }, data: { accountNumberHash: acct.accountNumberHash } });
    }
    expect(await prisma.bankRepaymentBatch.count({ where: { planId: plan.body.id } })).toBe(0);
    expect((await g(maker(), `/bank-batches/${batchId}/rejections`)).body.rows.find((r: { employeeCode: string }) => r.employeeCode === code("c")).repaidInBatch).toBeNull();
  });
  it("a downloaded bank file can be marked sent to the bank, once, by a director: who and when, and the database never lets it change", async () => {
    const early = await p(maker(), `/bank-batches/${batchId}/sent`);
    expect([early.status, early.body.error.code]).toEqual([409, "NOT_DOWNLOADED"]);
    expect((await g(maker(), `/bank-batches/${batchId}/file`)).status).toBe(200);
    const ok = await p(maker(), `/bank-batches/${batchId}/sent`, { note: "uploaded to the bank's portal" });
    expect([ok.status, ok.body.sentByUserId], JSON.stringify(ok.body)).toEqual([201, world.maker.userId]);
    expect(ok.body.sentAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const twice = await p(maker(), `/bank-batches/${batchId}/sent`);
    expect([twice.status, twice.body.error.code]).toEqual([409, "ALREADY_SENT"]);
    expect((await g(maker(), `/bank-batches/${batchId}`)).body.sentToBank).toMatchObject({ byUserId: world.maker.userId, note: "uploaded to the bank's portal" });
    const mark = await prisma.bankFileSentMark.findFirstOrThrow({ where: { batchId } });
    await expect(prisma.bankFileSentMark.update({ where: { id: mark.id }, data: { note: "changed" } })).rejects.toThrow(/BANK_REJECTIONS_APPEND_ONLY/);
    await expect(prisma.bankFileSentMark.delete({ where: { id: mark.id } })).rejects.toThrow(/BANK_REJECTIONS_APPEND_ONLY/);
    await expect(prisma.bankFileSentMark.create({ data: { repaymentBatchId, sentByUserId: hr.userId } })).rejects.toThrow(/BANK_REJECTIONS_DIRECTORS_ONLY/);
    await expect(prisma.bankFileSentMark.create({ data: { sentByUserId: world.maker.userId } })).rejects.toThrow(/bank_file_sent_marks_one_file/);
    // The same for a repayment file.
    expect((await p(maker(), `/repayment-batches/${repaymentBatchId}/sent`)).status).toBe(201);
    expect(await prisma.auditLog.count({ where: { action: "payroll.bank.marked_sent", entityId: { in: [batchId, repaymentBatchId] } } })).toBe(2);
  });
});
