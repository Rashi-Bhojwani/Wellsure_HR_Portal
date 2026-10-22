import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { deleteWithDependents, purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { writeJobChange } from "../../../lib/effectiveDating";
import * as permissions from "../../../lib/permissions";
import { prisma } from "../../../lib/prisma";
import { unlockCycle } from "../../attendance/finalisation";
import { confirmRule, previewConfirm } from "../rules/governed";
import { payrollLockOn } from "../run/lock";
import { CYCLE, api, buildRunWorld, calculateAgain, calculateRun, day, lockCycle, setRules, teardownRunWorld, type RunWorld } from "./runTestHelpers";
import { FIRST_SALARY_DAY, giveSalary, makeComponent } from "./salaryTestHelpers";

// Submitting, approving, finalising and unlocking a run through the real API, the real database and the real lock (docs/plans/PHASE_6.md §14F). The first world is
// the one that matters most: a run that leaves somebody out is not approvable, and the names are in the preview.

import { REAL_RULES, approve, closeWorld, closingWorld, confirmAllPins, driveToFinal, requestStep, resetSeams, runRow, staffWith, state, step, stepOf, submit, type Closing } from "./closeTestHelpers";


// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("a run that leaves somebody out cannot be approved", () => {
  let world: Closing;
  let runId: string;
  const who = (n: string) => world.named[n]!.employeeId;

  beforeAll(async () => {
    world = await closingWorld(["ok1", "ok2", "nosalary", "unlocked", "fined"]);
    await makeComponent(world, `${world.prefix}_FINE`, { type: "DEDUCTION", payslipLabel: "Fine", payslipOrder: 9 });
    await staffWith(world, ["ok1", "ok2", "fined"]);
    await staffWith(world, ["nosalary"], { salary: false });
    await giveSalary(world, who("unlocked"), "600000", FIRST_SALARY_DAY);
    await lockCycle(who("unlocked"), CYCLE.start, CYCLE.end, { "2026-08-30": { locked: false }, "2026-08-31": { locked: false } });
    await setRules(world.maker.userId, REAL_RULES);
    runId = await calculateRun(world);
  }, 300_000);
  afterAll(async () => {
    resetSeams();
    await closeWorld(world);
  });

  const preview = async () => (await step(world.tokens.maker, runId, "run", "preview")).body;

  it("puts the people who are left out at the top of the submit preview, each with the reason, and says the run cannot be submitted", async () => {
    const p = await preview();
    expect(p.canRequest).toBe(false);
    expect(p.leftOut.map((x: { name: string; code: string }) => x.code).sort()).toEqual(["ATTENDANCE_NOT_FINAL", "NO_SALARY"]);
    expect(p.leftOut.every((x: { name: string; reason: string }) => x.name.length > 0 && x.reason.length > 10)).toBe(true);
    expect(p.blockers.map((b: { code: string }) => b.code)).toContain("PEOPLE_LEFT_OUT");
    const first = p.blockers.find((b: { code: string }) => b.code === "PEOPLE_LEFT_OUT");
    expect(first.message).toMatch(/2 people are left out of this run/);
    expect(first.details.people.map((x: { employeeId: string }) => x.employeeId).sort()).toEqual([who("nosalary"), who("unlocked")].sort());
  });

  it("also says that the rules are still placeholders: a run on them is a test and cannot go further", async () => {
    const p = await preview();
    expect(p.blockers.map((b: { code: string }) => b.code)).toContain("PLACEHOLDER_RULES");
    expect(p.watermark.test).toBe(true);
  });

  it("refuses to submit it, even with the fingerprint of the preview, and creates nothing", async () => {
    const p = await preview();
    const r = await step(world.tokens.maker, runId, "run", "request", { fingerprint: p.fingerprint });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("PEOPLE_LEFT_OUT");
    expect(r.body.error.details.blockers.length).toBeGreaterThan(1);
    expect((await runRow(runId)).status).toBe("CALCULATED");
    expect(await prisma.payrollApproval.count({ where: { subjectId: runId } })).toBe(0);
  });

  it("is still refused for the people left out once the rules are confirmed: confirming rules does not make it approvable", async () => {
    await confirmAllPins(world, runId);
    const p = await preview();
    expect(p.blockers.map((b: { code: string }) => b.code)).toEqual(["PEOPLE_LEFT_OUT"]);
    const r = await step(world.tokens.maker, runId, "run", "request", { fingerprint: p.fingerprint });
    expect([r.status, r.body.error.code]).toEqual([409, "PEOPLE_LEFT_OUT"]);
  });

  it("is refused for a problem that must be put right (a negative net under the BLOCK policy), naming the person", async () => {
    // Put the left-out people right first, so the problem is the only thing in the way.
    await giveSalary(world, who("nosalary"), "600000", FIRST_SALARY_DAY);
    await prisma.dailyAttendance.updateMany({ where: { employeeId: who("unlocked") }, data: { isLocked: true } });
    const adj = { employeeId: who("fined"), componentCode: `${world.prefix}_FINE`, direction: "DEDUCTION", amount: "99999.00", reason: "a fine far larger than the pay" };
    const pv = await api(world.tokens.maker, "post", "/adjustments/preview", { input: adj });
    const added = await api(world.tokens.maker, "post", "/adjustments", { input: adj, fingerprint: pv.body.fingerprint });
    expect(added.status).toBe(201);
    await calculateAgain(world, runId);
    const p = await preview();
    expect(p.leftOut).toEqual([]);
    expect(p.blockers.map((b: { code: string }) => b.code)).toEqual(["BLOCKING_EXCEPTIONS"]);
    expect(p.blockingExceptions[0]).toMatchObject({ employeeId: who("fined"), code: "NEGATIVE_NET" });
    const r = await step(world.tokens.maker, runId, "run", "request", { fingerprint: p.fingerprint });
    expect([r.status, r.body.error.code]).toEqual([409, "BLOCKING_EXCEPTIONS"]);
    await api(world.tokens.maker, "post", `/adjustments/${added.body.id}/cancel`, { reason: "it was a mistake" });
  }, 120_000);

  it("can be submitted once everyone is in and nothing blocks it", async () => {
    await calculateAgain(world, runId);
    const p = await preview();
    expect(p.blockers).toEqual([]);
    expect(p.leftOut).toEqual([]);
    expect(p.canRequest).toBe(true);
    const r = await step(world.tokens.maker, runId, "run", "request", { fingerprint: p.fingerprint });
    expect([r.status, r.body.runStatus]).toEqual([201, "SUBMITTED"]);
  }, 120_000);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("submit, approve, finalise, the lock and unlock", () => {
  let world: Closing;
  let runId: string;
  const who = (n: string) => world.named[n]!.employeeId;

  beforeAll(async () => {
    world = await closingWorld(["a", "b", "c"]);
    await staffWith(world, ["a", "b", "c"]);
    await setRules(world.maker.userId, REAL_RULES);
    const bonus = { employeeId: who("a"), componentCode: world.special, direction: "EARNING", amount: "1500.00", reason: "a bonus for the test" };
    const pv = await api(world.tokens.maker, "post", "/adjustments/preview", { input: bonus });
    expect((await api(world.tokens.maker, "post", "/adjustments", { input: bonus, fingerprint: pv.body.fingerprint })).status).toBe(201);
    runId = await calculateRun(world);
    await confirmAllPins(world, runId);
  }, 300_000);
  afterAll(async () => {
    resetSeams();
    vi.restoreAllMocks();
    await closeWorld(world);
  });

  it("previews the submission: nobody left out, who is affected, the change from last month, and who could approve", async () => {
    const p = await step(world.tokens.maker, runId, "run", "preview");
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ canRequest: true, blockers: [], leftOut: [], blockingExceptions: [], runStatus: "CALCULATED" });
    expect(p.body.affected).toMatchObject({ people: 3, payable: 3, held: 0, ownLine: null });
    expect(p.body.variance.baseline).toBeNull(); // no run for the month before
    expect(p.body.watermark.test).toBe(false);
    expect(p.body.checkers.eligible.map((c: { name: string }) => c.name).length).toBeGreaterThanOrEqual(2);
    expect(p.body.checkers.state).toBe("MANY");
  });

  it("says in words when only one person can approve, and when nobody can", async () => {
    const real = permissions.activeUsersHoldingPermission;
    const spy = vi.spyOn(permissions, "activeUsersHoldingPermission");
    spy.mockImplementation(async (key) => (key === "payroll.approve" ? (await real(key)).filter((u) => u.userId === world.checkerA.userId) : real(key)));
    const one = await step(world.tokens.maker, runId, "run", "preview");
    expect(one.body.checkers.state).toBe("ONE");
    expect(one.body.checkers.message).toMatch(/^Only .+ can approve this/);
    const fin = await step(world.tokens.maker, runId, "finalise", "preview"); // not at this step yet, but the sentence is the same
    expect(fin.body.checkers.state).toBe("ONE");
    spy.mockImplementation(async (key) => (key === "payroll.approve" ? [] : real(key)));
    const none = await step(world.tokens.maker, runId, "run", "preview");
    expect(none.body.checkers.state).toBe("NONE");
    expect(none.body.checkers.message).toMatch(/Nobody can approve this right now/);
    vi.restoreAllMocks();
  });

  it("is refused to a checker, with a fingerprint that is not the preview's, and on a run that is not at this step", async () => {
    const p = await step(world.tokens.maker, runId, "run", "preview");
    expect((await step(world.tokens.checkerA, runId, "run", "request", { fingerprint: p.body.fingerprint })).status).toBe(403);
    const stale = await step(world.tokens.maker, runId, "run", "request", { fingerprint: "f".repeat(40) });
    expect([stale.status, stale.body.error.code]).toEqual([409, "PREVIEW_STALE"]);
    expect((await runRow(runId)).status).toBe("CALCULATED");
    const early = await step(world.tokens.maker, runId, "finalise", "preview");
    expect(early.body.blockers[0]).toMatchObject({ code: "RUN_STATE" });
    const tooEarly = await api(world.tokens.maker, "post", `/runs/${runId}/finalise`);
    expect([tooEarly.status, tooEarly.body.error.code]).toEqual([409, "RUN_STATE"]);
  });

  it("submits it: it waits for a decision, and is locked: no recalculation, no discarding, no second submission, no change to its people", async () => {
    await submit(world, runId);
    const run = await runRow(runId);
    expect(run.status).toBe("SUBMITTED");
    const approval = await prisma.payrollApproval.findFirstOrThrow({ where: { subject: "RUN_APPROVAL", subjectId: runId } });
    expect([approval.status, approval.contentHash, approval.makerUserId]).toEqual(["PENDING", run.runHash, world.maker.userId]);
    expect((await api(world.tokens.maker, "post", `/runs/${runId}/calculate-preview`)).body.error.code).toBe("RUN_LOCKED_FOR_APPROVAL");
    expect((await api(world.tokens.maker, "post", `/runs/${runId}/void`, { reason: "never mind" })).body.error.message).toMatch(/Withdraw it from approval/);
    const again = await step(world.tokens.maker, runId, "run", "preview");
    expect([again.body.review, again.body.canRequest, again.body.blockers]).toEqual([true, false, []]); // the checker sees what the maker saw; it cannot be submitted again
    expect(again.body.affected.people).toBe(3);
    const twice = await step(world.tokens.maker, runId, "run", "request", { fingerprint: again.body.fingerprint });
    expect([twice.status, twice.body.error.code]).toEqual([409, "RUN_STATE"]);
    const item = await prisma.payrollRunItem.findFirstOrThrow({ where: { runId } });
    await expect(prisma.payrollRunItem.update({ where: { id: item.id }, data: { netPay: "1", netBeforeRounding: "1" } })).rejects.toThrow(/RUN_LOCKED_FOR_APPROVAL/);
    const seen = await step(world.tokens.checkerA, runId, "run", "preview"); // the checker is shown what the maker was shown
    expect([seen.status, seen.body.review, seen.body.affected.people, seen.body.leftOut]).toEqual([200, true, 3, []]);
    expect(seen.body.checkers.eligible.length).toBeGreaterThanOrEqual(1);
    const s = await stepOf(world.tokens.checkerA, runId, "run");
    expect(s.you).toMatchObject({ canDecide: true });
    expect((await stepOf(world.tokens.maker, runId, "run")).you).toMatchObject({ canDecide: false, canMake: true });
  });

  it("is not decided by the maker; the checker needs the hash they were shown, and a rejection needs a reason", async () => {
    const hash = (await stepOf(world.tokens.checkerA, runId, "run")).live!.hash;
    expect((await step(world.tokens.maker, runId, "run", "decision", { decision: "APPROVE", hash })).status).toBe(403);
    expect((await step(world.tokens.checkerA, runId, "run", "decision", { decision: "APPROVE" })).status).toBe(400);
    const wrong = await step(world.tokens.checkerA, runId, "run", "decision", { decision: "APPROVE", hash: "e".repeat(64) });
    expect([wrong.status, wrong.body.error.code]).toEqual([409, "PREVIEW_STALE"]);
    expect((await step(world.tokens.checkerA, runId, "run", "decision", { decision: "REJECT" })).status).toBe(400);
    expect((await runRow(runId)).status).toBe("SUBMITTED");
  });

  it("a rejection sends it back to a draft with the reason where the maker can see it, and it can be submitted again", async () => {
    const r = await step(world.tokens.checkerA, runId, "run", "decision", { decision: "REJECT", note: "Please look at Bonus again" });
    expect([r.status, r.body.status]).toEqual([200, "REJECTED"]);
    expect((await runRow(runId)).status).toBe("CALCULATED");
    expect((await stepOf(world.tokens.maker, runId, "run")).last).toMatchObject({ status: "REJECTED", decisionNote: "Please look at Bonus again" });
    await submit(world, runId, "looked again");
    expect((await runRow(runId)).status).toBe("SUBMITTED");
  });

  it("a maker can withdraw it, which voids the approval and returns it to a draft", async () => {
    const preview = await step(world.tokens.maker, runId, "run", "withdraw-preview");
    expect(preview.body.willVoid).toHaveLength(1);
    expect((await step(world.tokens.maker, runId, "run", "withdraw", { reason: "x", fingerprint: preview.body.fingerprint })).status).toBe(400);
    expect((await step(world.tokens.maker, runId, "run", "withdraw", { reason: "need to change a thing", fingerprint: "z".repeat(30) })).body.error.code).toBe("PREVIEW_STALE");
    const done = await step(world.tokens.maker, runId, "run", "withdraw", { reason: "need to change a thing", fingerprint: preview.body.fingerprint });
    expect([done.status, done.body.runStatus]).toEqual([200, "CALCULATED"]);
    expect((await stepOf(world.tokens.maker, runId, "run")).last).toMatchObject({ status: "VOIDED", voidReason: "need to change a thing" });
    expect((await step(world.tokens.maker, runId, "run", "withdraw", { reason: "again", fingerprint: preview.body.fingerprint })).body.error.code).toBe("NOTHING_PENDING");
    await submit(world, runId);
  });

  it("approves what was shown: the run is approved, bound to the hash, and still cannot be touched", async () => {
    await approve(world, world.tokens.checkerA, runId, "run");
    const run = await runRow(runId);
    expect(run.status).toBe("APPROVED");
    const a = await prisma.payrollApproval.findFirstOrThrow({ where: { subject: "RUN_APPROVAL", subjectId: runId, status: "APPROVED" } });
    expect([a.status, a.hashAtDecision, a.checkerUserId]).toEqual(["APPROVED", run.runHash, world.checkerA.userId]);
    expect((await api(world.tokens.maker, "post", `/runs/${runId}/calculate-preview`)).status).toBe(409);
    const early = await api(world.tokens.maker, "post", `/runs/${runId}/finalise`);
    expect([early.status, early.body.error.code]).toEqual([409, "APPROVAL_REQUIRED"]);
  });

  it("closing the period is its own request: previewed, decided by a second person, and carried out by someone other than the person who decided", async () => {
    const p = await step(world.tokens.maker, runId, "finalise", "preview");
    expect(p.body).toMatchObject({ canRequest: true, blockers: [], lock: { from: "2026-08-01", to: "2026-08-31" }, adjustmentsMarkedPaid: { count: 1, bySource: { MANUAL: 1 } } });
    expect(p.body.approvedBy).toBeTruthy();
    expect((await step(world.tokens.checkerA, runId, "finalise", "request", { fingerprint: p.body.fingerprint })).status).toBe(403);
    await requestStep(world.tokens.maker, runId, "finalise");
    expect((await step(world.tokens.maker, runId, "finalise", "decision", { decision: "APPROVE", hash: "a".repeat(64) })).status).toBe(403);
    await approve(world, world.supToken, runId, "finalise"); // the Super Admin holds every permission, which is exactly why they must not also carry it out
    const approved = await prisma.payrollApproval.findFirstOrThrow({ where: { subject: "PERIOD_FINALISE", subjectId: runId } });
    expect(approved.status).toBe("APPROVED");
    const same = await api(world.supToken, "post", `/runs/${runId}/finalise`);
    expect([same.status, same.body.error.code]).toEqual([403, "CHECKER_IS_EXECUTOR"]);
    expect((await runRow(runId)).status).toBe("APPROVED");
  });

  it("finalises: the run is final, the period is locked, the adjustments are paid, and both approvals are used up", async () => {
    const done = await api(world.tokens.maker, "post", `/runs/${runId}/finalise`);
    expect([done.status, done.body.status, done.body.adjustmentsPaid]).toEqual([200, "FINALISED", 1]);
    const run = await runRow(runId);
    expect([run.status, run.finalisedByUserId]).toEqual(["FINALISED", world.maker.userId]);
    expect((await prisma.payrollApproval.findMany({ where: { subjectId: runId }, select: { subject: true, status: true } })).map((a) => `${a.subject}:${a.status}`).sort()).toEqual(["PERIOD_FINALISE:CONSUMED", "RUN_APPROVAL:CONSUMED", "RUN_APPROVAL:REJECTED", "RUN_APPROVAL:VOIDED"]); // the rejected and the withdrawn ones stay on record
    const adj = await prisma.payrollAdjustment.findMany({ where: { consumedByRunId: runId } });
    expect(adj.map((a) => a.status)).toEqual(["CONSUMED"]);
    const locks = await prisma.payrollPeriodLock.findMany({ where: { runId } });
    expect(locks.map((l) => [l.action, l.runHash])).toEqual([["FINALISE", run.runHash]]);
    expect(await payrollLockOn(day("2026-08-15"))).toEqual({ locked: true, period: "Aug 2026" });
    expect((await payrollLockOn(day("2026-09-01"))).locked).toBe(false);
    expect((await payrollLockOn(day("2026-07-31"))).locked).toBe(false);
    // Nothing more can be done to a final run.
    expect((await api(world.tokens.maker, "post", `/runs/${runId}/finalise`)).body.error.code).toBe("RUN_STATE");
    expect((await api(world.tokens.maker, "post", `/runs/${runId}/void`, { reason: "undo it please" })).status).toBe(409);
    expect((await api(world.tokens.maker, "post", `/runs/${runId}/calculate-preview`)).status).toBe(409);
  });

  it("the real lock refuses a change dated inside the period and lets one after it through", async () => {
    const e = world.named.a!;
    await expect(prisma.$transaction((tx) => writeJobChange(tx, e.employeeId, day("2026-08-20"), { departmentId: world.org.departmentId }, { createdByUserId: world.maker.userId, changeReason: null }))).rejects.toMatchObject({ code: "PAYROLL_LOCKED" });
    await expect(prisma.$transaction((tx) => writeJobChange(tx, e.employeeId, day("2026-09-01"), { departmentId: world.org.departmentId }, { createdByUserId: world.maker.userId, changeReason: null }))).resolves.toBeTruthy();
  });

  it("the database refuses a second lock row for the same period, and any change to the log", async () => {
    const run = await runRow(runId);
    await expect(prisma.payrollPeriodLock.create({ data: { cycleStart: run.cycleStart, cycleEnd: run.cycleEnd, cycleLabel: run.cycleLabel, action: "FINALISE", runId, runHash: run.runHash!, actorUserId: world.maker.userId } })).rejects.toThrow(/PERIOD_ALREADY_LOCKED/);
    const row = await prisma.payrollPeriodLock.findFirstOrThrow({ where: { runId } });
    await expect(prisma.payrollPeriodLock.update({ where: { id: row.id }, data: { reason: "rewritten" } })).rejects.toThrow(/PERIOD_LOCK_APPEND_ONLY/);
    await expect(prisma.payrollPeriodLock.delete({ where: { id: row.id } })).rejects.toThrow(/PERIOD_LOCK_APPEND_ONLY/);
  });

  it("attendance unlock now warns that payroll has used the period", async () => {
    await prisma.attendancePeriodLock.create({ data: { periodStart: day(CYCLE.start), periodEnd: day(CYCLE.end), action: "FINALISE", reason: "", lockedDays: 0, actorUserId: world.sup.userId } });
    try {
      const meta = { actorUserId: world.sup.userId, ipAddress: null, userAgent: null };
      await expect(unlockCycle(CYCLE.start, CYCLE.end, { reason: "A day was found to be wrong", confirmPayrollConsumed: false }, { roleCodes: ["SUPER_ADMIN"] }, meta)).rejects.toMatchObject({ code: "PAYROLL_CONSUMED", details: { period: "Aug 2026", stage: "FINALISED" } });
    } finally {
      await deleteWithDependents("AttendancePeriodLock", (await prisma.attendancePeriodLock.findMany({ where: { periodStart: day(CYCLE.start) }, select: { id: true } })).map((r) => r.id));
      await purgeAppendOnly("AuditLog", { entityId: `${CYCLE.start}..${CYCLE.end}` });
    }
  });

  it("publishing payslips and the bank file are approvals on a final run, bound to it and decided by a second person", async () => {
    const pub = await step(world.tokens.maker, runId, "publish", "preview");
    expect(pub.body).toMatchObject({ canRequest: true, blockers: [], payslips: 3 });
    await requestStep(world.tokens.maker, runId, "publish");
    expect((await step(world.tokens.maker, runId, "publish", "decision", { decision: "REJECT", note: "no" })).status).toBe(403);
    await approve(world, world.tokens.checkerB, runId, "publish");
    expect((await stepOf(world.tokens.maker, runId, "publish")).live).toMatchObject({ status: "APPROVED", checker: { name: expect.any(String) } });
    // The bank file cannot even be asked for until its layout exists and a second person has confirmed it.
    const bank = await step(world.tokens.maker, runId, "bank-file", "preview");
    expect(bank.body.canRequest).toBe(false);
    expect(bank.body.blockers.map((b: { code: string }) => b.code)).toEqual(["BANK_TEMPLATE_PLACEHOLDER"]);
    const asked = await step(world.tokens.maker, runId, "bank-file", "request", { fingerprint: bank.body.fingerprint });
    expect([asked.status, asked.body.error.code]).toEqual([409, "BANK_TEMPLATE_PLACEHOLDER"]);
  });

  it("unlocking: needs the unlock permission, a reason, a second person, and carrying out by somebody who did not decide", async () => {
    const preview = await step(world.supToken, runId, "unlock", "preview");
    expect(preview.body).toMatchObject({ canRequest: true, blockers: [], adjustmentsReturned: 1 });
    expect(preview.body.allows.length).toBeGreaterThanOrEqual(4);
    expect((await step(world.tokens.maker, runId, "unlock", "preview")).status).toBe(200); // a payroll admin may look...
    expect((await step(world.tokens.maker, runId, "unlock", "request", { fingerprint: preview.body.fingerprint, note: "A day was wrong" })).status).toBe(403); // ...but not ask
    expect((await step(world.supToken, runId, "unlock", "request", { fingerprint: preview.body.fingerprint })).status).toBe(400); // a reason is needed
    expect((await api(world.supToken, "post", `/runs/${runId}/unlock`)).body.error.code).toBe("APPROVAL_REQUIRED");
    const asked = await step(world.supToken, runId, "unlock", "request", { fingerprint: preview.body.fingerprint, note: "A day was found to be wrong" });
    expect(asked.status).toBe(201);
    expect((await step(world.supToken, runId, "unlock", "decision", { decision: "APPROVE", hash: (await stepOf(world.supToken, runId, "unlock")).live!.hash })).status).toBe(403); // not the maker
    expect((await api(world.supToken, "post", `/runs/${runId}/unlock`)).body.error.code).toBe("APPROVAL_REQUIRED");
    await approve(world, world.tokens.checkerA, runId, "unlock");
    const out = await api(world.tokens.maker, "post", `/runs/${runId}/unlock`);
    expect(out.status).toBe(403); // the maker holds no unlock permission
    const done = await api(world.supToken, "post", `/runs/${runId}/unlock`);
    expect([done.status, done.body.status, done.body.adjustmentsReturned]).toEqual([200, "VOID", 1]);
  });

  it("after the unlock: the run is set aside as a record, the lock is open, what it paid is owed again, and the payslip approval is withdrawn", async () => {
    const run = await runRow(runId);
    expect(run.status).toBe("VOID");
    expect(run.voidReason).toBe("Unlocked: A day was found to be wrong");
    expect((await prisma.payrollPeriodLock.findMany({ where: { runId }, orderBy: { seq: "asc" } })).map((l) => l.action)).toEqual(["FINALISE", "UNLOCK"]);
    expect((await payrollLockOn(day("2026-08-15"))).locked).toBe(false);
    const adj = await prisma.payrollAdjustment.findMany({ where: { employeeId: who("a"), source: "MANUAL" } });
    expect(adj.map((a) => [a.status, a.consumedByRunId])).toEqual([["PENDING", null]]);
    expect((await prisma.payrollApproval.findFirstOrThrow({ where: { subject: "PAYSLIP_PUBLISH", subjectId: runId } })).status).toBe("VOIDED");
    expect(await prisma.payrollRunItem.count({ where: { runId } })).toBe(3); // the figures stay on record
    await expect(prisma.payrollRunItem.deleteMany({ where: { runId } })).rejects.toThrow(/RUN_VOID_IMMUTABLE/);
    await expect(prisma.$transaction((tx) => writeJobChange(tx, world.named.b!.employeeId, day("2026-08-20"), { departmentId: world.org.departmentId }, { createdByUserId: world.maker.userId, changeReason: null }))).resolves.toBeTruthy();
  });

  it("a new run can be made for the period, and takes the whole road again", async () => {
    runId = await calculateRun(world);
    await confirmAllPins(world, runId);
    await driveToFinal(world, runId);
    expect((await runRow(runId)).status).toBe("FINALISED");
    expect((await prisma.payrollPeriodLock.findMany({ where: { cycleLabel: "Aug 2026", runId } })).map((l) => l.action)).toEqual(["FINALISE"]);
  }, 300_000);

  it("unlock is refused once payslips are published or a bank file exists: by the service, and by the database even if the service is bypassed", async () => {
    // Unlocking is asked for and approved first; then payslips go out; then somebody tries to carry the unlock out.
    await requestStep(world.supToken, runId, "unlock", "A day was found to be wrong");
    await approve(world, world.tokens.checkerA, runId, "unlock");
    // A release is written only with the thing it releases (P6-5's trigger), so one payslip goes in first, directly, as the real publish would write it.
    const item = await prisma.payrollRunItem.findFirstOrThrow({ where: { runId, employeeId: who("a") } });
    await prisma.payslip.create({ data: { runId, runItemId: item.id, employeeId: who("a"), cycleLabel: CYCLE.label, cycleStart: day(CYCLE.start), cycleEnd: day(CYCLE.end), content: {}, contentHash: "test", publishedByUserId: world.maker.userId } });
    await prisma.payrollRunRelease.create({ data: { runId, kind: "PAYSLIPS_PUBLISHED", reference: "test", actorUserId: world.maker.userId } });
    const carried = await api(world.supToken, "post", `/runs/${runId}/unlock`);
    expect([carried.status, carried.body.error.code]).toEqual([409, "RUN_RELEASED"]); // the service says so in words; the database is only the second line
    expect((await runRow(runId)).status).toBe("FINALISED");
    const p = await step(world.supToken, runId, "unlock", "preview");
    expect(p.body.canRequest).toBe(false);
    expect(p.body.blockers[0]).toMatchObject({ code: "RUN_RELEASED" });
    expect(p.body.blockers[0].message).toMatch(/payslips have been published/i);
    const r = await step(world.supToken, runId, "unlock", "request", { fingerprint: p.body.fingerprint, note: "I would like to anyway" });
    expect([r.status, r.body.error.code]).toEqual([409, "RUN_RELEASED"]);
    // With the service out of the way: the run's own guard and the lock log's guard.
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('payroll.unlocking', 'yes', true)`;
        await tx.payrollRun.update({ where: { id: runId }, data: { status: "VOID", voidedAt: new Date(), voidReason: "bypass" } }); // allow-clock: a test instant
      }),
    ).rejects.toThrow(/RUN_RELEASED/);
    const run = await runRow(runId);
    await expect(prisma.payrollPeriodLock.create({ data: { cycleStart: run.cycleStart, cycleEnd: run.cycleEnd, cycleLabel: run.cycleLabel, action: "UNLOCK", runId, reason: "bypass the service", actorUserId: world.sup.userId } })).rejects.toThrow(/RUN_RELEASED/);
    // A bank file generated counts the same way.
    await deleteWithDependents("PayrollRunRelease", (await prisma.payrollRunRelease.findMany({ where: { runId }, select: { id: true } })).map((x) => x.id));
    await expect(prisma.payrollRunRelease.create({ data: { runId, kind: "BANK_FILE_GENERATED", reference: "test", actorUserId: world.maker.userId } })).rejects.toThrow(/RELEASE_NEEDS_BATCH/); // nothing to release yet
    await prisma.bankTransferBatch.create({ data: { runId, runHash: run.runHash!, paymentDate: day("2026-08-31"), templateVersion: 1, templateHash: "test", rowCount: 0, total: "0", fileKey: "test/none", fileName: "none.csv", fileSha256: "0", generatedByUserId: world.maker.userId } });
    await prisma.payrollRunRelease.create({ data: { runId, kind: "BANK_FILE_GENERATED", reference: "test", actorUserId: world.maker.userId } });
    expect((await step(world.supToken, runId, "unlock", "preview")).body.blockers[0].message).toMatch(/bank file has been generated/);
    expect((await runRow(runId)).status).toBe("FINALISED");
  });

  it("a release can only be recorded against a final run", async () => {
    const draft = await prisma.payrollRun.create({ data: { cycleStart: day("2026-05-01"), cycleEnd: day("2026-05-31"), cycleLabel: "May 2026", createdByUserId: world.maker.userId } });
    await expect(prisma.payrollRunRelease.create({ data: { runId: draft.id, kind: "PAYSLIPS_PUBLISHED", actorUserId: world.maker.userId } })).rejects.toThrow(/RELEASE_NEEDS_FINAL_RUN/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("an approval is bound to the exact figures: any change voids it", () => {
  let world: Closing;
  let runId: string;
  const who = (n: string) => world.named[n]!.employeeId;

  beforeAll(async () => {
    world = await closingWorld(["a", "b"]);
    await staffWith(world, ["a", "b"]);
    await setRules(world.maker.userId, REAL_RULES);
    runId = await calculateRun(world);
    await confirmAllPins(world, runId);
  }, 300_000);
  afterAll(async () => {
    resetSeams();
    await closeWorld(world);
  });

  const voidedFor = async (reason: RegExp) => {
    expect((await runRow(runId)).status).toBe("CALCULATED");
    const last = (await prisma.payrollApproval.findMany({ where: { subject: "RUN_APPROVAL", subjectId: runId }, orderBy: { submittedAt: "desc" } }))[0]!;
    expect(last.status).toBe("VOIDED");
    expect(last.voidReason).toMatch(reason);
  };
  const resubmit = async () => {
    await calculateAgain(world, runId);
    await submit(world, runId);
  };

  it("a run whose figures moved since it was calculated cannot be submitted", async () => {
    await prisma.employee.update({ where: { id: who("b") }, data: { lastWorkingDate: day("2026-08-20") } }); // nothing announced it
    try {
      const p = await step(world.tokens.maker, runId, "run", "preview");
      expect(p.body.blockers.map((b: { code: string }) => b.code)).toContain("RUN_STALE");
      expect(p.body.canRequest).toBe(false);
      const r = await step(world.tokens.maker, runId, "run", "request", { fingerprint: p.body.fingerprint });
      expect([r.status, r.body.error.code]).toEqual([409, "RUN_STALE"]);
      expect((await runRow(runId)).status).toBe("CALCULATED");
    } finally {
      await prisma.employee.update({ where: { id: who("b") }, data: { lastWorkingDate: null } });
    }
  });

  it("an adjustment added while it waits voids the approval at once, and records who changed the figures", async () => {
    await submit(world, runId);
    const adj = { employeeId: who("a"), componentCode: world.special, direction: "EARNING", amount: "250.00", reason: "added while it was waiting" };
    const pv = await api(world.tokens.maker, "post", "/adjustments/preview", { input: adj });
    expect((await api(world.tokens.maker, "post", "/adjustments", { input: adj, fingerprint: pv.body.fingerprint })).status).toBe(201);
    await voidedFor(/figures were changed: an adjustment was added/);
    const event = await prisma.payrollEvent.findFirst({ where: { subjectType: "RUN_APPROVAL", subjectId: runId, type: "FIGURES_CHANGED" } });
    expect(event?.actorUserId).toBe(world.maker.userId);
  }, 120_000);

  it("an approved run is voided the same way when a salary is revised", async () => {
    await resubmit();
    await approve(world, world.tokens.checkerA, runId, "run");
    expect((await runRow(runId)).status).toBe("APPROVED");
    await giveSalary(world, who("b"), "660000", "2026-08-16");
    await voidedFor(/a salary revision was applied/);
  }, 180_000);

  it("a rule edited while it waits voids the approval", async () => {
    await resubmit();
    await setRules(world.maker.userId, { PF_WAGE_CEILING: "16000" });
    await voidedFor(/a rule was edited/);
    await confirmAllPins(world, runId); // the edit made a placeholder; a second person confirms it so the road can go on
  }, 180_000);

  it("unlocking the attendance of a period payroll is waiting on voids the approval, and the warning says so first", async () => {
    await resubmit();
    await confirmAllPins(world, runId);
    await prisma.attendancePeriodLock.create({ data: { periodStart: day(CYCLE.start), periodEnd: day(CYCLE.end), action: "FINALISE", reason: "", lockedDays: 0, actorUserId: world.sup.userId } });
    try {
      const meta = { actorUserId: world.sup.userId, ipAddress: null, userAgent: null };
      const asRole = { roleCodes: ["SUPER_ADMIN"] };
      await expect(unlockCycle(CYCLE.start, CYCLE.end, { reason: "A day was found to be wrong", confirmPayrollConsumed: false }, asRole, meta)).rejects.toMatchObject({ code: "PAYROLL_CONSUMED", details: { stage: "SUBMITTED" } });
      expect((await runRow(runId)).status).toBe("SUBMITTED");
      await unlockCycle(CYCLE.start, CYCLE.end, { reason: "A day was found to be wrong", confirmPayrollConsumed: true }, asRole, meta);
      await voidedFor(/attendance for 2026-08-01 to 2026-08-31 was unlocked/);
    } finally {
      await deleteWithDependents("AttendancePeriodLock", (await prisma.attendancePeriodLock.findMany({ where: { periodStart: day(CYCLE.start) }, select: { id: true } })).map((r) => r.id));
      await purgeAppendOnly("AuditLog", { entityId: `${CYCLE.start}..${CYCLE.end}` });
      await prisma.dailyAttendance.updateMany({ where: { employeeId: { in: [who("a"), who("b")] } }, data: { isLocked: true } });
    }
  }, 180_000);

  it("a change nothing announces is still caught when the run is read: the approval is voided, not trusted", async () => {
    await resubmit();
    await approve(world, world.tokens.checkerA, runId, "run");
    await prisma.employee.update({ where: { id: who("b") }, data: { lastWorkingDate: day("2026-08-20") } }); // no screen of payroll did this
    const s = await state(world.tokens.maker, runId);
    expect(s.runStatus).toBe("CALCULATED");
    await voidedFor(/figures were changed/);
    await prisma.employee.update({ where: { id: who("b") }, data: { lastWorkingDate: null } });
  }, 180_000);

  it("a change nothing announces is caught by the next step even if nobody looked: deciding and finalising both refuse", async () => {
    await resubmit();
    await prisma.employee.update({ where: { id: who("b") }, data: { lastWorkingDate: day("2026-08-20") } });
    const hash = (await prisma.payrollApproval.findFirstOrThrow({ where: { subject: "RUN_APPROVAL", subjectId: runId, status: "PENDING" } })).contentHash;
    const decided = await step(world.tokens.checkerA, runId, "run", "decision", { decision: "APPROVE", hash });
    expect([decided.status, decided.body.error.code]).toEqual([409, "APPROVAL_VOIDED"]);
    await voidedFor(/changed/);
    await prisma.employee.update({ where: { id: who("b") }, data: { lastWorkingDate: null } });
    // Approved, then changed, then finalised without anyone looking in between.
    await resubmit();
    await approve(world, world.tokens.checkerA, runId, "run");
    await requestStep(world.tokens.maker, runId, "finalise");
    await approve(world, world.tokens.checkerB, runId, "finalise");
    await prisma.employee.update({ where: { id: who("b") }, data: { lastWorkingDate: day("2026-08-20") } });
    const done = await api(world.tokens.maker, "post", `/runs/${runId}/finalise`);
    expect([done.status, done.body.error.code]).toEqual([409, "APPROVAL_VOIDED"]);
    const run = await runRow(runId);
    expect(run.status).toBe("CALCULATED");
    expect(await prisma.payrollPeriodLock.count({ where: { runId } })).toBe(0);
    expect(await prisma.payrollApproval.count({ where: { subjectId: runId, status: { in: ["PENDING", "APPROVED", "CONSUMED"] } } })).toBe(0);
    await prisma.employee.update({ where: { id: who("b") }, data: { lastWorkingDate: null } });
  }, 240_000);

  it("a checker who changed the figures cannot approve them", async () => {
    await resubmit();
    // checkerB made a change after the run was submitted (recorded the way every payroll change is) ...
    await prisma.payrollEvent.create({ data: { subjectType: "RUN_APPROVAL", subjectId: runId, type: "FIGURES_CHANGED", actorUserId: world.checkerB.userId, payload: { what: "test" } } });
    const hash = (await stepOf(world.tokens.checkerB, runId, "run")).live!.hash;
    const r = await step(world.tokens.checkerB, runId, "run", "decision", { decision: "APPROVE", hash });
    expect([r.status, r.body.error.code]).toEqual([403, "CHECKER_EDITED_FIGURES"]);
    expect((await stepOf(world.tokens.checkerB, runId, "run")).you.canDecide).toBe(false);
    expect((await runRow(runId)).status).toBe("SUBMITTED");
  }, 120_000);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("a run in which nobody would be paid", () => {
  let world: Closing;
  let runId: string;
  beforeAll(async () => {
    world = await closingWorld(["lonely"]);
    await staffWith(world, ["lonely"]);
    await prisma.employeeBankAccount.updateMany({ where: { employeeId: world.named.lonely!.employeeId }, data: { effectiveTo: day("2026-08-15") } }); // no account on the payment date: held
    await setRules(world.maker.userId, REAL_RULES);
    runId = await calculateRun(world);
    await confirmAllPins(world, runId);
  }, 300_000);
  afterAll(async () => {
    resetSeams();
    await closeWorld(world);
  });

  it("is refused, with the held person listed and the reason given", async () => {
    const p = await step(world.tokens.maker, runId, "run", "preview");
    expect(p.body.blockers.map((b: { code: string }) => b.code)).toEqual(["NOTHING_TO_PAY"]);
    expect(p.body.held).toHaveLength(1);
    expect(p.body.held[0].code).toBe("NO_BANK_ACCOUNT");
    const r = await step(world.tokens.maker, runId, "run", "request", { fingerprint: p.body.fingerprint });
    expect([r.status, r.body.error.code]).toEqual([409, "NOTHING_TO_PAY"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("the half-year ESI rule cannot be confirmed while its question is open", () => {
  let world: RunWorld;
  beforeAll(async () => {
    world = await buildRunWorld(["x"]);
  }, 120_000);
  afterAll(async () => teardownRunWorld(world));

  it("shows the open question, refuses to confirm it whatever is typed, and lets the monthly rule be confirmed", async () => {
    await setRules(world.maker.userId, { ESI_PERIOD_RULE: "STICKY_HALF_YEAR" });
    const pre = await previewConfirm("ESI_PERIOD_RULE", world.checkerA.userId);
    expect(pre.blocked).toMatch(/cannot be confirmed yet/);
    expect(pre.blocked).toMatch(/CA/);
    const listed = (await api(world.tokens.maker, "get", "/rules/ESI_PERIOD_RULE")).body.rule;
    expect(listed.openQuestion).toMatchObject({ id: "ESI-HALF-YEAR" });
    await expect(confirmRule("ESI_PERIOD_RULE", { version: pre.version, typedValue: "STICKY_HALF_YEAR", note: "CA letter dated today, checked", fingerprint: pre.fingerprint }, { userId: world.checkerA.userId })).rejects.toMatchObject({ status: 409, code: "OPEN_QUESTION" });
    expect(await prisma.payrollItemConfirmation.count({ where: { kind: "RULE", key: "ESI_PERIOD_RULE", version: pre.version } })).toBe(0);
    // The question is about the half-year reading, so the monthly value is not held up by it.
    await setRules(world.maker.userId, { ESI_PERIOD_RULE: "MONTHLY" });
    const monthly = await previewConfirm("ESI_PERIOD_RULE", world.checkerA.userId);
    expect(monthly.blocked).toBeNull();
    await confirmRule("ESI_PERIOD_RULE", { version: monthly.version, typedValue: undefined, note: "checked against the CA's letter", fingerprint: monthly.fingerprint }, { userId: world.checkerA.userId });
    expect((await api(world.tokens.maker, "get", "/rules/ESI_PERIOD_RULE")).body.rule.status).toBe("CONFIRMED");
    expect((await api(world.tokens.maker, "get", "/rules/ESI_PERIOD_RULE")).body.rule.openQuestion).toBeNull();
  });
});
