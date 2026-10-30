import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { rupeesInWords } from "@shared/utils/inWords";
import { mailService } from "../../../integrations/mail";
import { fakeReceipt } from "../../../integrations/mail/testing";
import { storageService } from "../../../integrations/storage";
import { decryptField, encryptField } from "../../../lib/encryption";
import { unseal } from "../sealed";
import { SYSTEM_ROLES } from "../../../lib/systemRoles";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { cleanupTestRole, grantPermissions } from "../../employee/__tests__/employeeTestHelpers";
import { encryptStatutoryFields } from "../../employee/service";
import { crawlGets } from "./sensitiveCrawl";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, createFullTestEmployee, cleanupFullTestEmployee, loginAs } from "../../employee/__tests__/employeeTestHelpers";
import { markPaid } from "../run/bankBatches";
import { deliverPayslips } from "../run/payslipDelivery";
import { REAL_RULES, approve, closeWorld, closingWorld, confirmAllPins, driveToFinal, requestStep, resetSeams, staffWith, step, stepOf, type Closing } from "./closeTestHelpers";
import { CYCLE, api, calculateRun, day, setRules } from "./runTestHelpers";

// What a final run releases: payslips, the bank file, the statutory files and the register (docs/plans/PHASE_6.md §14H), through the real API and the real database.
// One world, carried through in order: each test starts from what the one before left.

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
const DEBIT = "000111222333444";

