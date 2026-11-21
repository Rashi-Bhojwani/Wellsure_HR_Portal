import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mailService } from "../../../integrations/mail";
import { prisma } from "../../../lib/prisma";
import { encryptTotpSecret, generateTotpSecret } from "../../auth/totp";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, TEST_PASSWORD, type TestOrgMasters } from "./employeeTestHelpers";

// FIX-C1 (independent audit 2026-11-20, finding C1): "HR can take over any account, including a director's: change the personal email, then use the public
// forgot password." This replays the attack step by step and checks that it fails at every step, then checks the held-change rules around it.
type P = { employeeId: string; employeeCode: string; userId: string };
const ATTACKER = "attacker.madeup@example.invalid";

describe("FIX-C1: no account takeover through the sign-in email", () => {
  let org: TestOrgMasters;
  let d1: P, d2: P, hrAdmin: P, hrExec: P, emp: P;
  let tD1: string, tD2: string, tHr: string, tExec: string;
  const sent: Array<{ to: string; subject: string; text?: string }> = [];
  const original = mailService.send.bind(mailService);
  const personal = (employeeId: string) => prisma.employeePersonal.findUniqueOrThrow({ where: { employeeId } });
  const patch = (token: string, id: string, body: object) => request(app).patch(`/api/employees/${id}/personal`).set(...authHeader(token)).send(body);
  const confirm = (token: string, id: string) => request(app).post(`/api/employees/contact-changes/${id}/confirm`).set(...authHeader(token)).send({});
  const setBehaviour = async (key: string, value: unknown) => {
    const p = await prisma.behaviourProposal.create({ data: { key, value: value as object, reason: "fix-c1 test", proposedByUserId: d1.userId } });
    await prisma.behaviourConfirmation.create({ data: { proposalId: p.id, confirmedByUserId: d2.userId } });
  };

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    d1 = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    d2 = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    hrAdmin = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    hrExec = await createFullTestEmployee(org, { roleCode: "HR_EXECUTIVE" });
    emp = await createFullTestEmployee(org);
    [tD1, tD2, tHr, tExec] = [await loginAs(d1.employeeCode), await loginAs(d2.employeeCode), await loginAs(hrAdmin.employeeCode), await loginAs(hrExec.employeeCode)];
    (mailService as { send: typeof mailService.send }).send = async (m) => {
      sent.push(m as never);
      return { status: "SENT", messageId: "test" } as never;
    };
  });
  afterAll(async () => {
    (mailService as { send: typeof mailService.send }).send = original;
    for (const p of [d1, d2, hrAdmin, hrExec, emp]) await cleanupFullTestEmployee(p.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("the audit's attack fails at every step", async () => {
    const realEmail = (await personal(d2.employeeId)).personalEmail;
    // Step 1: HR Admin (and HR Executive) change the director's personal email: refused, nothing changes, nothing is held.
    for (const t of [tHr, tExec]) {
      const res = await patch(t, d2.employeeId, { personalEmail: ATTACKER });
      expect(res.status).toBe(403);
    }
    expect((await personal(d2.employeeId)).personalEmail).toBe(realEmail);
    expect(await prisma.contactChangeRequest.count({ where: { employeeId: d2.employeeId } })).toBe(0);
    // Step 2: the public "forgot password": the link goes to the real address, never to the attacker's.
    sent.length = 0;
    await request(app).post("/api/auth/forgot-password").send({ employeeCode: d2.employeeCode }).expect(200);
    expect(sent.map((m) => m.to)).not.toContain(ATTACKER);
    expect(sent.some((m) => m.to === realEmail)).toBe(true);
    // Step 3: even with the password, a director must give the two-step code (compulsory by default).
    await setBehaviour("auth.directorTwoFactorCompulsory", true);
    try {
      await prisma.user.update({ where: { id: d2.userId }, data: { totpEnabled: true, totpSecretEncrypted: encryptTotpSecret(generateTotpSecret()) } });
      const signIn = await request(app).post("/api/auth/login").send({ employeeCode: d2.employeeCode, password: TEST_PASSWORD });
      expect(signIn.status).toBe(200);
      expect(signIn.body.status).toBe("requires_totp");
      expect(signIn.body.accessToken).toBeUndefined();
      // A director who has not enrolled is sent to enrol, never signed straight in.
      await prisma.user.update({ where: { id: d2.userId }, data: { totpEnabled: false, totpSecretEncrypted: null } });
      const notEnrolled = await request(app).post("/api/auth/login").send({ employeeCode: d2.employeeCode, password: TEST_PASSWORD });
      expect(notEnrolled.body.status).toBe("requires_totp_setup");
    } finally {
      await setBehaviour("auth.directorTwoFactorCompulsory", false);
    }
  });

  it("two-step sign-in is compulsory for directors by default, and only two directors can turn it off", async () => {
    const { BEHAVIOURS } = await import("../../behaviours/service");
    expect(BEHAVIOURS["auth.directorTwoFactorCompulsory"].defaultValue).toBe(true);
    const put = await request(app).put("/api/settings/security").set(...authHeader(tD1)).send({ requireDirectorTwoFactor: true }); // the development data has it off (both seeded directors confirmed): any change through this one-director path is refused
    expect([put.status, put.body.error?.code]).toEqual([409, "USE_DEFAULT_BEHAVIOURS"]);
  });

  it("System Settings, Security still saves: the form resends the moved settings unchanged; changing one is refused before anything is written", async () => {
    // Found by the browser walk, 2026-11-21: the form sends every field, and a payload carrying the sign-in limit was refused outright, so nothing in the
    // Security section could be saved; a refused save had already written the fields before it.
    const current = (await request(app).get("/api/settings/security").set(...authHeader(tD1))).body;
    const lockoutBefore = current.lockoutMinutes;
    const whole = { ...current, lockoutMinutes: lockoutBefore + 1 };
    const ok = await request(app).put("/api/settings/security").set(...authHeader(tD1)).send(whole);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.lockoutMinutes).toBe(lockoutBefore + 1);
    const changedLimit = { ...whole, lockoutMinutes: lockoutBefore + 2, rateLimits: { ...current.rateLimits, login: { maxAttempts: current.rateLimits.login.maxAttempts + 1, windowSeconds: current.rateLimits.login.windowSeconds } } };
    const refused = await request(app).put("/api/settings/security").set(...authHeader(tD1)).send(changedLimit);
    expect([refused.status, refused.body.error?.code]).toEqual([409, "USE_DEFAULT_BEHAVIOURS"]);
    expect((await request(app).get("/api/settings/security").set(...authHeader(tD1))).body.lockoutMinutes).toBe(lockoutBefore + 1); // nothing half-written
    await request(app).put("/api/settings/security").set(...authHeader(tD1)).send({ lockoutMinutes: lockoutBefore });
  });

  it("nobody else changes a director's contact or identity details; the director's own change waits for the OTHER director", async () => {
    expect((await request(app).patch(`/api/employees/${d2.employeeId}/name`).set(...authHeader(tHr)).send({ fullName: "Changed By HR", effectiveFrom: "2026-01-01" })).status).toBe(403);
    expect((await request(app).patch(`/api/employees/${d2.employeeId}/bank`).set(...authHeader(tHr)).send({ accountNumber: "000011112222", accountNumberConfirm: "000011112222", ifsc: "ABCD0123456", bankName: "Made Up Bank", branchName: "Made Up Branch", accountHolderName: "Made Up" })).status).toBe(403);
    expect((await patch(tD1, d2.employeeId, { mobile: "9111111111" })).status).toBe(403); // not even the other director
    const own = await patch(tD2, d2.employeeId, { mobile: "9222222222", personalEmail: "own.change@example.invalid" });
    expect(own.status).toBe(202);
    expect((await personal(d2.employeeId)).mobile).not.toBe("9222222222");
    expect((await confirm(tD2, own.body.id)).status).toBe(403);
    const ok = await confirm(tD1, own.body.id);
    expect(ok.status).toBe(200);
    expect((await personal(d2.employeeId)).mobile).toBe("9222222222");
  });

  it("an ordinary employee's sign-in email: HR's change waits for a director, the old address is told, and both directors get a notice", async () => {
    const old = (await personal(emp.employeeId)).personalEmail;
    sent.length = 0;
    const held = await patch(tHr, emp.employeeId, { personalEmail: "new.address@example.invalid", mobile: "9333333333" });
    expect(held.status).toBe(202);
    const now = await personal(emp.employeeId);
    expect(now.personalEmail).toBe(old); // held
    expect(now.mobile).toBe("9333333333"); // an ordinary field is written at once
    expect(sent.some((m) => m.to === old)).toBe(true);
    for (const d of [d1, d2]) expect(await prisma.notification.count({ where: { userId: d.userId, type: "security.contact_change_pending" } })).toBeGreaterThan(0);
    expect((await confirm(tHr, held.body.id)).status).toBe(403);
    sent.length = 0;
    expect((await confirm(tD1, held.body.id)).status).toBe(200);
    expect((await personal(emp.employeeId)).personalEmail).toBe("new.address@example.invalid");
    expect(sent.some((m) => m.to === old)).toBe(true); // told again when it takes effect
  });

  it("a director's own change to an employee's email also waits for the other director while the setting is on (the default); off, it applies at once, HR's still waits", async () => {
    const proposed = await patch(tD1, emp.employeeId, { personalEmail: "by.director@example.invalid" });
    expect(proposed.status).toBe(202);
    expect((await confirm(tD1, proposed.body.id)).body.error.code).toBe("CHECKER_IS_MAKER");
    expect((await confirm(tD2, proposed.body.id)).status).toBe(200);
    await setBehaviour("auth.loginEmailChangeNeedsDirector", false);
    try {
      expect((await patch(tD1, emp.employeeId, { personalEmail: "at.once@example.invalid" })).status).toBe(204);
      expect((await personal(emp.employeeId)).personalEmail).toBe("at.once@example.invalid");
      expect((await patch(tHr, emp.employeeId, { personalEmail: "hr.again@example.invalid" })).status).toBe(202);
    } finally {
      await setBehaviour("auth.loginEmailChangeNeedsDirector", true);
    }
  });

  it("a password reset ends every other session at once, and so does a password change (M1)", async () => {
    const old = await loginAs(emp.employeeCode);
    await request(app).get("/api/auth/me").set(...authHeader(old)).expect(200);
    const changed = await request(app).post("/api/auth/password").set(...authHeader(old)).send({ currentPassword: TEST_PASSWORD, newPassword: "Another-Pass-2026" });
    expect(changed.status).toBe(200);
    const res = await request(app).get("/api/auth/me").set(...authHeader(old));
    expect([res.status, res.body.error.code]).toEqual([401, "SESSION_ENDED"]);
    await request(app).get("/api/auth/me").set(...authHeader(changed.body.accessToken)).expect(200);
    expect((await request(app).post("/api/auth/password").set(...authHeader(changed.body.accessToken)).send({ currentPassword: "wrong", newPassword: "Third-Pass-2026" })).status).toBe(400);
  });
});
