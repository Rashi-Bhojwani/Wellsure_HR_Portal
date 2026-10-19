import { randomUUID } from "node:crypto";
import { grantManager, LEGACY_MANAGER_GRANTS } from "../../../lib/__tests__/testHelpers";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "../../../config/env";
import { mailService } from "../../../integrations/mail";
import { fakeReceipt } from "../../../integrations/mail/testing";
import { storageService } from "../../../integrations/storage";
import { closeSecurityAlertQueue, securityAlertQueue } from "../../../jobs/securityAlertQueue";
import { purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { logger } from "../../../lib/logger";
import { prisma } from "../../../lib/prisma";
import { issuePhotoToken } from "../../people/photos";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupFullTestEmployee,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  loginAs,
  type TestOrgMasters,
} from "../../employee/__tests__/employeeTestHelpers";
import { recoverSuperAdmin } from "../recovery";

// Phase 5 commit E1.1 — docs/plans/PHASE_5.md §E1.1:
//   * audit_logs / security_events append-only at the database level;
//   * break-glass recovery is loud: log line outside the DB first, email to
//     every active Super Admin (+ SECURITY_ALERT_EMAIL) BEFORE acting, a
//     security event only another Super Admin can acknowledge;
//   * reason/operator/justification recorded on every action, unlock included;
//   * an in-app sign-in reset emails the person it was done to;
//   * the four places that leaked company-wide data to a manager.
type Person = { employeeId: string; employeeCode: string; userId: string };

