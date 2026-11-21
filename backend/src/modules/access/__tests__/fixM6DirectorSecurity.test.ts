import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mailService } from "../../../integrations/mail";
import { prisma } from "../../../lib/prisma";
import { encryptTotpSecret, generateTotpSecret } from "../../auth/totp";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";

// FIX-M6 (independent audit 2026-11-20, finding M6): "One director can reset the other director's two-step sign-in and unlock them, alone." Now each is a director
// change that a second director confirms, and each always raises a security alert to the outside mailbox (and every director), when proposed and when applied.
type P = { employeeId: string; employeeCode: string; userId: string };

describe("FIX-M6: director-on-director security actions need a second director and alert the outside mailbox", () => {
  let org: TestOrgMasters;
  let a: P, b: P, c: P;
  let ta: string, tc: string;
  const sent: Array<{ to: string; subject: string }> = [];
  const original = mailService.send.bind(mailService);

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    [a, b, c] = [await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" }), await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" }), await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" })];
    [ta, tc] = [await loginAs(a.employeeCode), await loginAs(c.employeeCode)];
    await prisma.user.update({ where: { id: b.userId }, data: { totpEnabled: true, totpSecretEncrypted: encryptTotpSecret(generateTotpSecret()), lockedUntil: new Date(Date.now() + 3600_000), failedLoginAttempts: 5 } });
    (mailService as { send: typeof mailService.send }).send = async (m) => {
      sent.push(m as never);
      return { status: "SENT", messageId: "test" } as never;
    };
  });
  afterAll(async () => {
    (mailService as { send: typeof mailService.send }).send = original;
    for (const p of [a, b, c]) await cleanupFullTestEmployee(p.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("the audit's case: one director resetting another's two-step sign-in alone is held, and the outside mailbox is alerted", async () => {
    sent.length = 0;
    const res = await request(app).post(`/api/access/employees/${b.employeeId}/reset-2fa`).set(...authHeader(ta)).send({ reason: "test: lost phone" });
    expect(res.status).toBe(202);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: b.userId } })).totpEnabled).toBe(true);
    expect(sent.some((m) => m.subject.startsWith("[Security]"))).toBe(true);
    expect((await request(app).post(`/api/access/director-changes/${res.body.id}/confirm`).set(...authHeader(ta)).send({})).body.error.code).toBe("CHECKER_IS_MAKER");
    sent.length = 0;
    const ok = await request(app).post(`/api/access/director-changes/${res.body.id}/confirm`).set(...authHeader(tc)).send({});
    expect([ok.status, ok.body.applied]).toEqual([200, true]);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: b.userId } })).totpEnabled).toBe(false);
    expect(sent.some((m) => m.subject.startsWith("[Security]"))).toBe(true);
  });

  it("unlocking a director is held the same way, and applied by a second director", async () => {
    sent.length = 0;
    const res = await request(app).post(`/api/access/employees/${b.employeeId}/unlock`).set(...authHeader(ta)).send({ reason: "test: typo storm" });
    expect(res.status).toBe(202);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: b.userId } })).lockedUntil).not.toBeNull();
    expect(sent.some((m) => m.subject.startsWith("[Security]"))).toBe(true);
    await request(app).post(`/api/access/director-changes/${res.body.id}/confirm`).set(...authHeader(tc)).send({}).expect(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: b.userId } })).lockedUntil).toBeNull();
  });
});