describe("payslips, the bank file and the statutory files from a final run", () => {
  let world: Closing;
  let runId: string;
  let aToken: string;
  let hrExecToken: string;
  let hrExec: { employeeId: string; userId: string; employeeCode: string };
  const who = (n: string) => world.named[n]!.employeeId;
  const slipOf = (n: string) => prisma.payslip.findFirstOrThrow({ where: { runId, employeeId: who(n) } });
  const put = (token: string, path: string, body?: object) => request(app).put(`/api/payroll${path}`).set(...authHeader(token)).send(body);

  beforeAll(async () => {
    world = await closingWorld(["a", "b", "c"]);
    await staffWith(world, ["a", "b", "c"]);
    await setRules(world.maker.userId, REAL_RULES);
    runId = await calculateRun(world);
    await confirmAllPins(world, runId);
    await driveToFinal(world, runId);
    aToken = await loginAs(world.named.a!.employeeCode);
    hrExec = await createFullTestEmployee(world.org, { roleCode: "HR_EXECUTIVE" });
    world.userIds.push(hrExec.userId);
    hrExecToken = await loginAs(hrExec.employeeCode);
  }, 600_000);
  afterAll(async () => {
    resetSeams();
    vi.restoreAllMocks();
    await cleanupFullTestEmployee(hrExec.employeeId);
    await closeWorld(world);
  });

  // ── The proof of the lock, with the most powerful token there is ──
  it("a job change dated inside the finalised month is refused with PAYROLL_LOCKED even for a Super Admin", async () => {
    const r = await request(app).patch(`/api/employees/${who("a")}/job`).set(...authHeader(world.supToken)).send({ departmentId: world.org.departmentId, effectiveFrom: "2026-08-20", changeReason: "should be refused" });
    expect([r.status, r.body.error?.code]).toEqual([409, "PAYROLL_LOCKED"]);
  });

  // ── Payslips ──
  it("previews what publishing does: who gets a payslip, and nothing is created by looking", async () => {
    const p = await step(world.tokens.maker, runId, "publish", "preview");
    expect(p.body).toMatchObject({ canRequest: true, blockers: [], payslips: 3, noPayslip: [] });
    expect(await prisma.payslip.count({ where: { runId } })).toBe(0);
  });

  it("is carried out only after a second person approved it, and never by the person who approved", async () => {
    expect((await api(world.tokens.maker, "post", `/runs/${runId}/payslips/publish`)).body.error.code).toBe("APPROVAL_REQUIRED");
    await requestStep(world.tokens.maker, runId, "publish");
    expect((await api(world.tokens.maker, "post", `/runs/${runId}/payslips/publish`)).body.error.code).toBe("APPROVAL_REQUIRED"); // asked, not yet decided
    await approve(world, world.supToken, runId, "publish"); // a Super Admin holds every permission, so the only thing that can stop them carrying it out is having decided it
    const byChecker = await api(world.supToken, "post", `/runs/${runId}/payslips/publish`);
    expect([byChecker.status, byChecker.body.error.code]).toEqual([403, "CHECKER_IS_EXECUTOR"]);
    expect((await api(world.tokens.outsider, "post", `/runs/${runId}/payslips/publish`)).status).toBe(403); // somebody who holds no payroll permission
    expect((await api(aToken, "post", `/runs/${runId}/payslips/publish`)).status).toBe(403);
    expect(await prisma.payslip.count({ where: { runId } })).toBe(0);
  });

  it("publishes one immutable payslip per payable person, with the release row in the same commit", async () => {
    const done = await api(world.tokens.maker, "post", `/runs/${runId}/payslips/publish`);
    expect([done.status, done.body.published]).toEqual([201, 3]);
    const slips = await prisma.payslip.findMany({ where: { runId } });
    expect(slips).toHaveLength(3);
    expect(await prisma.payrollRunRelease.count({ where: { runId, kind: "PAYSLIPS_PUBLISHED" } })).toBe(1);
    expect((await prisma.payrollApproval.findFirstOrThrow({ where: { subject: "PAYSLIP_PUBLISH", subjectId: runId } })).status).toBe("CONSUMED");
    // The content is the run's own figures, to the paisa.
    for (const n of ["a", "b", "c"]) {
      const slip = await slipOf(n);
      const item = await prisma.payrollRunItem.findFirstOrThrow({ where: { runId, employeeId: who(n) }, include: { lines: true } });
      const c = slip.content as { totals: { gross: string; deductions: string; net: string }; earnings: Array<{ amount: string }>; deductions: Array<{ amount: string }>; netInWords: string; employee: { code: string; name: string }; bank: { accountLast4: string } | null; statutory: { panLast4: string | null }; days: { paid: string } };
      expect(c.totals.net).toBe(item.netPay.toFixed(2));
      expect(c.totals.gross).toBe(item.gross.toFixed(2));
      expect(c.totals.deductions).toBe(item.deductions.toFixed(2));
      expect(c.earnings.reduce((a, l) => a + Math.round(Number(l.amount) * 100), 0)).toBe(Math.round(Number(c.totals.gross) * 100));
      expect(c.netInWords).toBe(rupeesInWords(c.totals.net));
      expect(c.employee.code).toBe(world.named[n]!.employeeCode);
      const acct = await prisma.employeeBankAccount.findFirstOrThrow({ where: { employeeId: who(n) } });
      expect(c.bank?.accountLast4).toBe(acct.accountNumberLast4);
      expect(JSON.stringify(slip.content)).not.toContain(decryptField(acct.accountNumberEncrypted)); // only the last four ever appear
    }
  });

  it("cannot be published twice, and the database itself refuses a second set, a change and a removal", async () => {
    expect((await api(world.tokens.maker, "post", `/runs/${runId}/payslips/publish`)).body.error.code).toBe("ALREADY_RELEASED");
    const slip = await slipOf("a");
    await expect(prisma.payslip.update({ where: { id: slip.id }, data: { content: {} } })).rejects.toThrow(/PAYSLIP_APPEND_ONLY/);
    await expect(prisma.payslip.delete({ where: { id: slip.id } })).rejects.toThrow(/PAYSLIP_APPEND_ONLY/);
    const item = await prisma.payrollRunItem.findFirstOrThrow({ where: { runId, employeeId: who("a") } });
    await expect(prisma.payslip.create({ data: { runId, runItemId: item.id, employeeId: who("a"), cycleLabel: "x", cycleStart: day(CYCLE.start), cycleEnd: day(CYCLE.end), content: {}, contentHash: "x", publishedByUserId: world.maker.userId } })).rejects.toThrow(/PAYSLIPS_ALREADY_PUBLISHED|Unique constraint/);
  });

  it("the period can no longer be unlocked once payslips are out", async () => {
    const p = await step(world.supToken, runId, "unlock", "preview");
    expect(p.body.canRequest).toBe(false);
    expect(p.body.blockers[0]).toMatchObject({ code: "RUN_RELEASED" });
  });

  it("an employee reads their own payslip and nobody else's; a stranger's id is a 404 exactly like one that does not exist", async () => {
    const mine = await request(app).get("/api/payslips/mine").set(...authHeader(aToken));
    expect(mine.status).toBe(200);
    expect(mine.body.payslips).toHaveLength(1);
    const a = await slipOf("a");
    const b = await slipOf("b");
    const own = await request(app).get(`/api/payslips/mine/${a.id}`).set(...authHeader(aToken));
    expect([own.status, own.body.content.employee.code]).toEqual([200, world.named.a!.employeeCode]);
    const other = await request(app).get(`/api/payslips/mine/${b.id}`).set(...authHeader(aToken));
    const ghost = await request(app).get("/api/payslips/mine/does-not-exist").set(...authHeader(aToken));
    expect([other.status, ghost.status]).toEqual([404, 404]);
    expect(other.body.error.code).toBe(ghost.body.error.code);
    expect((await request(app).get(`/api/payslips/mine/${b.id}/pdf`).set(...authHeader(aToken))).status).toBe(404);
    expect((await request(app).get("/api/payslips/mine")).status).toBe(401);
  });

  it("HR with payroll.payslip.view reads any payslip; HR executives and managers read none", async () => {
    const a = await slipOf("a");
    expect((await api(world.tokens.checkerA, "get", `/payslips/${a.id}`)).status).toBe(200);
    expect((await api(world.tokens.maker, "get", `/runs/${runId}/payslips`)).body.payslips).toHaveLength(3);
    for (const token of [hrExecToken, aToken]) {
      expect((await api(token, "get", `/payslips/${a.id}`)).status).toBe(403);
      expect((await api(token, "get", `/payslips/${a.id}/pdf`)).status).toBe(403);
      expect((await api(token, "get", `/runs/${runId}/payslips`)).status).toBe(403);
    }
  });

  it("'Why?' explains each line of a payslip with the rules behind it: value, source note, applies-from date and confirmer; only the owner or HR with payslip view reads it", async () => {
    const a = await slipOf("a");
    const b = await slipOf("b");
    const own = await request(app).get(`/api/payslips/mine/${a.id}/why`).set(...authHeader(aToken));
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    expect(own.body.payslipId).toBe(a.id);
    const lines = own.body.lines as Array<{ code: string; source: string; explanation: string[]; rules: Array<{ key: string; status: string; sourceNote: string | null; effectiveFrom: string | null; confirmedBy: string | null; level: string; overridden: boolean; value: unknown }> }>;
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l.explanation.length, l.code).toBeGreaterThan(0);
    // Every salary line names the rounding rule it was worked out under, with where that number came from and who vouched for it.
    const component = lines.find((l) => l.source === "COMPONENT")!;
    const rounding = component.rules.find((r) => r.key === "LINE_ROUNDING")!;
    expect(rounding).toMatchObject({ status: "CONFIRMED", level: "COMPANY", overridden: false });
    expect(rounding.sourceNote).toMatch(/\S/);
    expect(rounding.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(rounding.confirmedBy).toMatch(/\S/);
    expect(component.rules.some((r) => r.key === "PAY_DAYS_BASIS")).toBe(true);
    // A statutory line shows its rates and ceiling, each with a source note.
    const pf = lines.find((l) => l.code === "PF_EMPLOYEE");
    if (pf) {
      expect(pf.rules.map((r) => r.key)).toEqual(expect.arrayContaining(["PF_EMPLOYEE_RATE", "PF_WAGE_CEILING"]));
      for (const r of pf.rules) expect(r.sourceNote, r.key).toMatch(/\S/);
    }
    // Somebody else's slip is a 404 exactly like one that does not exist.
    expect((await request(app).get(`/api/payslips/mine/${b.id}/why`).set(...authHeader(aToken))).status).toBe(404);
    expect((await request(app).get("/api/payslips/mine/does-not-exist/why").set(...authHeader(aToken))).status).toBe(404);
    expect((await request(app).get(`/api/payslips/mine/${a.id}/why`)).status).toBe(401);
    // HR with payslip view reads any; an HR executive and an employee read none through the HR route.
    expect((await api(world.tokens.checkerA, "get", `/payslips/${b.id}/why`)).status).toBe(200);
    for (const token of [hrExecToken, aToken]) expect((await api(token, "get", `/payslips/${a.id}/why`)).status).toBe(403);
    expect((await api(world.tokens.checkerA, "get", "/payslips/does-not-exist/why")).status).toBe(404);
  });

  it("the PDF says it is being prepared until the worker has made it", async () => {
    const a = await slipOf("a");
    const r = await request(app).get(`/api/payslips/mine/${a.id}/pdf`).set(...authHeader(aToken));
    expect([r.status, r.body.ready]).toEqual([200, false]);
  });

  it("delivery: renders each PDF, stores it, notifies, and records what the email really did; doing it again does nothing twice", async () => {
    const send = vi.spyOn(mailService, "send").mockImplementation(async (m) => ({ ...fakeReceipt(m.to), driver: "smtp" }));
    const first = await deliverPayslips(runId);
    expect(first).toMatchObject({ total: 3, rendered: 3, renderFailed: 0, notified: 3, emailSent: 3, emailFailed: 0 });
    expect(send).toHaveBeenCalledTimes(3);
    const nets = (await prisma.payslip.findMany({ where: { runId } })).map((p) => (p.content as { totals: { net: string } }).totals.net);
    for (const call of send.mock.calls) {
      expect(call[0].html).not.toContain("₹"); // no figure in the email
      for (const net of nets) expect(call[0].html).not.toContain(net);
    }
    const a = await slipOf("a");
    const delivery = await prisma.payslipDelivery.findUniqueOrThrow({ where: { payslipId: a.id } });
    expect([delivery.emailStatus, delivery.notifiedAt !== null]).toEqual(["SENT", true]);
    const stored = await storageService.getObject(delivery.fileKey!);
    expect(stored.body.subarray(0, 4).toString()).toBe("%PDF");
    expect(await prisma.notification.count({ where: { type: "payslip.published", userId: world.named.a!.userId } })).toBe(1);
    const again = await deliverPayslips(runId);
    expect(again).toMatchObject({ total: 3, rendered: 0, notified: 0, emailSent: 0, emailFailed: 0 });
    expect(send).toHaveBeenCalledTimes(3);
    const link = await request(app).get(`/api/payslips/mine/${a.id}/pdf`).set(...authHeader(aToken));
    expect([link.status, link.body.ready, typeof link.body.url]).toEqual([200, true, "string"]);
    expect((await api(world.tokens.maker, "get", `/runs/${runId}/payslips`)).body.payslips.map((p: { delivery: { emailStatus: string } }) => p.delivery.emailStatus)).toEqual(["SENT", "SENT", "SENT"]);
  }, 300_000);

  it("a failed email is recorded as failed, with the reason, and sent on the next try; it is never counted as sent", async () => {
    const b = await slipOf("b");
    await prisma.payslipDelivery.update({ where: { payslipId: b.id }, data: { emailStatus: null, emailTo: null, emailAttemptedAt: null } });
    const send = vi.spyOn(mailService, "send").mockRejectedValueOnce(Object.assign(new Error("Invalid login"), { code: "EAUTH" }));
    const failed = await deliverPayslips(runId);
    expect(failed).toMatchObject({ emailFailed: 1, emailSent: 0 });
    const row = await prisma.payslipDelivery.findUniqueOrThrow({ where: { payslipId: b.id } });
    expect([row.emailStatus, row.emailError]).toEqual(["FAILED", expect.stringMatching(/refused the sign-in/)]);
    send.mockImplementation(async (m) => ({ ...fakeReceipt(m.to), driver: "smtp" }));
    expect(await deliverPayslips(runId)).toMatchObject({ emailSent: 1, emailFailed: 0 });
    expect((await prisma.payslipDelivery.findUniqueOrThrow({ where: { payslipId: b.id } })).emailStatus).toBe("SENT");
  }, 300_000);

  // ── The bank file ──
  it("cannot be asked for until its layout is entered and confirmed by a second person", async () => {
    const p = await step(world.tokens.maker, runId, "bank-file", "preview");
    expect(p.body.canRequest).toBe(false);
    expect(p.body.blockers.map((b: { code: string }) => b.code)).toEqual(["BANK_TEMPLATE_PLACEHOLDER"]);
    expect(p.body.blockers[0].message).toMatch(/has not been entered/);
    expect((await api(world.tokens.maker, "post", `/runs/${runId}/bank-file/generate`)).body.error.code).toBe("APPROVAL_REQUIRED");
  });

  it("the layout is saved by one person and confirmed by another; the debit account is encrypted and never shown", async () => {
    const pre = await api(world.tokens.maker, "post", "/layouts/BANK_TEMPLATE/save-preview", { value: { ...LAYOUT, debitAccountNumber: DEBIT } });
    expect(pre.status).toBe(200);
    expect(JSON.stringify(pre.body)).not.toContain(DEBIT);
    expect(pre.body.after.value).toMatchObject({ hasDebitAccount: true, debitAccountLast4: "3444" });
    expect((await api(world.tokens.outsider, "post", "/layouts/BANK_TEMPLATE/save-preview", { value: LAYOUT })).status).toBe(403); // somebody without the layout permission does not write layouts
    const saved = await put(world.tokens.maker, "/layouts/BANK_TEMPLATE", { value: { ...LAYOUT, debitAccountNumber: DEBIT }, fingerprint: pre.body.fingerprint, note: "from the test bank's specification" });
    expect(saved.status).toBe(200);
    expect(saved.body.status).toBe("PLACEHOLDER");
    // Stored encrypted; the plaintext appears nowhere a person can read.
    const version = await prisma.payrollItemVersion.findFirstOrThrow({ where: { kind: "BANK_TEMPLATE", key: "BANK_TEMPLATE" }, orderBy: { version: "desc" } });
    // The whole version is sealed: nothing readable, not even the layout's columns.
    expect(Object.keys(version.value as object)).toEqual(["sealed"]);
    expect(JSON.stringify(version.value)).not.toContain(DEBIT);
    expect(JSON.stringify(version.value)).not.toContain("ZZHDR9917");
    const stored = unseal<{ debitAccountEnc: string; debitAccountLast4: string }>(version.value as { sealed: string });
    expect(decryptField(Buffer.from(stored.debitAccountEnc, "base64"))).toBe(DEBIT);
    const audit = await prisma.auditLog.findMany({ where: { action: "payroll.layout.edited", entityId: "BANK_TEMPLATE" } });
    expect(JSON.stringify(audit)).not.toContain(DEBIT);
    expect(JSON.stringify(audit)).not.toContain(stored.debitAccountEnc);
    expect(JSON.stringify(audit)).not.toContain("ZZHDR9917");
    const read = await api(world.tokens.maker, "get", "/layouts/BANK_TEMPLATE"); // the person who enters the layout may see it, and that is recorded
    expect(JSON.stringify(read.body)).not.toContain(stored.debitAccountEnc);
    expect(read.body.layout.current.value).toMatchObject({ hasDebitAccount: true, debitAccountLast4: "3444", columns: expect.any(Array) });
    expect(await prisma.auditLog.count({ where: { action: "payroll.layout.revealed", entityId: "BANK_TEMPLATE", actorUserId: world.maker.userId } })).toBeGreaterThan(0);
    // Somebody without the bank-layout permissions (a payroll approver who is not given it here is the checker, who may; an HR executive may not) sees that it exists and its status, nothing of it.
    const blind = await api(hrExecToken, "get", "/layouts/BANK_TEMPLATE");
    expect(blind.status).toBe(403); // payroll.rules.view is not held by an HR executive at all
    expect(await prisma.auditLog.count({ where: { action: "payroll.layout.revealed", actorUserId: hrExec.userId } })).toBe(0);
    // Saving the same thing again is "no change", even though a fresh encryption would differ.
    const again = await api(world.tokens.maker, "post", "/layouts/BANK_TEMPLATE/save-preview", { value: { ...LAYOUT, debitAccountNumber: DEBIT } });
    expect(again.body.unchanged).toBe(true);
    // Confirming: not by its author, by a different person.
    const cp = await api(world.tokens.maker, "post", "/layouts/BANK_TEMPLATE/confirm-preview");
    expect([cp.status, /You wrote this value/.test(String(cp.body.blocked))]).toEqual([200, true]); // D1: a director holds both permissions; the preview says why they cannot confirm their own
    const cpB = await api(world.tokens.checkerA, "post", "/layouts/BANK_TEMPLATE/confirm-preview");
    expect(cpB.status).toBe(200);
    const done = await api(world.tokens.checkerA, "post", "/layouts/BANK_TEMPLATE/confirm", { version: cpB.body.version, note: "matches the sheet the bank gave", fingerprint: cpB.body.fingerprint });
    expect([done.status, done.body.status]).toEqual([200, "CONFIRMED"]);
  });

  it("previews exactly who is in the file, and lists by name anyone payable who has no account on the payment date", async () => {
    // c's account stops before the payment date (31 Aug): c is payable, but cannot be in the file, and must be said so.
    const acct = await prisma.employeeBankAccount.findFirstOrThrow({ where: { employeeId: who("c") } });
    await prisma.employeeBankAccount.update({ where: { id: acct.id }, data: { effectiveTo: day("2026-08-15") } });
    try {
      const p = await step(world.tokens.maker, runId, "bank-file", "preview");
      expect(p.body).toMatchObject({ canRequest: true, blockers: [], rows: 2, paymentDate: "2026-08-31" });
      expect(p.body.excluded).toEqual([expect.objectContaining({ employeeCode: world.named.c!.employeeCode, reason: "NO_ACCOUNT" })]);
      expect(p.body.people.every((r: { accountLast4: string }) => /^\d{4}$/.test(r.accountLast4))).toBe(true);
      for (const n of ["a", "b"]) expect(JSON.stringify(p.body)).not.toContain(decryptField((await prisma.employeeBankAccount.findFirstOrThrow({ where: { employeeId: who(n) } })).accountNumberEncrypted)); // no account number anywhere in the preview
    } finally {
      await prisma.employeeBankAccount.update({ where: { id: acct.id }, data: { effectiveTo: null } });
    }
  });

  it("an approval is bound to the accounts: if one changes after the approval, generating is refused and the approval is void", async () => {
    await requestStep(world.tokens.maker, runId, "bank-file");
    await approve(world, world.tokens.checkerB, runId, "bank-file");
    const acct = await prisma.employeeBankAccount.findFirstOrThrow({ where: { employeeId: who("b") } });
    await prisma.employeeBankAccount.update({ where: { id: acct.id }, data: { accountNumberHash: "tampered" } });
    try {
      const r = await api(world.tokens.maker, "post", `/runs/${runId}/bank-file/generate`);
      expect([r.status, r.body.error.code]).toEqual([409, "APPROVAL_VOIDED"]);
    } finally {
      await prisma.employeeBankAccount.update({ where: { id: acct.id }, data: { accountNumberHash: acct.accountNumberHash } });
    }
    expect(await prisma.bankTransferBatch.count({ where: { runId } })).toBe(0);
    expect((await prisma.payrollApproval.findFirstOrThrow({ where: { subject: "BANK_FILE", subjectId: runId }, orderBy: { submittedAt: "desc" } })).status).toBe("VOIDED");
  });

  it("an approval is bound to the layout too: a layout edited after the approval voids it, and the new one has to be confirmed again", async () => {
    await requestStep(world.tokens.maker, runId, "bank-file");
    await approve(world, world.tokens.checkerB, runId, "bank-file");
    const pre = await api(world.tokens.maker, "post", "/layouts/BANK_TEMPLATE/save-preview", { value: { ...LAYOUT, quote: false } });
    expect((await put(world.tokens.maker, "/layouts/BANK_TEMPLATE", { value: { ...LAYOUT, quote: false }, fingerprint: pre.body.fingerprint })).status).toBe(200);
    const r = await api(world.tokens.maker, "post", `/runs/${runId}/bank-file/generate`);
    expect([r.status, r.body.error.code]).toEqual([409, "APPROVAL_VOIDED"]);
    expect((await step(world.tokens.maker, runId, "bank-file", "preview")).body.blockers.map((b: { code: string }) => b.code)).toEqual(["BANK_TEMPLATE_PLACEHOLDER"]); // the edited layout is a Placeholder again
    const cp = await api(world.tokens.checkerA, "post", "/layouts/BANK_TEMPLATE/confirm-preview");
    expect((await api(world.tokens.checkerA, "post", "/layouts/BANK_TEMPLATE/confirm", { version: cp.body.version, note: "the edit only stops quoting", fingerprint: cp.body.fingerprint })).status).toBe(200);
  });

  it("generates the file, and the batch, the audit rows and the release are all written together; the checker cannot carry it out", async () => {
    await requestStep(world.tokens.maker, runId, "bank-file");
    // Stage 0.3: the person who asked for the file cannot approve it themselves.
    const own = await step(world.tokens.maker, runId, "bank-file", "decision", { decision: "APPROVE", hash: (await stepOf(world.tokens.maker, runId, "bank-file")).live!.hash });
    expect([own.status, own.body.error.code]).toEqual([403, "CHECKER_IS_MAKER"]);
    await approve(world, world.supToken, runId, "bank-file");
    expect((await api(world.supToken, "post", `/runs/${runId}/bank-file/generate`)).body.error.code).toBe("CHECKER_IS_EXECUTOR");
    const done = await api(world.tokens.maker, "post", `/runs/${runId}/bank-file/generate`);
    expect([done.status, done.body.rows, done.body.excluded]).toEqual([201, 3, 0]);
    const batch = await prisma.bankTransferBatch.findUniqueOrThrow({ where: { runId }, include: { rows: { orderBy: { serial: "asc" } } } });
    expect([batch.status, batch.rowCount, batch.rows.length]).toEqual(["GENERATED", 3, 3]);
    expect(await prisma.payrollRunRelease.count({ where: { runId, kind: "BANK_FILE_GENERATED" } })).toBe(1);
    // The file: the real account numbers, in the layout, with its header and the debit account.
    const file = (await storageService.getObject(batch.fileKey)).body.toString("utf8").trimEnd().split("\n");
    const net = batch.rows.reduce((a, r) => a + Math.round(Number(r.amount) * 100), 0);
    expect(file[0]).toBe(`ZZHDR9917,${DEBIT},3,${(net / 100).toFixed(2)}`);
    expect(file).toHaveLength(4);
    for (const r of batch.rows) {
      const acct = await prisma.employeeBankAccount.findFirstOrThrow({ where: { employeeId: r.employeeId } });
      expect(file[r.serial]).toBe(`${r.serial},Test Employee ${(await prisma.employeeNameHistory.findFirstOrThrow({ where: { employeeId: r.employeeId } })).fullName.split(" ").at(-1)},${decryptField(acct.accountNumberEncrypted)},${acct.ifsc},${Number(r.amount).toFixed(2)},Salary ${CYCLE.label}`);
      expect(r.accountLast4).toBe(acct.accountNumberLast4);
    }
    expect(Object.keys(batch.rows[0]!).sort()).toEqual(["accountHash", "accountLast4", "amount", "bankAccountId", "batchId", "employeeId", "id", "ifsc", "narration", "serial"]); // no account number column exists
    // One audit row for each person whose account was read, and the number is in none of them.
    const reads = await prisma.auditLog.findMany({ where: { action: "payroll.bank.account_read", entityId: { in: batch.rows.map((r) => r.employeeId) } } });
    expect(reads).toHaveLength(3);
    for (const r of batch.rows) expect(JSON.stringify(reads)).not.toContain(decryptField((await prisma.employeeBankAccount.findFirstOrThrow({ where: { employeeId: r.employeeId } })).accountNumberEncrypted));
    expect((await api(world.tokens.maker, "post", `/runs/${runId}/bank-file/generate`)).body.error.code).toBe("ALREADY_RELEASED");
    await expect(prisma.bankTransferBatch.update({ where: { id: batch.id }, data: { rowCount: 9 } })).rejects.toThrow(/BANK_BATCH_IMMUTABLE/);
    await expect(prisma.bankTransferRow.update({ where: { id: batch.rows[0]!.id }, data: { amount: "1" } })).rejects.toThrow(/APPEND_ONLY/);
  });

  it("the batch is shown masked, downloaded through a short-lived link that is audited, and only by those who may see it", async () => {
    const batch = await prisma.bankTransferBatch.findUniqueOrThrow({ where: { runId } });
    const view = await api(world.tokens.maker, "get", `/bank-batches/${batch.id}`);
    expect(view.status).toBe(200);
    for (const r of await prisma.bankTransferRow.findMany({ where: { batchId: batch.id } })) {
      const acct = await prisma.employeeBankAccount.findFirstOrThrow({ where: { employeeId: r.employeeId } });
      expect(JSON.stringify(view.body)).not.toContain(decryptField(acct.accountNumberEncrypted));
    }
    expect(view.body.rows).toHaveLength(3);
    const dl = await api(world.tokens.checkerA, "get", `/bank-batches/${batch.id}/file`);
    expect([dl.status, typeof dl.body.url]).toEqual([200, "string"]);
    expect(await prisma.auditLog.count({ where: { action: "payroll.bank.file_downloaded", entityId: batch.id } })).toBe(1);
    for (const token of [hrExecToken, aToken]) {
      expect((await api(token, "get", `/bank-batches/${batch.id}`)).status).toBe(403);
      expect((await api(token, "get", `/bank-batches/${batch.id}/file`)).status).toBe(403);
    }
  });

  it("marking it paid needs the bank's reference and a typed PAID, happens once, and the bank's response is stored and never read", async () => {
    const batch = await prisma.bankTransferBatch.findUniqueOrThrow({ where: { runId } });
    const bad = await api(world.tokens.maker, "post", `/bank-batches/${batch.id}/mark-paid`, { reference: "UTR123456", paidOn: "2026-08-31", confirm: "yes" });
    expect(bad.status).toBe(400);
    expect((await api(world.tokens.maker, "post", `/bank-batches/${batch.id}/mark-paid`, { reference: "x", paidOn: "2026-08-31", confirm: "PAID" })).status).toBe(400);
    await expect(markPaid(batch.id, { reference: "x", paidOn: "2026-08-31", confirm: "PAID" }, { userId: world.maker.userId })).rejects.toMatchObject({ status: 400 }); // the service says so itself, in words, not only the route and the database
    const ok = await api(world.tokens.maker, "post", `/bank-batches/${batch.id}/mark-paid`, { reference: "UTR123456", paidOn: "2026-08-31", confirm: "PAID" });
    expect([ok.status, ok.body.status, ok.body.paid.reference]).toEqual([200, "PAID", "UTR123456"]);
    expect((await api(world.tokens.maker, "post", `/bank-batches/${batch.id}/mark-paid`, { reference: "UTR999999", paidOn: "2026-08-31", confirm: "PAID" })).body.error.code).toBe("ALREADY_PAID");
    await expect(prisma.bankTransferBatch.update({ where: { id: batch.id }, data: { bankReference: "CHANGED" } })).rejects.toThrow(/BANK_BATCH_PAID_ONCE/);
    const up = await request(app).post(`/api/payroll/bank-batches/${batch.id}/response`).set(...authHeader(world.tokens.maker)).attach("file", Buffer.from("OK|UTR123456|3 rows"), "response.txt");
    expect([up.status, up.body.response?.fileName]).toEqual([200, "response.txt"]);
    expect((await request(app).post(`/api/payroll/bank-batches/${batch.id}/response`).set(...authHeader(world.tokens.maker)).attach("file", Buffer.from("again"), "r2.txt")).status).toBe(409);
  });

  // ── Statutory files and the register ──
  it("a statutory file cannot be made until its layout is confirmed; the register needs none and is recorded with its hash", async () => {
    expect((await api(world.tokens.maker, "post", `/runs/${runId}/outputs`, { kind: "PT" })).body.error.code).toBe("LAYOUT_NOT_CONFIRMED");
    expect((await api(world.tokens.maker, "post", `/runs/${runId}/outputs`, { kind: "PF_ECR" })).body.error.code).toBe("LAYOUT_NOT_CONFIRMED");
    const reg = await api(world.tokens.maker, "post", `/runs/${runId}/outputs`, { kind: "SALARY_REGISTER" });
    expect([reg.status, reg.body.kind, reg.body.rows]).toEqual([201, "SALARY_REGISTER", 3]);
    expect(reg.body.sha256).toMatch(/^[0-9a-f]{64}$/);
    const dl = await api(world.tokens.checkerA, "get", `/outputs/${reg.body.id}/file`);
    expect([dl.status, typeof dl.body.url]).toEqual([200, "string"]);
    expect((await api(hrExecToken, "get", `/outputs/${reg.body.id}/file`)).status).toBe(403);
    expect((await api(aToken, "post", `/runs/${runId}/outputs`, { kind: "SALARY_REGISTER" })).status).toBe(403);
  });

  it("the PF file stops, naming people, when somebody it needs a UAN for has none; with UANs it is written and each UAN read is audited", async () => {
    const pre = await api(world.tokens.maker, "post", "/layouts/PF_ECR/save-preview", { value: { format: "DELIMITED", delimiter: "#~#", extension: "txt", lineEnding: "LF", columns: [{ source: "FIELD", value: "UAN" }, { source: "FIELD", value: "NAME" }, { source: "FIELD", value: "EPF_WAGES" }, { source: "FIELD", value: "EPF_CONTRIBUTION" }, { source: "FIELD", value: "NCP_DAYS" }] } });
    expect(pre.status).toBe(200);
    await put(world.tokens.maker, "/layouts/PF_ECR", { value: pre.body.after.value, fingerprint: pre.body.fingerprint });
    const cp = await api(world.tokens.checkerA, "post", "/layouts/PF_ECR/confirm-preview");
    expect((await api(world.tokens.checkerA, "post", "/layouts/PF_ECR/confirm", { version: cp.body.version, note: "checked", fingerprint: cp.body.fingerprint })).status).toBe(200);
    const slipRows = await prisma.payrollRunLine.count({ where: { runId, code: "PF_EMPLOYEE" } });
    expect(slipRows).toBeGreaterThan(0);
    const noUan = await api(world.tokens.maker, "post", `/runs/${runId}/outputs`, { kind: "PF_ECR" });
    expect([noUan.status, noUan.body.error.code]).toEqual([409, "MISSING_IDENTIFIERS"]);
    expect(noUan.body.error.message).toMatch(/no UAN/);
    for (const n of ["a", "b", "c"]) await prisma.employeeStatutory.update({ where: { employeeId: who(n) }, data: { uanEncrypted: encryptField(`10000000000${n.charCodeAt(0)}`), uanLast4: `${n.charCodeAt(0)}`.slice(-4) } });
    const ok = await api(world.tokens.maker, "post", `/runs/${runId}/outputs`, { kind: "PF_ECR" });
    expect([ok.status, ok.body.rows]).toEqual([201, slipRows]);
    const out = await prisma.payrollOutput.findFirstOrThrow({ where: { runId, kind: "PF_ECR" } });
    const text = (await storageService.getObject(out.fileKey)).body.toString("utf8").trimEnd().split("\n");
    expect(text).toHaveLength(slipRows);
    expect(text[0]).toMatch(/^10000000000\d+#~#Test Employee .+#~#\d+(\.\d+)?#~#\d+(\.\d+)?#~#0$/);
    expect(await prisma.auditLog.count({ where: { action: "payroll.output.identifier_read", entityId: { in: ["a", "b", "c"].map(who) } } })).toBe(slipRows);
    await expect(prisma.payrollOutput.update({ where: { id: out.id }, data: { rowCount: 1 } })).rejects.toThrow(/APPEND_ONLY/);
  });
});

// ── The scan: nothing an owner keeps to themselves is on any screen, in any export or in any error a person without the permission can reach ──
describe("the sensitive-data scan, on a company with a published run and a bank file", () => {
  let world: Closing;
  let runId: string;
  const hrRole = `TEST_CRAWL_HR_${Date.now()}`;
  let hr: { employeeId: string; userId: string; employeeCode: string };
  let dev: { employeeId: string; userId: string; employeeCode: string };
  let sentinels: Array<{ label: string; value: string; owner?: string }> = [];
  const IDENTIFIER = "ZZESI/55120/SENTINEL-77";
  const who = (n: string) => world.named[n]!.employeeId;

  beforeAll(async () => {
    world = await closingWorld(["a", "b", "c"]);
    await staffWith(world, ["a", "b", "c"]);
    await setRules(world.maker.userId, REAL_RULES);
    runId = await calculateRun(world);
    await confirmAllPins(world, runId);
    await driveToFinal(world, runId);
    // Statutory numbers and the company's secrets, entered the way the owners do.
    for (const [i, n] of ["a", "b", "c"].entries()) {
      await prisma.employeeStatutory.update({ where: { employeeId: who(n) }, data: encryptStatutoryFields({ uan: `1002003004${i}${i}`, esiNumber: `ESI-SENT-${i}${i}${i}${i}${i}` }) });
    }
    const pre = await api(world.tokens.maker, "post", "/layouts/BANK_TEMPLATE/save-preview", { value: { ...LAYOUT, debitAccountNumber: DEBIT } });
    await request(app).put("/api/payroll/layouts/BANK_TEMPLATE").set(...authHeader(world.tokens.maker)).send({ value: { ...LAYOUT, debitAccountNumber: DEBIT }, fingerprint: pre.body.fingerprint });
    const cp = await api(world.tokens.checkerA, "post", "/layouts/BANK_TEMPLATE/confirm-preview");
    await api(world.tokens.checkerA, "post", "/layouts/BANK_TEMPLATE/confirm", { version: cp.body.version, note: "matches the sheet the bank gave", fingerprint: cp.body.fingerprint });
    const ep = await api(world.tokens.maker, "post", "/rules/ESI_EMPLOYER_CODE/edit-preview", { value: IDENTIFIER });
    await request(app).put("/api/payroll/rules/ESI_EMPLOYER_CODE").set(...authHeader(world.tokens.maker)).send({ value: IDENTIFIER, fingerprint: ep.body.fingerprint });
    const cc = await api(world.tokens.checkerA, "post", "/rules/ESI_EMPLOYER_CODE/confirm-preview");
    await api(world.tokens.checkerA, "post", "/rules/ESI_EMPLOYER_CODE/confirm", { version: cc.body.version, typedValue: IDENTIFIER, note: "against the registration letter", fingerprint: cc.body.fingerprint });
    // Publish the payslips and make the bank file, so slips, a batch and their files exist to be looked for.
    await requestStep(world.tokens.maker, runId, "publish");
    await approve(world, world.tokens.checkerA, runId, "publish");
    await api(world.tokens.maker, "post", `/runs/${runId}/payslips/publish`);
    await requestStep(world.tokens.maker, runId, "bank-file");
    await approve(world, world.tokens.checkerB, runId, "bank-file");
    await api(world.tokens.maker, "post", `/runs/${runId}/bank-file/generate`);
    await api(world.tokens.maker, "post", `/runs/${runId}/outputs`, { kind: "SALARY_REGISTER" });

    // An HR executive without bank, statutory or salary rights, and a developer: the two people the scan is about.
    await grantPermissions(hrRole, [...SYSTEM_ROLES.find((r) => r.code === "HR_EXECUTIVE")!.permissions]);
    await prisma.role.update({ where: { code: hrRole }, data: { dataScope: "ALL" } });
    hr = await createFullTestEmployee(world.org, { roleCode: hrRole });
    dev = await createFullTestEmployee(world.org, { roleCode: DEVELOPER_ROLE_CODE });
    world.userIds.push(hr.userId, dev.userId);

    // What must never appear: every real value, taken from the database in the clear.
    const found: typeof sentinels = [];
    for (const n of ["a", "b", "c"]) {
      const id = who(n);
      const bank = await prisma.employeeBankAccount.findFirstOrThrow({ where: { employeeId: id } });
      const st = await prisma.employeeStatutory.findFirstOrThrow({ where: { employeeId: id } });
      found.push({ label: `${n} bank account`, value: decryptField(bank.accountNumberEncrypted), owner: id });
      found.push({ label: `${n} PAN`, value: decryptField(st.panEncrypted!), owner: id });
      found.push({ label: `${n} Aadhaar`, value: decryptField(st.aadhaarEncrypted!), owner: id });
      found.push({ label: `${n} UAN`, value: decryptField(st.uanEncrypted!), owner: id });
      found.push({ label: `${n} ESI number`, value: decryptField(st.esiEncrypted!), owner: id });
    }
    found.push({ label: "debit account", value: DEBIT }, { label: "bank layout constant", value: "ZZHDR9917" }, { label: "company identifier", value: IDENTIFIER });
    sentinels = found;
  }, 900_000);
  afterAll(async () => {
    resetSeams();
    await cleanupFullTestEmployee(hr.employeeId);
    await cleanupFullTestEmployee(dev.employeeId);
    await cleanupTestRole(hrRole);
    await closeWorld(world);
  });

  const SALARY = ["600000", "144600", "48200"]; // the annual CTC, the run's net total and one person's net: what the salary class holds

  const idsFor = async () => {
    const slips = await prisma.payslip.findMany({ where: { runId }, select: { id: true } });
    const batch = await prisma.bankTransferBatch.findUniqueOrThrow({ where: { runId } });
    const outputs = await prisma.payrollOutput.findMany({ where: { runId }, select: { id: true } });
    return {
      id: [who("a"), runId, slips[0]!.id, batch.id, outputs[0]?.id ?? "x", who("b")],
      employeeId: [who("a"), who("b"), who("c")],
      userId: [world.named.a!.userId],
      key: ["ESI_EMPLOYER_CODE", "BANK_TEMPLATE", "PF_ECR"],
      rowId: ["x"],
    };
  };

  for (const persona of ["developer", "hr executive without bank, statutory or salary rights"] as const) {
    it(`${persona}: no GET route answers with an owner's secret`, async () => {
      const token = await loginAs((persona === "developer" ? dev : hr).employeeCode);
      const crawled = await crawlGets(app, token, await idsFor());
      expect(crawled.filter((c) => c.status === 200).length).toBeGreaterThan(20); // the crawl really reached things
      const leaks: string[] = [];
      for (const c of crawled) {
        for (const s of [...sentinels.map((x) => ({ label: x.label, value: x.value })), ...SALARY.map((v) => ({ label: `salary figure ${v}`, value: v }))]) {
          if (c.text.includes(s.value)) leaks.push(`${c.route} (${c.url}) → ${s.label}`);
        }
      }
      expect(leaks).toEqual([]);
    }, 600_000);
  }

  it("an ordinary employee reads their own payslip and nothing of anyone else's, or the company's", async () => {
    const token = await loginAs(world.named.a!.employeeCode);
    const crawled = await crawlGets(app, token, await idsFor());
    const leaks: string[] = [];
    for (const c of crawled) for (const s of sentinels) if (s.owner !== who("a") && c.text.includes(s.value)) leaks.push(`${c.route} (${c.url}) → ${s.label}`);
    expect(leaks).toEqual([]);
  }, 600_000);

  it("a failed request never echoes a value it was sent: validation errors on bank, statutory, layout and identifier endpoints", async () => {
    const SENT = "998877665544332";
    const SENT_PAN = "ZZZZZ9999Z";
    const bad = [
      await request(app).patch(`/api/employees/${who("a")}/bank`).set(...authHeader(world.supToken)).send({ accountNumber: SENT, accountNumberConfirm: "999", ifsc: "BAD", bankName: "", branchName: "" }),
      await request(app).patch(`/api/employees/${who("a")}/statutory`).set(...authHeader(world.supToken)).send({ pan: SENT_PAN + "X", aadhaar: SENT }),
      await request(app).put("/api/payroll/layouts/BANK_TEMPLATE").set(...authHeader(world.tokens.maker)).send({ value: { debitAccountNumber: SENT, format: "NOPE" }, fingerprint: "x".repeat(12) }),
      await request(app).post("/api/payroll/layouts/BANK_TEMPLATE/save-preview").set(...authHeader(world.tokens.maker)).send({ value: { ...LAYOUT, debitAccountNumber: SENT.slice(0, 3) } }),
      await request(app).post("/api/payroll/rules/ESI_EMPLOYER_CODE/confirm").set(...authHeader(world.tokens.checkerA)).send({ version: 1, typedValue: SENT, note: "x", fingerprint: "y".repeat(12) }),
    ];
    for (const r of bad) {
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(r.body)).not.toContain(SENT);
      expect(JSON.stringify(r.body)).not.toContain(SENT_PAN);
    }
  });

  it("no table of the database holds the debit account, the bank layout's constant, a company identifier or an employee's ESI number in the clear", async () => {
    // ESI numbers joined in P7-0: until then they were stored as plain text (esi_number), so this scan could not include them.
    const needles = [DEBIT, "ZZHDR9917", IDENTIFIER, "ESI-SENT-00000", "ESI-SENT-11111", "ESI-SENT-22222"];
    const cols = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
      SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND data_type IN ('text', 'character varying', 'json', 'jsonb')`;
    const hits: string[] = [];
    for (const c of cols) {
      for (const needle of needles) {
        const n = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(`SELECT count(*)::bigint AS c FROM "${c.table_name}" WHERE "${c.column_name}"::text LIKE $1`, `%${needle}%`);
        if (Number(n[0]!.c) > 0) hits.push(`${c.table_name}.${c.column_name} holds ${needle.slice(0, 6)}…`);
      }
    }
    expect(hits).toEqual([]);
  });
});

describe("a draft payslip preview carries the TEST watermark and is never stored", () => {
  let world: Closing;
  let runId: string;
  beforeAll(async () => {
    world = await closingWorld(["a"]);
    await staffWith(world, ["a"]);
    await setRules(world.maker.userId, REAL_RULES);
    runId = await calculateRun(world); // the rules are Placeholders: this is a TEST run
  }, 300_000);
  afterAll(async () => {
    resetSeams();
    await closeWorld(world);
  });

  it("shows the person's slip on screen and as a PDF, watermarked, and writes nothing", async () => {
    const who = world.named.a!.employeeId;
    const p = await api(world.tokens.maker, "get", `/runs/${runId}/items/${who}/payslip-preview`);
    expect(p.status).toBe(200);
    expect(p.body.watermark).toMatch(/TEST/);
    expect(p.body.content.totals.net).toMatch(/^\d+\.\d\d$/);
    const pdf = await request(app).get(`/api/payroll/runs/${runId}/items/${who}/payslip-preview.pdf`).set(...authHeader(world.tokens.maker)).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect([pdf.status, pdf.headers["content-type"]]).toEqual([200, "application/pdf"]);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");
    expect(await prisma.payslip.count({ where: { runId } })).toBe(0);
    expect((await api(world.tokens.checkerA, "get", `/runs/${runId}/items/${who}/payslip-preview`)).status).toBe(200);
  }, 120_000);

  it("nobody can publish payslips from a run that is not final", async () => {
    expect((await api(world.tokens.maker, "post", `/runs/${runId}/payslips/publish`)).body.error.code).toBe("RUN_STATE");
    expect((await api(world.tokens.maker, "post", `/runs/${runId}/bank-file/generate`)).body.error.code).toBe("RUN_STATE");
    expect((await api(world.tokens.maker, "post", `/runs/${runId}/outputs`, { kind: "SALARY_REGISTER" })).body.error.code).toBe("RUN_STATE");
  });
});