describe("E1.1 — loud break-glass, append-only audit, manager data scope", () => {
  let org: TestOrgMasters;
  let otherOrg: TestOrgMasters;
  const p = {} as Record<"sa" | "sa2" | "hrAdmin" | "manager" | "report" | "outsider", Person>;
  const tokens = {} as Record<"sa" | "sa2" | "hrAdmin" | "manager", string>;
  const eventIds: string[] = [];
  const emailOf = async (userId: string) => (await prisma.employeePersonal.findFirstOrThrow({ where: { employee: { user: { id: userId } } } })).personalEmail;

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    otherOrg = await createEmployeeTestOrgMasters();
    p.sa = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.sa2 = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.hrAdmin = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.manager = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    await grantManager(p.manager.userId, LEGACY_MANAGER_GRANTS); // a manager has no powers until Admin grants them (2026-10-03)
    p.report = await createFullTestEmployee(org, { managerId: p.manager.employeeId });
    p.outsider = await createFullTestEmployee(otherOrg);
    for (const k of ["sa", "sa2", "hrAdmin", "manager"] as const) tokens[k] = await loginAs(p[k].employeeCode);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (eventIds.length) await purgeAppendOnly("SecurityEvent", { id: { in: eventIds } });
    await purgeAppendOnly("SecurityEvent", { targetUserId: { in: Object.values(p).map((x) => x.userId) } });
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
    await cleanupEmployeeTestOrgMasters(otherOrg);
    await closeSecurityAlertQueue();
  });

  const api = (token: string) => ({
    get: (path: string) => request(app).get(path).set(...authHeader(token)),
    post: (path: string, b: object = {}) => request(app).post(path).set(...authHeader(token)).send(b),
  });
  const recoverInput = (overrides: Partial<Parameters<typeof recoverSuperAdmin>[0]> = {}) => ({
    employeeCode: p.sa2.employeeCode,
    unlock: true,
    reason: "locked out after a phone change, verified by call",
    operator: "Test Operator",
    justification: "the other Super Admin is on leave and unreachable",
    ...overrides,
  });

  // ── Append-only at the database level ─────────────────────────────────

  describe("append-only audit log", () => {
    it("refuses UPDATE, DELETE and TRUNCATE on audit_logs", async () => {
      const row = await prisma.auditLog.create({ data: { action: "test.append_only", entityType: "Test", entityId: randomUUID() } });
      try {
        await expect(prisma.auditLog.update({ where: { id: row.id }, data: { action: "tampered" } })).rejects.toThrow(/AUDIT_APPEND_ONLY/);
        await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/AUDIT_APPEND_ONLY/);
        await expect(prisma.$executeRawUnsafe("TRUNCATE audit_logs")).rejects.toThrow(/AUDIT_APPEND_ONLY/);
        expect((await prisma.auditLog.findUniqueOrThrow({ where: { id: row.id } })).action).toBe("test.append_only");
      } finally {
        await purgeAppendOnly("AuditLog", { id: row.id });
      }
    });

    it("the test exception needs BOTH the session flag and the dev-database marker", async () => {
      const row = await prisma.auditLog.create({ data: { action: "test.append_only", entityType: "Test", entityId: randomUUID() } });
      try {
        // Flag without the marker (as on a never-seeded production database):
        // refused. The marker row is removed inside the transaction only.
        await expect(
          prisma.$transaction(async (tx) => {
            await tx.devDatabaseMarker.deleteMany({});
            await tx.$executeRawUnsafe("SELECT set_config('app.audit_purge', 'test', true)");
            await tx.auditLog.delete({ where: { id: row.id } });
          }),
        ).rejects.toThrow(/AUDIT_APPEND_ONLY/);
        expect(await prisma.devDatabaseMarker.count()).toBe(1);
        // Even with the purge flag, an UPDATE is never allowed.
        await expect(
          prisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe("SELECT set_config('app.audit_purge', 'test', true)");
            await tx.auditLog.update({ where: { id: row.id }, data: { action: "tampered" } });
          }),
        ).rejects.toThrow(/AUDIT_APPEND_ONLY/);
      } finally {
        await purgeAppendOnly("AuditLog", { id: row.id });
      }
      expect(await prisma.auditLog.count({ where: { id: row.id } })).toBe(0);
    });

    it("security events: only the acknowledgement may be filled in, once; never deleted", async () => {
      const e = await prisma.securityEvent.create({ data: { kind: "break_glass.recover", summary: "test", details: {} } });
      eventIds.push(e.id);
      await expect(prisma.securityEvent.update({ where: { id: e.id }, data: { summary: "tampered" } })).rejects.toThrow(/SECURITY_EVENT_APPEND_ONLY/);
      await expect(prisma.securityEvent.delete({ where: { id: e.id } })).rejects.toThrow(/SECURITY_EVENT_APPEND_ONLY/);
      await prisma.securityEvent.update({ where: { id: e.id }, data: { acknowledgedAt: new Date(), acknowledgedByUserId: p.sa.userId, acknowledgementNote: "checked" } });
      await expect(prisma.securityEvent.update({ where: { id: e.id }, data: { acknowledgementNote: "rewritten" } })).rejects.toThrow(/SECURITY_EVENT_APPEND_ONLY/);
    });
  });

  // ── Break-glass recovery is loud ──────────────────────────────────────

  describe("break-glass recovery", () => {
    it("refuses without a real reason, an operator, or a written justification", async () => {
      await expect(recoverSuperAdmin(recoverInput({ reason: "short" }))).rejects.toThrow(/reason/);
      await expect(recoverSuperAdmin(recoverInput({ operator: "" }))).rejects.toThrow(/operator/);
      await expect(recoverSuperAdmin(recoverInput({ justification: "" }))).rejects.toThrow(/confirm-no-other-admin/);
      await expect(recoverSuperAdmin(recoverInput({ employeeCode: p.hrAdmin.employeeCode }))).rejects.toThrow(/not a Super Admin/);
      await expect(recoverSuperAdmin(recoverInput({ unlock: false }))).rejects.toThrow(/at least one/);
    });

    it("logs outside the DB first, then emails EVERY active Super Admin (target included) and the security address, before acting", async () => {
      const original = env.SECURITY_ALERT_EMAIL;
      (env as { SECURITY_ALERT_EMAIL?: string }).SECURITY_ALERT_EMAIL = "owners.inbox.test@gmail.com";
      const warn = vi.spyOn(logger, "warn");
      const sent: string[] = [];
      vi.spyOn(mailService, "send").mockImplementation(async (m) => {
        sent.push(m.to);
        return fakeReceipt(m.to);
      });
      await prisma.user.update({ where: { id: p.sa2.userId }, data: { totpEnabled: true, failedLoginAttempts: 5, lockedUntil: new Date(Date.now() + 60_000) } });
      try {
        const r = await recoverSuperAdmin(recoverInput({ resetTwoFactor: true, passwordReset: true }));
        eventIds.push(r.alert.eventId);

        const activeSaEmails = (await prisma.user.findMany({ where: { status: "ACTIVE", roles: { some: { role: { code: "SUPER_ADMIN" } } } }, select: { employee: { select: { personal: { select: { personalEmail: true } } } } } })).map((u) => u.employee.personal!.personalEmail);
        expect(activeSaEmails).toContain(await emailOf(p.sa2.userId)); // the target is told too
        for (const e of activeSaEmails) expect(r.alert.emailed).toContain(e);
        expect(r.alert.emailed).toContain("owners.inbox.test@gmail.com");

        const logCall = warn.mock.calls.findIndex((c) => (c[0] as { event?: string }).event === "security.breakglass");
        expect(logCall).toBeGreaterThanOrEqual(0);
        // The outside-the-DB line comes before the first email.
        const sendSpy = vi.mocked(mailService.send);
        expect(warn.mock.invocationCallOrder[logCall]!).toBeLessThan(sendSpy.mock.invocationCallOrder[0]!);
        // …and the alert emails before the reset-link email (i.e. before acting).
        const alertSends = sent.filter((to) => to !== r.emailedTo);
        expect(alertSends.length).toBeGreaterThan(0);

        const u = await prisma.user.findUniqueOrThrow({ where: { id: p.sa2.userId } });
        expect(u).toMatchObject({ totpEnabled: false, failedLoginAttempts: 0, lockedUntil: null });

        for (const action of ["auth.unlocked_by_admin", "auth.2fa.reset_by_admin", "auth.password_reset_issued_by_admin"]) {
          const log = await prisma.auditLog.findFirstOrThrow({ where: { action, entityId: p.sa2.userId }, orderBy: { createdAt: "desc" } });
          expect(log.actorUserId).toBeNull();
          expect(log.after).toMatchObject({
            reason: "[break-glass CLI] locked out after a phone change, verified by call",
            operator: "Test Operator",
            justification: "the other Super Admin is on leave and unreachable",
            securityEventId: r.alert.eventId,
          });
        }
        const notes = await prisma.notification.count({ where: { userId: p.sa.userId, type: "access.alert" } });
        expect(notes).toBeGreaterThan(0);
      } finally {
        (env as { SECURITY_ALERT_EMAIL?: string }).SECURITY_ALERT_EMAIL = original;
      }
    });

    it("if the alert email fails, nothing changes — unless --mail-is-down, which queues it and proceeds", async () => {
      await prisma.user.update({ where: { id: p.sa2.userId }, data: { failedLoginAttempts: 5, lockedUntil: new Date(Date.now() + 60_000) } });
      vi.spyOn(mailService, "send").mockRejectedValue(new Error("SES unreachable"));
      const eventsBefore = await prisma.securityEvent.count();
      await expect(recoverSuperAdmin(recoverInput())).rejects.toThrow(/couldn't be sent/);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: p.sa2.userId } })).failedLoginAttempts).toBe(5);
      expect(await prisma.securityEvent.count()).toBe(eventsBefore);

      const r = await recoverSuperAdmin(recoverInput({ mailIsDown: true }));
      eventIds.push(r.alert.eventId);
      expect(r.alert.emailed).toEqual([]);
      expect(r.alert.queued.length).toBeGreaterThan(0);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: p.sa2.userId } })).failedLoginAttempts).toBe(0);
      const jobs = await securityAlertQueue().getJobs(["waiting", "delayed"]);
      expect(jobs.some((j) => (j.data as { subject: string }).subject.startsWith("[Security]"))).toBe(true);
      await securityAlertQueue().obliterate({ force: true });
    });

    it("the banner: listed for Super Admins; the target can't acknowledge their own; another can, once, audited", async () => {
      vi.spyOn(mailService, "send").mockResolvedValue(fakeReceipt());
      const r = await recoverSuperAdmin(recoverInput());
      eventIds.push(r.alert.eventId);

      const listed = await api(tokens.sa).get("/api/access/security-events");
      expect(listed.status).toBe(200);
      expect(listed.body.events.some((e: { id: string }) => e.id === r.alert.eventId)).toBe(true);
      expect((await api(tokens.hrAdmin).get("/api/access/security-events")).status).toBe(403);

      const self = await api(tokens.sa2).post(`/api/access/security-events/${r.alert.eventId}/acknowledge`, { note: "it was me" });
      expect(self.status).toBe(403);
      expect(self.body.error.code).toBe("SELF");
      const ok = await api(tokens.sa).post(`/api/access/security-events/${r.alert.eventId}/acknowledge`, { note: "confirmed by phone with them" });
      expect(ok.status).toBe(204);
      expect((await api(tokens.sa).post(`/api/access/security-events/${r.alert.eventId}/acknowledge`, { note: "again" })).status).toBe(409);
      expect(await prisma.auditLog.count({ where: { action: "security_event.acknowledged", entityId: r.alert.eventId } })).toBe(1);
      const open = await api(tokens.sa).get("/api/access/security-events");
      expect(open.body.events.some((e: { id: string }) => e.id === r.alert.eventId)).toBe(false);
    });
  });

  // ── In-app resets tell the person ─────────────────────────────────────

  it("an in-app sign-in reset emails the person it was done to, naming who did it; unlock needs a reason", async () => {
    const sent: Array<{ to: string; html: string }> = [];
    vi.spyOn(mailService, "send").mockImplementation(async (m) => {
      sent.push(m);
      return fakeReceipt(m.to);
    });
    await prisma.user.update({ where: { id: p.sa2.userId }, data: { totpEnabled: true, failedLoginAttempts: 5, lockedUntil: new Date(Date.now() + 60_000) } });
    expect((await api(tokens.sa).post(`/api/access/employees/${p.sa2.employeeId}/unlock`)).status).toBe(400);
    expect((await api(tokens.sa).post(`/api/access/employees/${p.sa2.employeeId}/unlock`, { reason: "too many typos" })).status).toBe(200);
    expect((await api(tokens.sa).post(`/api/access/employees/${p.sa2.employeeId}/reset-2fa`, { reason: "lost their phone" })).status).toBe(200);
    const target = await emailOf(p.sa2.userId);
    const notices = sent.filter((m) => m.to === target);
    expect(notices).toHaveLength(2);
    expect(notices.every((m) => m.html.includes(p.sa.employeeCode))).toBe(true);
    const unlockLog = await prisma.auditLog.findFirstOrThrow({ where: { action: "auth.unlocked_by_admin", entityId: p.sa2.userId, actorUserId: p.sa.userId } });
    expect((unlockLog.after as { reason: string }).reason).toBe("too many typos");
  });

  // ── Company-wide data no longer reaches a manager ─────────────────────

  describe("manager data scope (live leaks fixed in E1.1)", () => {
    it("Admin dashboard: the manager gets their team's figures, the HR Admin the company's", async () => {
      const mine = await api(tokens.manager).get("/api/admin/dashboard");
      expect(mine.status).toBe(200);
      expect(mine.body.scope).toBe("team");
      const teamHeadcount = (mine.body.departmentHeadcount as Array<{ count: number }>).reduce((a, b) => a + b.count, 0);
      expect(teamHeadcount).toBe(2); // the manager + their one report
      const company = await api(tokens.hrAdmin).get("/api/admin/dashboard");
      expect(company.body.scope).toBe("company");
      expect((company.body.departmentHeadcount as Array<{ count: number }>).reduce((a, b) => a + b.count, 0)).toBeGreaterThan(2);
    });

    it("leave dashboard and leave calendar: a manager sees only their team, and can't widen to another department", async () => {
      const pl = await prisma.leaveType.findFirstOrThrow({ where: { code: "PL" } });
      const day = new Date(Date.UTC(2031, 5, 10));
      const mk = (employeeId: string) => prisma.leaveRequest.create({ data: { employeeId, leaveTypeId: pl.id, fromDate: day, toDate: day, totalDays: 1, status: "APPROVED", appliedByUserId: "test" } });
      const inTeam = await mk(p.report.employeeId);
      const outside = await mk(p.outsider.employeeId);
      try {
        const dash = await api(tokens.manager).get("/api/leave/dashboard?year=2031");
        expect(dash.body.scope).toBe("team");
        const days = (dash.body.byMonthAndType as Array<{ days: number }>).reduce((a, b) => a + b.days, 0);
        expect(days).toBe(1);
        const hr = await api(tokens.hrAdmin).get("/api/leave/dashboard?year=2031");
        expect((hr.body.byMonthAndType as Array<{ days: number }>).reduce((a, b) => a + b.days, 0)).toBeGreaterThanOrEqual(2);

        const cal = await api(tokens.manager).get(`/api/leave/calendar?fromDate=2031-06-01&toDate=2031-06-30&departmentId=${otherOrg.departmentId}`);
        expect(cal.status).toBe(200);
        const ids = (cal.body.entries ?? cal.body).map((e: { employeeId: string }) => e.employeeId);
        expect(ids).toContain(p.report.employeeId);
        expect(ids).not.toContain(p.outsider.employeeId);
        const hrCal = await api(tokens.hrAdmin).get(`/api/leave/calendar?fromDate=2031-06-01&toDate=2031-06-30&departmentId=${otherOrg.departmentId}`);
        expect((hrCal.body.entries ?? hrCal.body).map((e: { employeeId: string }) => e.employeeId)).toContain(p.outsider.employeeId);
      } finally {
        await prisma.leaveRequest.deleteMany({ where: { id: { in: [inTeam.id, outside.id] } } });
      }
    });

    it("a former employee's photo: only within the viewer's scope", async () => {
      const key = `test/e11/${randomUUID()}.webp`;
      await storageService.putObject(key, Buffer.from("not really a webp"), "image/webp");
      const leaver = await createFullTestEmployee(otherOrg);
      const teamLeaver = await createFullTestEmployee(org, { managerId: p.manager.employeeId });
      try {
        for (const x of [leaver, teamLeaver]) {
          await prisma.employeePersonal.update({ where: { employeeId: x.employeeId }, data: { photoThumbStorageKey: key, photoStorageKey: key, photoVersion: "v1" } });
          await prisma.employee.update({ where: { id: x.employeeId }, data: { status: "SEPARATED" } });
        }
        const token = issuePhotoToken(p.manager.userId).token;
        const get = (id: string) => request(app).get(`/api/people/photos/${id}/thumb?t=${encodeURIComponent(token)}`);
        expect((await get(leaver.employeeId)).status).toBe(404);
        expect((await get(teamLeaver.employeeId)).status).toBe(200);
        const hrToken = issuePhotoToken(p.hrAdmin.userId).token;
        expect((await request(app).get(`/api/people/photos/${leaver.employeeId}/thumb?t=${encodeURIComponent(hrToken)}`)).status).toBe(200);
      } finally {
        await prisma.employeePersonal.updateMany({ where: { employeeId: { in: [leaver.employeeId, teamLeaver.employeeId] } }, data: { photoThumbStorageKey: null, photoStorageKey: null } });
        await storageService.deleteObject(key);
        await cleanupFullTestEmployee(leaver.employeeId);
        await cleanupFullTestEmployee(teamLeaver.employeeId);
      }
    });
  });
});
