import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PayrollApprovalSubject } from "@prisma/client";
import { DIRECTOR_AUTHORITY_SETTING_KEY, DIRECTOR_STEPS, DIRECTOR_STEP_INFO } from "@shared/constants/directorAuthority";
import { purgeAppendOnly, deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { with2faFloor } from "../../../lib/authDefaults";
import { authorityFor, getSwitches, requireDirectorTwoFactor, setSwitch } from "../../../lib/directorAuthority";
import { acknowledgeNotice, deliverDirectorNotice, listMyNotices, sweepDirectorNotices } from "../../../lib/directorNotices";
import { resolveAccess } from "../../../lib/permissions";
import { prisma } from "../../../lib/prisma";
import { mailService } from "../../../integrations/mail";
import { assignRole, listSecurityEvents, removeRole, setOverride } from "../../access/service";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, cleanupTestRole, createEmployeeTestOrgMasters, createFullTestEmployee, grantPermissions, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { authorise, consume, decide, recordCompletedApproval, registerSubject, submit, unregisterSubjectForTests } from "../approvals";
import { cleanupPayrollRowsBy, cleanupPayrollSubject } from "./payrollTestHelpers";

// Director authority, the core (D1, docs/plans/DIRECTOR_AUTHORITY.md): one director prepares and decides in one act and it takes effect at once; the other director is
// told, in the same transaction; a second-director check can be switched back on per step; the payroll roles are for directors only; two-step sign-in is required of
// every director outside development. The payroll flows themselves are switched over in D2, so this proves the core on a fabricated subject.

const SUBJECT: PayrollApprovalSubject = "BANK_FILE";
type Person = { employeeId: string; userId: string; employeeCode: string };

describe("director authority", () => {
  let org: TestOrgMasters;
  const p = {} as Record<"a" | "b" | "hr" | "emp", Person>;
  const prefix = `TEST-${randomUUID().slice(0, 8)}-`;
  let n = 0;
  const newId = () => `${prefix}${++n}`;
  const figures = new Map<string, string>();
  const affected = new Set<string>();
  let onHash: (() => Promise<void>) | null = null;
  const noticeIds: string[] = [];
  const extraUserIds: string[] = [];

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    p.a = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.b = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.emp = await createFullTestEmployee(org, { roleCode: "EMPLOYEE" });
    registerSubject({
      subject: SUBJECT,
      makerPermission: "payroll.run",
      checkerPermission: "payroll.approve",
      describe: async (id) => id,
      hash: async (id) => {
        await onHash?.();
        return `hash:${figures.get(id) ?? "missing"}`;
      },
      affectedUserIds: async () => [...affected],
    });
  });

  afterEach(async () => {
    figures.clear();
    affected.clear();
    onHash = null;
    vi.restoreAllMocks();
    await prisma.systemSetting.deleteMany({ where: { key: DIRECTOR_AUTHORITY_SETTING_KEY } });
  });

  afterAll(async () => {
    unregisterSubjectForTests(SUBJECT);
    await cleanupPayrollSubject(prefix);
    const users = [...Object.values(p).map((x) => x.userId), ...extraUserIds];
    // Everything these directors' acts wrote: notices (and receipts), the banners raised for them, the approvals and events.
    const mine = await prisma.directorActionNotice.findMany({ where: { actorUserId: { in: users } }, select: { id: true } });
    await deleteWithDependents("DirectorActionNotice", [...new Set([...noticeIds, ...mine.map((x) => x.id)])]);
    await purgeAppendOnly("SecurityEvent", { targetUserId: { in: users } });
    await purgeAppendOnly("AuditLog", { OR: [{ entityId: DIRECTOR_AUTHORITY_SETTING_KEY }, { actorUserId: { in: users } }] });
    await cleanupPayrollRowsBy(users);
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  const act = (who: Person, id: string, extra: Partial<Parameters<typeof authorise>[0]> = {}) =>
    authorise({ subject: SUBJECT, subjectId: id, actorUserId: who.userId, previewFingerprint: "payroll-hash-v1:preview", step: "BANK_FILE", subjectLabel: "the bank file for a test month", itemCount: 7, ...extra });

  describe("the switches", () => {
    it("every step starts OFF: a director acts alone", async () => {
      const switches = await getSwitches();
      expect(Object.keys(switches).sort()).toEqual([...DIRECTOR_STEPS].sort());
      expect(Object.values(switches).every((on) => on === false)).toBe(true);
      expect(await authorityFor("BANK_FILE")).toBe("DIRECTOR_AUTHORITY");
    });

    it("has words for every step, and says what it covers", () => {
      for (const s of DIRECTOR_STEPS) expect(DIRECTOR_STEP_INFO[s].label.length > 3 && DIRECTOR_STEP_INFO[s].covers.length > 20, s).toBe(true);
    });

    it("either director can switch any step either way at once: audited, the other told, a red banner raised for them", async () => {
      const r = await setSwitch("PERIOD_UNLOCK", true, { userId: p.a.userId });
      expect(r.changed).toBe(true);
      noticeIds.push(r.noticeId!);
      expect((await getSwitches()).PERIOD_UNLOCK).toBe(true);
      expect(await authorityFor("PERIOD_UNLOCK")).toBe("SECOND_DIRECTOR");
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "director.switch.changed", actorUserId: p.a.userId }, orderBy: { createdAt: "desc" } });
      expect(audit.after).toMatchObject({ step: "PERIOD_UNLOCK", requireSecondDirector: true });
      const notice = await prisma.directorActionNotice.findUniqueOrThrow({ where: { id: r.noticeId! }, include: { receipts: true } });
      expect(notice).toMatchObject({ kind: "SWITCH_CHANGED", step: "PERIOD_UNLOCK", actorUserId: p.a.userId });
      expect(notice.receipts.map((x) => x.recipientUserId)).toContain(p.b.userId);
      expect(notice.receipts.map((x) => x.recipientUserId)).not.toContain(p.a.userId);
      const banner = await prisma.securityEvent.findFirstOrThrow({ where: { kind: "director.switch_changed", targetUserId: p.a.userId, acknowledgedAt: null } });
      expect(banner.details).toMatchObject({ noticeId: r.noticeId });
      // The other director is shown the banner; the one who acted is not shown a banner about their own act.
      const viewer = async (who: Person) => {
        const access = await resolveAccess(who.userId);
        return { userId: who.userId, employeeId: who.employeeId, roleCodes: access.roleCodes, permissions: access.permissions, dataScope: access.dataScope };
      };
      expect((await listSecurityEvents(await viewer(p.b), "open")).map((e) => e.id)).toContain(banner.id);
      expect((await listSecurityEvents(await viewer(p.a), "open")).map((e) => e.id)).not.toContain(banner.id);
      // The other way, by the other director, at once.
      const back = await setSwitch("PERIOD_UNLOCK", false, { userId: p.b.userId });
      noticeIds.push(back.noticeId!);
      expect((await getSwitches()).PERIOD_UNLOCK).toBe(false);
    });

    it("changing it to what it already is changes nothing and tells nobody", async () => {
      const r = await setSwitch("RUN_APPROVAL", false, { userId: p.a.userId });
      expect(r).toEqual({ changed: false, noticeId: null });
    });

    it("only a director can change it", async () => {
      await expect(setSwitch("BANK_FILE", true, { userId: p.hr.userId })).rejects.toMatchObject({ status: 403, code: "DIRECTOR_ONLY" });
      await expect(setSwitch("BANK_FILE", true, { userId: p.emp.userId })).rejects.toMatchObject({ status: 403, code: "DIRECTOR_ONLY" });
      expect((await getSwitches()).BANK_FILE).toBe(false);
    });
  });

  describe("acting on director authority", () => {
    it("is one act: prepared and decided by the same director, recorded as such, then carried out; the notice goes to the other director only", async () => {
      const id = newId();
      figures.set(id, "100.00");
      const a = await act(p.a, id);
      expect(a).toMatchObject({ status: "APPROVED", authority: "DIRECTOR_AUTHORITY", makerUserId: p.a.userId, checkerUserId: p.a.userId, contentHash: "hash:100.00", hashAtDecision: "hash:100.00" });
      const events = await prisma.payrollEvent.findMany({ where: { subjectType: SUBJECT, subjectId: id }, orderBy: { seq: "asc" } });
      expect(events.map((e) => e.type)).toEqual(["SUBMITTED", "APPROVED"]);
      expect(events.every((e) => (e.payload as { authority?: string }).authority === "DIRECTOR_AUTHORITY")).toBe(true);
      expect((await consume(SUBJECT, id, p.a.userId)).status).toBe("CONSUMED");
      expect((await prisma.auditLog.findFirstOrThrow({ where: { action: "payroll.approval.authorised", entityId: a.id } })).after).toMatchObject({ step: "BANK_FILE", hash: "hash:100.00", authority: "DIRECTOR_AUTHORITY" });

      const notice = await prisma.directorActionNotice.findFirstOrThrow({ where: { approvalId: a.id }, include: { receipts: true } });
      noticeIds.push(notice.id);
      expect(notice).toMatchObject({ kind: "ACTION", step: "BANK_FILE", actorUserId: p.a.userId, authority: "DIRECTOR_AUTHORITY", itemCount: 7 });
      expect(notice.receipts.map((r) => r.recipientUserId)).toContain(p.b.userId);
      expect(notice.receipts.map((r) => r.recipientUserId)).not.toContain(p.a.userId);
      expect(notice.receipts.map((r) => r.recipientUserId)).not.toContain(p.hr.userId); // not HR, not an employee
    });

    it("the notice carries counts only: no amount, no name, in the row, the bell or the e-mail", async () => {
      const id = newId();
      figures.set(id, "98765.43");
      const send = vi.spyOn(mailService, "send").mockResolvedValue(undefined as never);
      const a = await act(p.a, id, { itemCount: 12 });
      const notice = await prisma.directorActionNotice.findFirstOrThrow({ where: { approvalId: a.id } });
      noticeIds.push(notice.id);
      await deliverDirectorNotice(notice.id);
      const mine = await prisma.notification.findMany({ where: { userId: p.b.userId, type: "director.action" }, orderBy: { createdAt: "desc" }, take: 1 });
      const everything = JSON.stringify([notice, mine, send.mock.calls]);
      expect(everything).not.toContain("98765");
      expect(everything).not.toContain("hash:");
      for (const person of Object.values(p)) expect(everything).not.toContain(person.employeeCode);
      expect(notice.subjectLabel).toBe("the bank file for a test month");
      expect(notice.itemCount).toBe(12);
    });

    it("refuses anyone who is not a director: an HR Admin, an employee", async () => {
      const id = newId();
      figures.set(id, "1");
      await expect(act(p.hr, id)).rejects.toMatchObject({ status: 403 });
      await expect(act(p.emp, id)).rejects.toMatchObject({ status: 403 });
      expect(await prisma.payrollApproval.count({ where: { subjectId: id } })).toBe(0);
      expect(await prisma.directorActionNotice.count({ where: { subjectId: id } })).toBe(0);
    });

    it("refuses somebody who holds the payroll permissions without being a director (a custom role that carries them), at every door", async () => {
      const role = `TEST_PAYROLL_KEYS_${randomUUID().slice(0, 6)}`;
      await grantPermissions(role, ["payroll.run", "payroll.approve", "payroll.unlock"]);
      const x = await createFullTestEmployee(org, { roleCode: role });
      extraUserIds.push(x.userId);
      try {
        const id = newId();
        figures.set(id, "1");
        await expect(act(x, id)).rejects.toMatchObject({ status: 403, code: "DIRECTOR_ONLY" }); // acting alone
        await expect(submit({ subject: SUBJECT, subjectId: id, makerUserId: x.userId, previewFingerprint: "x" })).rejects.toMatchObject({ status: 403, code: "DIRECTOR_ONLY" }); // preparing
        const live = await submit({ subject: SUBJECT, subjectId: id, makerUserId: p.a.userId, previewFingerprint: "x" });
        await expect(decide({ approvalId: live.id, checkerUserId: x.userId, decision: "APPROVE" })).rejects.toMatchObject({ status: 403, code: "DIRECTOR_ONLY" }); // deciding
        expect((await prisma.payrollApproval.findUniqueOrThrow({ where: { id: live.id } })).status).toBe("PENDING");
      } finally {
        await cleanupFullTestEmployee(x.employeeId);
        await cleanupTestRole(role);
      }
    });

    it("refuses when the step needs a second director, and writes nothing", async () => {
      const r = await setSwitch("BANK_FILE", true, { userId: p.b.userId });
      noticeIds.push(r.noticeId!);
      const id = newId();
      figures.set(id, "1");
      await expect(act(p.a, id)).rejects.toMatchObject({ status: 409, code: "SECOND_DIRECTOR_REQUIRED" });
      expect(await prisma.payrollApproval.count({ where: { subjectId: id } })).toBe(0);
      expect(await prisma.directorActionNotice.count({ where: { subjectId: id } })).toBe(0);
    });

    it("reads the switch inside the transaction: one flipped after the checks, before the write, still wins", async () => {
      const id = newId();
      figures.set(id, "1");
      onHash = async () => {
        await prisma.systemSetting.upsert({ where: { key: DIRECTOR_AUTHORITY_SETTING_KEY }, create: { key: DIRECTOR_AUTHORITY_SETTING_KEY, value: { BANK_FILE: true }, updatedByUserId: null }, update: { value: { BANK_FILE: true } } });
      };
      await expect(act(p.a, id)).rejects.toMatchObject({ code: "SECOND_DIRECTOR_REQUIRED" });
    });

    it("keeps the hash binding: the figures changing before the act is carried out voids it", async () => {
      const id = newId();
      figures.set(id, "1.00");
      await act(p.a, id);
      figures.set(id, "1.01");
      await expect(consume(SUBJECT, id, p.a.userId)).rejects.toMatchObject({ code: "APPROVAL_VOIDED" });
      expect((await prisma.payrollApproval.findFirstOrThrow({ where: { subjectId: id } })).status).toBe("VOIDED");
    });

    it("never lets a director change their own pay, on director authority either", async () => {
      const id = newId();
      figures.set(id, "5");
      affected.add(p.a.userId);
      await expect(act(p.a, id)).rejects.toMatchObject({ status: 403, code: "MAKER_IS_AFFECTED" });
      const ok = await act(p.b, id); // the other director can
      expect(ok.authority).toBe("DIRECTOR_AUTHORITY");
      const note = await prisma.directorActionNotice.findFirstOrThrow({ where: { approvalId: ok.id }, include: { receipts: true } });
      noticeIds.push(note.id);
      expect(note.receipts.map((r) => r.recipientUserId)).toContain(p.a.userId); // the affected director is the one who is told
    });

    it("a second act on the same thing waits for the first to be used", async () => {
      const id = newId();
      figures.set(id, "1");
      await act(p.a, id);
      await expect(act(p.b, id)).rejects.toMatchObject({ code: "APPROVAL_ALREADY_LIVE" });
    });
  });

  describe("the database keeps this straight whatever the code does", () => {
    const raw = (over: Record<string, unknown>) =>
      prisma.payrollApproval.create({ data: { subject: SUBJECT, subjectId: newId(), contentHash: "h", makerUserId: p.a.userId, previewFingerprint: "x", ...over } as never });

    it("refuses director authority from someone who is not a Super Admin", async () => {
      await expect(raw({ makerUserId: p.hr.userId, authority: "DIRECTOR_AUTHORITY" })).rejects.toThrow(/DIRECTOR_AUTHORITY_NOT_SUPER_ADMIN/);
    });

    it("refuses a checker equal to the maker unless it is director authority, and a second person under director authority", async () => {
      const a = await raw({});
      await expect(prisma.payrollApproval.update({ where: { id: a.id }, data: { status: "APPROVED", checkerUserId: p.a.userId, hashAtDecision: "h", decidedAt: new Date() } })).rejects.toThrow(/checker_not_maker/);
      const d = await raw({ authority: "DIRECTOR_AUTHORITY" });
      await expect(prisma.payrollApproval.update({ where: { id: d.id }, data: { status: "APPROVED", checkerUserId: p.b.userId, hashAtDecision: "h", decidedAt: new Date() } })).rejects.toThrow(/authority_single_actor/);
      const ok = await prisma.payrollApproval.update({ where: { id: d.id }, data: { status: "APPROVED", checkerUserId: p.a.userId, hashAtDecision: "h", decidedAt: new Date() } });
      expect(ok.status).toBe("APPROVED");
    });

    it("never changes the authority an approval was made under", async () => {
      const a = await raw({});
      await expect(prisma.payrollApproval.update({ where: { id: a.id }, data: { authority: "DIRECTOR_AUTHORITY" } })).rejects.toThrow(/PAYROLL_APPROVAL_IMMUTABLE/);
      // Not even as part of a legal move: a second-director approval cannot become a director-authority one while it is being decided (that would let the maker decide it).
      await expect(
        prisma.payrollApproval.update({ where: { id: a.id }, data: { status: "APPROVED", checkerUserId: p.a.userId, hashAtDecision: "h", decidedAt: new Date(), authority: "DIRECTOR_AUTHORITY" } }),
      ).rejects.toThrow(/PAYROLL_APPROVAL_IMMUTABLE/);
    });

    it("a confirmation by the author is refused unless the row says it is self-confirmed AND the author is a Super Admin; and the row cannot say so otherwise", async () => {
      const key = `TEST_${randomUUID().slice(0, 8)}`;
      const version = async (author: Person, v: number) => prisma.payrollItemVersion.create({ data: { kind: "RULE", key, version: v, value: 1, valueHash: `vh${v}`, authorUserId: author.userId } });
      await version(p.a, 1);
      const confirm = (by: Person, v: number, selfConfirmed: boolean) => prisma.payrollItemConfirmation.create({ data: { kind: "RULE", key, version: v, valueHash: `vh${v}`, confirmedByUserId: by.userId, selfConfirmed } });
      await expect(confirm(p.a, 1, false)).rejects.toThrow(/PAYROLL_CONFIRM_SAME_PERSON/);
      await expect(confirm(p.b, 1, true)).rejects.toThrow(/PAYROLL_CONFIRM_SELF_MISMATCH/);
      expect((await confirm(p.a, 1, true)).selfConfirmed).toBe(true);
      await version(p.hr, 2);
      await expect(confirm(p.hr, 2, true)).rejects.toThrow(/PAYROLL_CONFIRM_SELF_NOT_DIRECTOR/);
      expect((await confirm(p.b, 2, false)).selfConfirmed).toBe(false);
    });

    it("recordCompletedApproval: the same person confirms only on director authority, and only a director confirms", async () => {
      const input = { subject: "RULE_CONFIRM" as const, subjectId: `${prefix}${newId()}@1`, hash: "h", makerUserId: p.a.userId, checkerUserId: p.a.userId, previewFingerprint: "x", note: "n" };
      await expect(recordCompletedApproval(input, prisma)).rejects.toMatchObject({ code: "CHECKER_IS_MAKER" });
      const ok = await recordCompletedApproval({ ...input, authority: "DIRECTOR_AUTHORITY" }, prisma);
      expect(ok).toMatchObject({ status: "CONSUMED", authority: "DIRECTOR_AUTHORITY" });
      await expect(recordCompletedApproval({ ...input, subjectId: `${prefix}${newId()}@1`, makerUserId: p.hr.userId, checkerUserId: p.hr.userId, authority: "DIRECTOR_AUTHORITY" }, prisma)).rejects.toMatchObject({ code: "DIRECTOR_ONLY" });
    });

    it("notices and receipts are append-only", async () => {
      const r = await setSwitch("SETTINGS", true, { userId: p.a.userId });
      noticeIds.push(r.noticeId!);
      await expect(prisma.directorActionNotice.update({ where: { id: r.noticeId! }, data: { subjectLabel: "x" } })).rejects.toThrow(/DIRECTOR_NOTICE_APPEND_ONLY/);
      await expect(prisma.directorActionNotice.delete({ where: { id: r.noticeId! } })).rejects.toThrow(/DIRECTOR_NOTICE_APPEND_ONLY/);
      const receipt = await prisma.directorActionReceipt.findFirstOrThrow({ where: { noticeId: r.noticeId!, recipientUserId: p.b.userId } });
      await prisma.directorActionReceipt.update({ where: { id: receipt.id }, data: { seenAt: new Date() } });
      await expect(prisma.directorActionReceipt.update({ where: { id: receipt.id }, data: { seenAt: new Date(0) } })).rejects.toThrow(/DIRECTOR_NOTICE_APPEND_ONLY/);
      await expect(prisma.directorActionReceipt.update({ where: { id: receipt.id }, data: { recipientUserId: p.hr.userId } })).rejects.toThrow(/DIRECTOR_NOTICE_APPEND_ONLY/);
      await expect(prisma.directorActionReceipt.delete({ where: { id: receipt.id } })).rejects.toThrow(/DIRECTOR_NOTICE_APPEND_ONLY/);
    });
  });

  describe("delivery, acknowledgement and the red banner", () => {
    const newNotice = async () => {
      const id = newId();
      figures.set(id, "1");
      const a = await act(p.a, id);
      const notice = await prisma.directorActionNotice.findFirstOrThrow({ where: { approvalId: a.id } });
      noticeIds.push(notice.id);
      return notice;
    };

    it("delivers a bell and an e-mail, and records each once", async () => {
      const send = vi.spyOn(mailService, "send").mockResolvedValue(undefined as never);
      const notice = await newNotice();
      await deliverDirectorNotice(notice.id);
      const receipt = await prisma.directorActionReceipt.findFirstOrThrow({ where: { noticeId: notice.id, recipientUserId: p.b.userId } });
      expect(receipt.deliveredAt).not.toBeNull();
      expect(receipt.emailedAt).not.toBeNull();
      expect(send.mock.calls.length).toBeGreaterThan(0);
      const calls = send.mock.calls.length;
      await deliverDirectorNotice(notice.id); // nothing left to do: no second e-mail
      expect(send.mock.calls.length).toBe(calls);
    });

    it("a failed e-mail is recorded and retried; it never undoes the act", async () => {
      const send = vi.spyOn(mailService, "send").mockRejectedValue(new Error("smtp down"));
      const notice = await newNotice();
      await expect(deliverDirectorNotice(notice.id)).rejects.toThrow(/delivery failure/);
      const failed = await prisma.directorActionReceipt.findFirstOrThrow({ where: { noticeId: notice.id, recipientUserId: p.b.userId } });
      expect(failed.failedReason).toMatch(/smtp down/);
      expect(failed.deliveredAt).not.toBeNull(); // the bell still went
      expect(failed.emailedAt).toBeNull();
      expect((await prisma.payrollApproval.findUniqueOrThrow({ where: { id: notice.approvalId! } })).status).toBe("APPROVED");
      send.mockResolvedValue(undefined as never);
      await deliverDirectorNotice(notice.id);
      expect((await prisma.directorActionReceipt.findFirstOrThrow({ where: { id: failed.id } })).emailedAt).not.toBeNull();
    });

    it("the other director sees it, can mark it seen and acknowledge it (saying what they checked); the one who acted has nothing to acknowledge", async () => {
      const notice = await newNotice();
      expect((await listMyNotices(p.b.userId, "open")).map((x) => x.id)).toContain(notice.id);
      expect((await listMyNotices(p.a.userId, "open")).map((x) => x.id)).not.toContain(notice.id);
      await expect(acknowledgeNotice(notice.id, p.b.userId, "ok")).rejects.toMatchObject({ status: 400 });
      await expect(acknowledgeNotice(notice.id, p.a.userId, "I did this myself")).rejects.toMatchObject({ status: 404 });
      await acknowledgeNotice(notice.id, p.b.userId, "checked the file against the run");
      expect((await listMyNotices(p.b.userId, "open")).map((x) => x.id)).not.toContain(notice.id);
      expect((await prisma.auditLog.findFirstOrThrow({ where: { action: "director.notice.acknowledged", entityId: notice.id } })).actorUserId).toBe(p.b.userId);
    });

    it("an HR Admin has no notices and cannot read them", async () => {
      await expect(listMyNotices(p.hr.userId, "open")).rejects.toMatchObject({ code: "DIRECTOR_ONLY" });
    });

    it("left unacknowledged for 3 days it raises a red banner once; acknowledging clears it; no extra e-mail", async () => {
      const send = vi.spyOn(mailService, "send").mockResolvedValue(undefined as never);
      const notice = await newNotice();
      await deliverDirectorNotice(notice.id);
      const sentBefore = send.mock.calls.length;
      const fresh = await sweepDirectorNotices(new Date(Date.now() + 2 * 24 * 3600 * 1000)); // allow-clock: a test instant
      expect(fresh.escalated).toBe(0);
      const late = await sweepDirectorNotices(new Date(Date.now() + 3 * 24 * 3600 * 1000 + 60_000)); // allow-clock: a test instant
      expect(late.escalated).toBeGreaterThanOrEqual(1);
      const banner = await prisma.securityEvent.findFirstOrThrow({ where: { kind: "director.unacknowledged", details: { path: ["noticeId"], equals: notice.id } } });
      expect(banner).toMatchObject({ targetUserId: p.a.userId, acknowledgedAt: null });
      expect((await sweepDirectorNotices(new Date(Date.now() + 4 * 24 * 3600 * 1000))).escalated).toBe(0); // allow-clock: a test instant
      expect(send.mock.calls.length).toBeGreaterThanOrEqual(sentBefore); // (a sweep also re-delivers anything undelivered, so only the escalation itself is judged)
      expect(send.mock.calls.filter((c) => /waited|unacknowledged|escalat/i.test(JSON.stringify(c))).length).toBe(0); // the red banner is the only escalation: no extra e-mail
      await acknowledgeNotice(notice.id, p.b.userId, "looked at it, fine");
      expect((await prisma.securityEvent.findUniqueOrThrow({ where: { id: banner.id } })).acknowledgedByUserId).toBe(p.b.userId);
    });

    it("the escalation days are a setting, not a constant", async () => {
      const notice = await newNotice();
      await prisma.systemSetting.upsert({ where: { key: "payroll.directorNoticeEscalationDays" }, create: { key: "payroll.directorNoticeEscalationDays", value: 1 }, update: { value: 1 } });
      try {
        const r = await sweepDirectorNotices(new Date(Date.now() + 25 * 3600 * 1000)); // allow-clock: a test instant
        expect(r.escalated).toBeGreaterThanOrEqual(1);
        expect(await prisma.securityEvent.count({ where: { kind: "director.unacknowledged", details: { path: ["noticeId"], equals: notice.id } } })).toBe(1);
      } finally {
        await prisma.systemSetting.deleteMany({ where: { key: "payroll.directorNoticeEscalationDays" } });
      }
    });
  });

  describe("two-step sign-in for every director", () => {
    it("is required of an actor outside development and not inside it", async () => {
      await expect(requireDirectorTwoFactor(p.a.userId, prisma, true)).rejects.toMatchObject({ status: 403, code: "DIRECTOR_2FA_REQUIRED" });
      await expect(requireDirectorTwoFactor(p.a.userId, prisma, false)).resolves.toBeUndefined();
      await prisma.user.update({ where: { id: p.a.userId }, data: { totpEnabled: true } });
      await expect(requireDirectorTwoFactor(p.a.userId, prisma, true)).resolves.toBeUndefined();
      await prisma.user.update({ where: { id: p.a.userId }, data: { totpEnabled: false } });
    });

    it("the Super Admin role can never be left off the list that needs it, outside development", () => {
      expect(with2faFloor(["HR_ADMIN"], "production")).toEqual(["HR_ADMIN", "SUPER_ADMIN"]);
      expect(with2faFloor(["HR_ADMIN", "SUPER_ADMIN"], "staging")).toEqual(["HR_ADMIN", "SUPER_ADMIN"]);
      expect(with2faFloor([], "development")).toEqual([]);
    });
  });

  describe("the payroll roles are for directors only", () => {
    const addRole = (userId: string, code: string) => prisma.role.findUniqueOrThrow({ where: { code } }).then((role) => prisma.userRole.create({ data: { userId, roleId: role.id } }));
    const actorOf = async (who: Person) => {
      const a = await resolveAccess(who.userId);
      return { userId: who.userId, employeeId: who.employeeId, roleCodes: a.roleCodes, permissions: a.permissions, dataScope: a.dataScope };
    };
    const meta = (who: Person) => ({ actorUserId: who.userId, ipAddress: null, userAgent: null });

    it("the database refuses PAYROLL_ADMIN and PAYROLL_APPROVER for anyone who is not a Super Admin, and allows them for one", async () => {
      await expect(addRole(p.hr.userId, "PAYROLL_ADMIN")).rejects.toThrow(/PAYROLL_ROLE_DIRECTORS_ONLY/);
      await expect(addRole(p.emp.userId, "PAYROLL_APPROVER")).rejects.toThrow(/PAYROLL_ROLE_DIRECTORS_ONLY/);
      await addRole(p.a.userId, "PAYROLL_ADMIN");
      expect((await resolveAccess(p.a.userId)).roleCodes).toContain("PAYROLL_ADMIN");
    });

    it("the service says why, in words, and the same for a per-user grant of a payroll key", async () => {
      await expect(assignRole(p.hr.employeeId, "PAYROLL_APPROVER", await actorOf(p.b), meta(p.b))).rejects.toMatchObject({ code: "PAYROLL_ROLE_DIRECTORS_ONLY" });
      // Stage 1: for someone who holds an HR role the HR hard lock speaks first (it says the same thing about pay data); for anyone else it is this rule.
      await expect(setOverride(p.hr.employeeId, "payroll.run", { effect: "GRANT", reason: "test" }, await actorOf(p.b), meta(p.b))).rejects.toMatchObject({ code: "HR_CEILING" });
      await expect(setOverride(p.emp.employeeId, "payroll.run", { effect: "GRANT", reason: "test" }, await actorOf(p.b), meta(p.b))).rejects.toMatchObject({ code: "PAYROLL_GRANT_DIRECTORS_ONLY" });
      const permission = await prisma.permission.findUniqueOrThrow({ where: { key: "payroll.run" } });
      await expect(prisma.userPermissionOverride.create({ data: { userId: p.emp.userId, permissionId: permission.id, effect: "GRANT", reason: "raw", createdByUserId: p.b.userId } })).rejects.toThrow(/PAYROLL_GRANT_DIRECTORS_ONLY/);
      await expect(prisma.userPermissionOverride.create({ data: { userId: p.hr.userId, permissionId: permission.id, effect: "GRANT", reason: "raw", createdByUserId: p.b.userId } })).rejects.toThrow(/HR_HARD_LOCK/);
    });

    it("a payroll role held without Super Admin (a row that got past everything) grants nothing and is not seen as held", async () => {
      const x = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
      extraUserIds.push(x.userId);
      try {
        await addRole(x.userId, "PAYROLL_APPROVER");
        expect((await resolveAccess(x.userId)).isSuperAdmin).toBe(true);
        const sa = await prisma.role.findUniqueOrThrow({ where: { code: "SUPER_ADMIN" } });
        await prisma.userRole.delete({ where: { userId_roleId: { userId: x.userId, roleId: sa.id } } }); // raw: the service would take the marker with it
        const access = await resolveAccess(x.userId);
        expect(access.roleCodes).not.toContain("PAYROLL_APPROVER");
        expect(access.permissions.has("payroll.approve")).toBe(false);
        expect([...access.permissions].some((k) => k.startsWith("payroll."))).toBe(false);
      } finally {
        await cleanupFullTestEmployee(x.employeeId);
      }
    });

    it("removing Super Admin through the service takes the payroll markers with it", async () => {
      const x = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
      extraUserIds.push(x.userId);
      try {
        await addRole(x.userId, "PAYROLL_ADMIN");
        await removeRole(x.employeeId, "SUPER_ADMIN", await actorOf(p.a), meta(p.a));
        const codes = (await prisma.userRole.findMany({ where: { userId: x.userId }, include: { role: true } })).map((r) => r.role.code);
        expect(codes).not.toContain("PAYROLL_ADMIN");
        expect(codes).not.toContain("SUPER_ADMIN");
      } finally {
        await cleanupFullTestEmployee(x.employeeId);
      }
    });
  });

  describe("the API", () => {
    it("a director reads and changes the switches and reads their notices; HR and an employee are refused, not shown an empty list", async () => {
      const [ta, tb, thr, temp] = await Promise.all([loginAs(p.a.employeeCode), loginAs(p.b.employeeCode), loginAs(p.hr.employeeCode), loginAs(p.emp.employeeCode)]);
      const list = await request(app).get("/api/director/switches").set(...authHeader(ta));
      expect(list.status).toBe(200);
      expect(list.body.switches).toHaveLength(DIRECTOR_STEPS.length);
      expect(list.body.switches.every((s: { requireSecondDirector: boolean }) => s.requireSecondDirector === false)).toBe(true);

      const put = await request(app).put("/api/director/switches/RUN_APPROVAL").set(...authHeader(ta)).send({ requireSecondDirector: true });
      expect(put.status).toBe(200);
      noticeIds.push(put.body.noticeId);
      expect(put.body.switches.find((s: { step: string }) => s.step === "RUN_APPROVAL").requireSecondDirector).toBe(true);

      const notices = await request(app).get("/api/director/notices").set(...authHeader(tb));
      expect(notices.status).toBe(200);
      expect(notices.body.notices.some((x: { id: string }) => x.id === put.body.noticeId)).toBe(true);
      const ack = await request(app).post(`/api/director/notices/${put.body.noticeId}/acknowledge`).set(...authHeader(tb)).send({ note: "seen, fine" });
      expect(ack.status).toBe(204);

      for (const token of [thr, temp]) {
        for (const [method, path] of [["get", "/api/director/switches"], ["get", "/api/director/notices"]] as const) {
          const r = await request(app)[method](path).set(...authHeader(token));
          expect([path, r.status, r.body.error?.code]).toEqual([path, 403, "DIRECTOR_ONLY"]);
        }
        expect((await request(app).put("/api/director/switches/RUN_APPROVAL").set(...authHeader(token)).send({ requireSecondDirector: false })).status).toBe(403);
      }
      expect((await request(app).put("/api/director/switches/NOPE").set(...authHeader(ta)).send({ requireSecondDirector: true })).status).toBe(400);
      expect((await request(app).get("/api/director/switches")).status).toBe(401);
    });
  });
});
