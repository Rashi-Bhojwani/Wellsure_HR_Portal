import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import { createInvitation } from "../../auth/service";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupFullTestEmployee,
  cleanupTestRole,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  grantPermissions,
  loginAs,
  type TestOrgMasters,
} from "../../employee/__tests__/employeeTestHelpers";

// Every SystemSetting key is a global singleton shared by the whole test
// run (fileParallelism is off, but every file still hits the same DB) — a
// test that PUTs a new value must restore exactly what was there before,
// not a hardcoded "default", or it corrupts an unrelated file's fixture
// (e.g. auth.lockout leaking into login.test.ts's "5 attempts locks the
// account" test, which this file discovered the hard way).
const TOUCHED_SETTING_KEYS = ["auth.lockout", "auth.invitationTtlHours", "auth.passwordMinLength"] as const;

describe("System Settings (/api/settings/security)", () => {
  const managerRole = `TEST_SETTINGS_MGR_${Date.now()}`;
  const noPermRole = `TEST_SETTINGS_NONE_${Date.now()}`;
  let org: TestOrgMasters;
  let managerToken: string;
  let managerUserId: string;
  let noPermToken: string;
  const employeeIds: string[] = [];
  let settingsSnapshot: { key: string; value: unknown }[];

  beforeAll(async () => {
    settingsSnapshot = await prisma.systemSetting.findMany({ where: { key: { in: [...TOUCHED_SETTING_KEYS] } } });

    org = await createEmployeeTestOrgMasters();
    await grantPermissions(managerRole, ["settings.manage"]);
    await grantPermissions(noPermRole, []);

    const manager = await createFullTestEmployee(org, { roleCode: managerRole });
    employeeIds.push(manager.employeeId);
    managerToken = await loginAs(manager.employeeCode);
    managerUserId = manager.userId;

    const plain = await createFullTestEmployee(org, { roleCode: noPermRole });
    employeeIds.push(plain.employeeId);
    noPermToken = await loginAs(plain.employeeCode);
  });

  afterAll(async () => {
    for (const id of employeeIds) await cleanupFullTestEmployee(id);
    await cleanupTestRole(managerRole);
    await cleanupTestRole(noPermRole);
    await cleanupEmployeeTestOrgMasters(org);

    // Put every touched key back exactly as found — restore a snapshotted
    // row, or delete one this file created that didn't exist before.
    for (const key of TOUCHED_SETTING_KEYS) {
      const original = settingsSnapshot.find((s) => s.key === key);
      if (original) {
        await prisma.systemSetting.update({ where: { key }, data: { value: original.value as never } });
      } else {
        await prisma.systemSetting.deleteMany({ where: { key } });
      }
    }
  });

  it("requires settings.manage to read or write", async () => {
    const getRes = await request(app).get("/api/settings/security").set(...authHeader(noPermToken));
    expect(getRes.status).toBe(403);
    const putRes = await request(app).put("/api/settings/security").set(...authHeader(noPermToken)).send({ passwordMinLength: 10 });
    expect(putRes.status).toBe(403);
  });

  it("returns sensible defaults when nothing has been configured yet", async () => {
    const res = await request(app).get("/api/settings/security").set(...authHeader(managerToken));
    expect(res.status).toBe(200);
    expect(res.body.lockoutMaxAttempts).toBeGreaterThan(0);
    expect(res.body.rateLimits.login).toBeTruthy();
  });

  it("persists a partial update, leaves other fields untouched, and audit-logs it", async () => {
    const before = await request(app).get("/api/settings/security").set(...authHeader(managerToken));

    const res = await request(app)
      .put("/api/settings/security")
      .set(...authHeader(managerToken))
      .send({ lockoutMaxAttempts: 7 });
    expect(res.status).toBe(200);
    expect(res.body.lockoutMaxAttempts).toBe(7);
    expect(res.body.lockoutMinutes).toBe(before.body.lockoutMinutes); // untouched

    // This request's own entry, not just any settings change ever logged.
    const audit = await prisma.auditLog.findFirst({ where: { action: "settings.updated", actorUserId: managerUserId }, orderBy: { createdAt: "desc" } });
    expect(audit).not.toBeNull();
  });

  it("invitationTtlHours actually changes the expiry an invitation is issued with", async () => {
    await request(app)
      .put("/api/settings/security")
      .set(...authHeader(managerToken))
      .send({ invitationTtlHours: 2 });

    const employee = await createFullTestEmployee(org);
    employeeIds.push(employee.employeeId);
    const user = await prisma.user.findUniqueOrThrow({ where: { employeeId: employee.employeeId } });

    await createInvitation({ userId: user.id, email: "settings-test@gmail.com", fullName: "Settings Test", employeeCode: employee.employeeCode });
    const token = await prisma.invitationToken.findFirstOrThrow({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });

    const hoursUntilExpiry = (token.expiresAt.getTime() - Date.now()) / (60 * 60 * 1000);
    expect(hoursUntilExpiry).toBeGreaterThan(1.9);
    expect(hoursUntilExpiry).toBeLessThan(2.1);
  });

  it("passwordMinLength actually blocks a short password on invitation accept", async () => {
    await request(app)
      .put("/api/settings/security")
      .set(...authHeader(managerToken))
      .send({ passwordMinLength: 12 });

    const employee = await createFullTestEmployee(org);
    employeeIds.push(employee.employeeId);
    const user = await prisma.user.findUniqueOrThrow({ where: { employeeId: employee.employeeId } });
    await prisma.user.update({ where: { id: user.id }, data: { status: "INVITED", passwordHash: null } });

    const rawToken = `settings-test-token-${Date.now()}`;
    await prisma.invitationToken.create({
      data: { userId: user.id, tokenHash: createHash("sha256").update(rawToken).digest("hex"), expiresAt: new Date(Date.now() + 3600_000) },
    });

    // 9 characters — passes the Zod schema's own absolute floor (min 8) so
    // this specifically exercises the *configured* 12-char policy, not
    // that fixed floor.
    const tooShort = await request(app).post(`/api/auth/invitations/${rawToken}/accept`).send({ password: "Password1" });
    expect(tooShort.status).toBe(400);

    const longEnough = await request(app).post(`/api/auth/invitations/${rawToken}/accept`).send({ password: "LongEnoughPassword1" });
    expect(longEnough.status).toBe(200);
  });
});
