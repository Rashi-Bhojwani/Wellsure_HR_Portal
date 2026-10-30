import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PayrollApprovalSubject } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { availabilityFrom, checkerAvailability, consume, decide, liveApproval, noteFiguresChanged, registerSubject, submit, unregisterSubjectForTests, voidLive } from "../approvals";
import { cleanupPayrollRowsBy, cleanupPayrollSubject } from "./payrollTestHelpers";
import "../rules/governed";

// The maker-checker core, tested once for the six subjects that later commits will wire to real figures (RULE_CONFIRM is exercised by rules.test.ts).
// The "figures" here are a number in a map that the test can change, standing for any input a real subject hashes.

const SUBJECTS: PayrollApprovalSubject[] = ["RUN_APPROVAL", "PERIOD_FINALISE", "PAYSLIP_PUBLISH", "BANK_FILE", "PERIOD_UNLOCK", "SALARY_REVISION"];
const figures = new Map<string, string>();

describe("maker-checker core", () => {
  let org: TestOrgMasters;
  const people: Record<string, { employeeId: string; userId: string; employeeCode: string }> = {};
  const prefix = `TEST-${randomUUID().slice(0, 8)}-`;
  let n = 0;
  const newId = () => `${prefix}${++n}`;

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    // D1 (docs/plans/DIRECTOR_AUTHORITY.md): the payroll roles are for directors, so the maker and the checkers are all Super Admins (three of them, so the
    // concurrency and exclusion cases still have someone left). An HR Admin is the person who is neither.
    people.maker = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    people.checkerA = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    people.checkerB = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    // Stage 0.3: the person who is both maker and checker holds BOTH payroll marker roles on top of Super Admin, not just one broad role.
    people.both = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    for (const code of ["PAYROLL_ADMIN", "PAYROLL_APPROVER"]) {
      const role = await prisma.role.findUniqueOrThrow({ where: { code } });
      await prisma.userRole.create({ data: { userId: people.both.userId, roleId: role.id } });
    }
    people.outsider = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    for (const s of SUBJECTS) {
      registerSubject({
        subject: s,
        makerPermission: "payroll.run",
        checkerPermission: "payroll.approve",
        describe: async (id) => id,
        hash: async (id) => `hash:${figures.get(id) ?? "missing"}`,
      });
    }
  });

  afterEach(() => figures.clear());

  afterAll(async () => {
    for (const s of SUBJECTS) unregisterSubjectForTests(s);
    await cleanupPayrollSubject(prefix);
    await cleanupPayrollRowsBy(Object.values(people).map((p) => p.userId));
    for (const p of new Set(Object.values(people))) await cleanupFullTestEmployee(p.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  const submitAs = (subject: PayrollApprovalSubject, subjectId: string, who = people.maker!) => submit({ subject, subjectId, makerUserId: who.userId, previewFingerprint: "payroll-hash-v1:preview" });

  describe.each(SUBJECTS)("%s", (subject) => {
    it("runs the whole lifecycle once: submit, a different person approves, the action consumes it, and it cannot be used twice", async () => {
      const id = newId();
      figures.set(id, "100.00");
      const a = await submitAs(subject, id);
      expect(a).toMatchObject({ status: "PENDING", contentHash: "hash:100.00", makerUserId: people.maker!.userId });
      const d = await decide({ approvalId: a.id, checkerUserId: people.checkerA!.userId, decision: "APPROVE", note: "looks right" });
      expect(d).toMatchObject({ status: "APPROVED", checkerUserId: people.checkerA!.userId, hashAtDecision: "hash:100.00" });
      const used = await consume(subject, id, people.maker!.userId);
      expect(used.status).toBe("CONSUMED");
      await expect(consume(subject, id, people.maker!.userId)).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
      const events = await prisma.payrollEvent.findMany({ where: { subjectType: subject, subjectId: id }, orderBy: { seq: "asc" } });
      expect(events.map((e) => e.type)).toEqual(["SUBMITTED", "APPROVED", "CONSUMED"]);
      expect(events.every((e) => (e.payload as { hash?: string }).hash === "hash:100.00")).toBe(true);
    });

    it("is voided by any change to the figures: before the decision, and after it", async () => {
      const early = newId();
      figures.set(early, "1");
      const a1 = await submitAs(subject, early);
      figures.set(early, "2"); // the figures move before the checker acts
      await expect(decide({ approvalId: a1.id, checkerUserId: people.checkerA!.userId, decision: "APPROVE" })).rejects.toMatchObject({ code: "APPROVAL_VOIDED" });
      expect((await prisma.payrollApproval.findUniqueOrThrow({ where: { id: a1.id } })).status).toBe("VOIDED");

      const late = newId();
      figures.set(late, "1");
      const a2 = await submitAs(subject, late);
      await decide({ approvalId: a2.id, checkerUserId: people.checkerA!.userId, decision: "APPROVE" });
      figures.set(late, "1.01"); // one paisa, after approval
      await expect(consume(subject, late, people.maker!.userId)).rejects.toMatchObject({ code: "APPROVAL_VOIDED" });
      const voided = await prisma.payrollApproval.findUniqueOrThrow({ where: { id: a2.id } });
      expect(voided).toMatchObject({ status: "VOIDED", voidReason: expect.stringMatching(/no longer match/) });
      await expect(consume(subject, late, people.maker!.userId)).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    });
  });

  it("only a director can submit and only a director can decide: an HR Admin can do neither", async () => {
    const id = newId();
    figures.set(id, "5");
    await expect(submit({ subject: "RUN_APPROVAL", subjectId: id, makerUserId: people.outsider!.userId, previewFingerprint: "x" })).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    const a = await submitAs("RUN_APPROVAL", id);
    await expect(decide({ approvalId: a.id, checkerUserId: people.outsider!.userId, decision: "APPROVE" })).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
  });

  describe.each(SUBJECTS)("%s: the checker is never the maker, even for someone who holds both payroll roles", (subject) => {
    it("refuses in the code and in the database, and a different person can still decide", async () => {
      const id = newId();
      figures.set(id, "5");
      const a = await submitAs(subject, id, people.both!);
      await expect(decide({ approvalId: a.id, checkerUserId: people.both!.userId, decision: "APPROVE" })).rejects.toMatchObject({ status: 403, code: "CHECKER_IS_MAKER" });
      await expect(decide({ approvalId: a.id, checkerUserId: people.both!.userId, decision: "REJECT", note: "my own" })).rejects.toMatchObject({ code: "CHECKER_IS_MAKER" });
      // And the database refuses it whatever the code does.
      await expect(prisma.payrollApproval.update({ where: { id: a.id }, data: { status: "APPROVED", checkerUserId: people.both!.userId, hashAtDecision: a.contentHash, decidedAt: new Date() } })).rejects.toThrow(/payroll_approvals_checker_not_maker/);
      const ok = await decide({ approvalId: a.id, checkerUserId: people.checkerA!.userId, decision: "APPROVE" });
      expect(ok.status).toBe("APPROVED");
    });
  });

  it("nobody who changed the figures since submission can be the checker", async () => {
    const id = newId();
    figures.set(id, "5");
    const a = await submitAs("BANK_FILE", id);
    await prisma.payrollEvent.create({ data: { subjectType: "BANK_FILE", subjectId: id, type: "FIGURES_CHANGED", actorUserId: people.checkerA!.userId, payload: { what: "edited a line" } } });
    await expect(decide({ approvalId: a.id, checkerUserId: people.checkerA!.userId, decision: "APPROVE" })).rejects.toMatchObject({ code: "CHECKER_EDITED_FIGURES" });
    const ok = await decide({ approvalId: a.id, checkerUserId: people.checkerB!.userId, decision: "APPROVE" });
    expect(ok.status).toBe("APPROVED");
    // The exclusion is visible, not silent.
    const seen = await checkerAvailability("BANK_FILE", { makerUserId: people.maker!.userId, subjectId: id, since: a.submittedAt });
    expect(seen.excluded).toEqual(expect.arrayContaining([expect.objectContaining({ userId: people.checkerA!.userId, reason: "changed these figures" })]));
    expect(seen.eligible.map((e) => e.userId)).not.toContain(people.checkerA!.userId);
  });

  it("a rejection needs a reason, ends it, and a fresh submission is then allowed", async () => {
    const id = newId();
    figures.set(id, "5");
    const a = await submitAs("PAYSLIP_PUBLISH", id);
    await expect(decide({ approvalId: a.id, checkerUserId: people.checkerA!.userId, decision: "REJECT", note: "no" })).rejects.toMatchObject({ status: 400 });
    const r = await decide({ approvalId: a.id, checkerUserId: people.checkerA!.userId, decision: "REJECT", note: "the October total is wrong" });
    expect(r).toMatchObject({ status: "REJECTED", decisionNote: "the October total is wrong" });
    await expect(decide({ approvalId: a.id, checkerUserId: people.checkerB!.userId, decision: "APPROVE" })).rejects.toMatchObject({ code: "APPROVAL_NOT_PENDING" });
    expect((await submitAs("PAYSLIP_PUBLISH", id)).status).toBe("PENDING");
  });

  it("only one live approval per thing; voiding it frees the slot", async () => {
    const id = newId();
    figures.set(id, "5");
    await submitAs("PERIOD_FINALISE", id);
    await expect(submitAs("PERIOD_FINALISE", id)).rejects.toMatchObject({ code: "APPROVAL_ALREADY_LIVE" });
    expect(await voidLive("PERIOD_FINALISE", id, "withdrawn by the maker", people.maker!.userId)).toBe(true);
    expect(await liveApproval("PERIOD_FINALISE", id)).toBeNull();
    expect((await submitAs("PERIOD_FINALISE", id)).status).toBe("PENDING");
  });

  it("noteFiguresChanged records who did it and voids a live approval at once, pending or approved", async () => {
    for (const approveFirst of [false, true]) {
      const id = newId();
      figures.set(id, "5");
      const a = await submitAs("SALARY_REVISION", id);
      if (approveFirst) await decide({ approvalId: a.id, checkerUserId: people.checkerA!.userId, decision: "APPROVE" });
      const r = await noteFiguresChanged("SALARY_REVISION", id, people.maker!.userId, "added an adjustment");
      expect(r.voided).toBe(true);
      expect(await prisma.payrollApproval.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ status: "VOIDED", voidReason: "The figures were changed: added an adjustment" });
      const types = (await prisma.payrollEvent.findMany({ where: { subjectType: "SALARY_REVISION", subjectId: id }, orderBy: { seq: "asc" } })).map((e) => e.type);
      expect(types).toContain("FIGURES_CHANGED");
      expect(types).toContain("VOIDED");
    }
    // Changing figures when nothing is live is still recorded (the editor cannot later check).
    const quiet = newId();
    expect((await noteFiguresChanged("SALARY_REVISION", quiet, people.maker!.userId, "edit")).voided).toBe(false);
  });

  it("two checkers deciding at the same moment: exactly one decision is recorded", async () => {
    const id = newId();
    figures.set(id, "5");
    const a = await submitAs("RUN_APPROVAL", id);
    const results = await Promise.allSettled([
      decide({ approvalId: a.id, checkerUserId: people.checkerA!.userId, decision: "APPROVE" }),
      decide({ approvalId: a.id, checkerUserId: people.checkerB!.userId, decision: "REJECT", note: "I disagree" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const final = await prisma.payrollApproval.findUniqueOrThrow({ where: { id: a.id } });
    expect(["APPROVED", "REJECTED"]).toContain(final.status);
  });

  it("the database keeps the record straight whatever the code does", async () => {
    const id = newId();
    figures.set(id, "5");
    const a = await submitAs("PERIOD_UNLOCK", id);
    await decide({ approvalId: a.id, checkerUserId: people.checkerA!.userId, decision: "APPROVE" });
    await consume("PERIOD_UNLOCK", id, people.maker!.userId);
    await expect(prisma.payrollApproval.update({ where: { id: a.id }, data: { status: "APPROVED" } })).rejects.toThrow(/PAYROLL_APPROVAL_TRANSITION/);
    await expect(prisma.payrollApproval.update({ where: { id: a.id }, data: { contentHash: "other" } })).rejects.toThrow(/PAYROLL_APPROVAL_IMMUTABLE/);
    await expect(prisma.payrollApproval.update({ where: { id: a.id }, data: { checkerUserId: people.checkerB!.userId } })).rejects.toThrow(/PAYROLL_APPROVAL_IMMUTABLE/);
    await expect(prisma.payrollApproval.delete({ where: { id: a.id } })).rejects.toThrow(/PAYROLL_APPROVAL_APPEND_ONLY/);
    const event = await prisma.payrollEvent.findFirstOrThrow({ where: { subjectId: id } });
    await expect(prisma.payrollEvent.update({ where: { id: event.id }, data: { type: "X" } })).rejects.toThrow(/PAYROLL_EVENT_APPEND_ONLY/);
    await expect(prisma.payrollEvent.delete({ where: { id: event.id } })).rejects.toThrow(/PAYROLL_EVENT_APPEND_ONLY/);
  });

  it("writes an audit row for every step, with the hash", async () => {
    const id = newId();
    figures.set(id, "7");
    const a = await submitAs("RUN_APPROVAL", id);
    await decide({ approvalId: a.id, checkerUserId: people.checkerA!.userId, decision: "APPROVE" });
    await consume("RUN_APPROVAL", id, people.maker!.userId);
    const rows = await prisma.auditLog.findMany({ where: { entityType: "PayrollApproval", entityId: a.id }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.action)).toEqual(["payroll.approval.submitted", "payroll.approval.approved", "payroll.approval.consumed"]);
    expect((rows[0]!.after as { hash: string }).hash).toBe("hash:7");
  });
});

describe("who can check is visible", () => {
  const holders = (...names: string[]) => names.map((name) => ({ userId: `u-${name}`, name }));

  it("says who, when several can", () => {
    const a = availabilityFrom(holders("Asha", "Bhaskar", "Chitra"), { makerUserId: "u-Asha" });
    expect(a.state).toBe("MANY");
    expect(a.eligible.map((e) => e.name)).toEqual(["Bhaskar", "Chitra"]);
    expect(a.excluded).toEqual([{ userId: "u-Asha", name: "Asha", reason: "prepared this" }]);
    expect(a.message).toBe("2 people can approve this: Bhaskar, Chitra.");
  });

  it("with exactly one eligible checker, names them and says everything depends on them", () => {
    const a = availabilityFrom(holders("Asha", "Bhaskar"), { makerUserId: "u-Asha" });
    expect(a.state).toBe("ONE");
    expect(a.message).toContain("Only Bhaskar can approve this");
    expect(a.message).toContain("appoint another checker");
  });

  it("with nobody eligible, says so and why, and that there is no way around it", () => {
    const a = availabilityFrom(holders("Asha"), { makerUserId: "u-Asha" });
    expect(a.state).toBe("NONE");
    expect(a.message).toContain("Nobody can approve this right now (Asha prepared this)");
    expect(a.message).toContain("no way around this step");
    const none = availabilityFrom([], {});
    expect(none.state).toBe("NONE");
    const edited = availabilityFrom(holders("Asha", "Bhaskar"), { makerUserId: "u-Asha", editors: new Set(["u-Bhaskar"]) });
    expect(edited.state).toBe("NONE");
    expect(edited.message).toContain("Bhaskar changed these figures");
  });
});
