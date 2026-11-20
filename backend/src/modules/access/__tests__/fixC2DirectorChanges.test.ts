import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";

// FIX-C2 (independent audit 2026-11-20, finding C2): "One director alone can make anyone a Super Admin (a third director) or remove the other director's
// Super Admin role. No confirmation, no notice." Now: one director proposes, the other confirms, both are told; never below one active director; a third
// director needs every existing director; and the database refuses a Super Admin role row added or removed outside an applied change.
type P = { employeeId: string; employeeCode: string; userId: string };

describe("FIX-C2: who is a director is a two-director decision", () => {
  let org: TestOrgMasters;
  let a: P, b: P, e: P, f: P, hr: P;
  let ta: string, tb: string, thr: string;
  let suspended: string[] = [];
  const isSa = async (userId: string) => (await prisma.userRole.count({ where: { userId, role: { code: "SUPER_ADMIN" } } })) > 0;
  const confirm = (token: string, id: string) => request(app).post(`/api/access/director-changes/${id}/confirm`).set(...authHeader(token)).send({});

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    a = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    b = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    e = await createFullTestEmployee(org);
    f = await createFullTestEmployee(org);
    hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    [ta, tb, thr] = [await loginAs(a.employeeCode), await loginAs(b.employeeCode), await loginAs(hr.employeeCode)];
    // Exactly two active directors (a and b) for this file: the seeded ones are suspended meanwhile and restored after.
    const others = await prisma.user.findMany({ where: { status: "ACTIVE", id: { notIn: [a.userId, b.userId] }, roles: { some: { role: { code: "SUPER_ADMIN" } } } }, select: { id: true } });
    suspended = others.map((u) => u.id);
    await prisma.user.updateMany({ where: { id: { in: suspended } }, data: { status: "SUSPENDED" } });
  });
  afterAll(async () => {
    await prisma.user.updateMany({ where: { id: { in: suspended } }, data: { status: "ACTIVE" } });
    const ids = (await prisma.directorRoleChange.findMany({ where: { targetUserId: { in: [a.userId, b.userId, e.userId, f.userId] } }, select: { id: true } })).map((r) => r.id);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT set_config('app.audit_purge', 'test', true)");
      await tx.directorRoleChange.deleteMany({ where: { id: { in: ids } } });
    });
    for (const p of [a, b, e, f, hr]) await cleanupFullTestEmployee(p.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("the audit's attack: one director making a third director alone is refused; it waits for every existing director", async () => {
    const plain = await request(app).post(`/api/access/employees/${e.employeeId}/roles`).set(...authHeader(ta)).send({ code: "SUPER_ADMIN" });
    expect([plain.status, plain.body.error?.code]).toEqual([409, "THIRD_DIRECTOR_NEEDS_ALL"]);
    const proposed = await request(app).post(`/api/access/employees/${e.employeeId}/roles`).set(...authHeader(ta)).send({ code: "SUPER_ADMIN", thirdDirector: true, reason: "test: a third director" });
    expect(proposed.status).toBe(202);
    expect(proposed.body.pendingConfirmation).toBe(true);
    expect(await isSa(e.userId)).toBe(false);
    expect((await confirm(ta, proposed.body.id)).body.error.code).toBe("CHECKER_IS_MAKER");
    // both directors are told
    for (const d of [a, b]) expect(await prisma.notification.count({ where: { userId: d.userId, type: "director.role_change_pending" } })).toBeGreaterThan(0);
    const ok = await confirm(tb, proposed.body.id);
    expect([ok.status, ok.body.applied]).toEqual([200, true]);
    expect(await isSa(e.userId)).toBe(true);
  });

  it("with three directors, a fourth needs every other director, not just one", async () => {
    const te = await loginAs(e.employeeCode);
    const proposed = await request(app).post(`/api/access/employees/${f.employeeId}/roles`).set(...authHeader(ta)).send({ code: "SUPER_ADMIN", thirdDirector: true, reason: "test: a fourth" });
    expect(proposed.status).toBe(202);
    const first = await confirm(tb, proposed.body.id);
    expect(first.body.applied).toBe(false);
    expect(await isSa(f.userId)).toBe(false);
    expect((await confirm(te, proposed.body.id)).body.applied).toBe(true);
    expect(await isSa(f.userId)).toBe(true);
  });

  it("removing a director's status waits for the other director; the last active director is never removed", async () => {
    const proposed = await request(app).delete(`/api/access/employees/${f.employeeId}/roles/SUPER_ADMIN`).set(...authHeader(ta));
    expect(proposed.status).toBe(202);
    expect(await isSa(f.userId)).toBe(true);
    expect((await confirm(tb, proposed.body.id)).body.applied).toBe(true);
    expect(await isSa(f.userId)).toBe(false);
    // Only a stays active: removing a is refused at proposal.
    await prisma.user.updateMany({ where: { id: { in: [b.userId, e.userId] } }, data: { status: "SUSPENDED" } });
    try {
      const last = await request(app).delete(`/api/access/employees/${a.employeeId}/roles/SUPER_ADMIN`).set(...authHeader(ta));
      expect([last.status, last.body.error.code]).toEqual([409, "LAST_SUPER_ADMIN"]);
    } finally {
      await prisma.user.updateMany({ where: { id: { in: [b.userId, e.userId] } }, data: { status: "ACTIVE" } });
    }
  });

  it("HR cannot propose, and cannot separate a director; a director's portal access is turned off only with the other director", async () => {
    expect((await request(app).post(`/api/access/employees/${f.employeeId}/roles`).set(...authHeader(thr)).send({ code: "SUPER_ADMIN" })).status).toBe(403);
    const sep = await request(app).post(`/api/employees/${e.employeeId}/separations`).set(...authHeader(thr)).send({ lastWorkingDate: "2026-12-31", reason: "Resigned" });
    expect([sep.status, sep.body.error?.code]).toEqual([409, "DIRECTOR_CHANGE_REQUIRED"]);
    const off = await request(app).post(`/api/access/employees/${e.employeeId}/portal-access`).set(...authHeader(ta)).send({ enabled: false, reason: "test: turn off" });
    expect(off.status).toBe(202);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: e.userId } })).status).toBe("ACTIVE");
  });

  it("the database refuses a Super Admin role row added or removed outside an applied change", async () => {
    const sa = await prisma.role.findUniqueOrThrow({ where: { code: "SUPER_ADMIN" } });
    await expect(prisma.userRole.create({ data: { userId: f.userId, roleId: sa.id, assignedByUserId: a.userId } })).rejects.toThrow(/DIRECTOR_CHANGE_NEEDS_CONFIRMATION/);
    await expect(prisma.userRole.delete({ where: { userId_roleId: { userId: e.userId, roleId: sa.id } } })).rejects.toThrow(/DIRECTOR_CHANGE_NEEDS_CONFIRMATION/);
    // a PENDING change named in the transaction is not enough
    const pending = await prisma.directorRoleChange.create({ data: { action: "GRANT_SUPER_ADMIN", targetUserId: f.userId, reason: "test", proposedByUserId: a.userId } });
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SELECT set_config('app.director_change', $1, true)", pending.id);
        await tx.userRole.create({ data: { userId: f.userId, roleId: sa.id, assignedByUserId: a.userId } });
      }),
    ).rejects.toThrow(/DIRECTOR_CHANGE_NEEDS_CONFIRMATION/);
    expect(await isSa(f.userId)).toBe(false);
  });
});
