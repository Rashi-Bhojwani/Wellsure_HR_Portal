import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { prisma } from "../../../lib/prisma";
import { addCalendarDays, businessToday } from "../../../lib/businessDate";
import { app, authHeader, cleanupFullTestEmployee, cleanupTestRole, createFullTestEmployee, grantPermissions, loginAs } from "../../employee/__tests__/employeeTestHelpers";
import { buildSetupReport, readinessOf } from "../setup/status";
import { buildSalaryWorld, giveSalary, teardownSalaryWorld, type SalaryWorld } from "./salaryTestHelpers";
import { cleanupPayrollRowsBy, useSecondDirectorChecks } from "./payrollTestHelpers";

interface SetupItemShape {
  id: string;
  required: boolean;
  status: string;
  problem?: unknown;
  detail: string;
  coverage: { covered: number; total: number; missing: Array<{ employeeId: string }> };
  enteredBy?: { name?: string; at?: string } | null;
  confirmedBy: { name?: string; at?: string };
}


// The Setup Checklist, "Ready for first real run" and the sign-offs behind them (docs/plans/PHASE_6.md §14J), against the real API and database.

describe("the setup checklist and the readiness screen", () => {
  let world: SalaryWorld;
  let sup: { employeeId: string; userId: string; employeeCode: string };
  let dev: { employeeId: string; userId: string; employeeCode: string };
  let signer: { employeeId: string; userId: string; employeeCode: string };
  let employee: { employeeId: string; userId: string; employeeCode: string };
  let supToken = "";
  let devToken = "";
  let signerToken = "";
  let employeeToken = "";
  const signerRole = `TEST_SIGNER_${Date.now()}`;
  const everyone: Array<{ employeeId: string }> = [];
  let restoreSeeded: (() => Promise<void>) | null = null;
  const get = (t: string, p: string) => request(app).get(`/api/payroll${p}`).set(...authHeader(t));
  const post = (t: string, p: string, b: object = {}) => request(app).post(`/api/payroll${p}`).set(...authHeader(t)).send(b);
  const item = async (id: string) => {
    const r = await get(supToken, "/setup");
    expect(r.status).toBe(200);
    return (r.body.sections as Array<{ items: Array<SetupItemShape> }>).flatMap((s) => s.items).find((i) => i.id === id)!;
  };

  beforeAll(async () => {
    world = await buildSalaryWorld();
    sup = await createFullTestEmployee(world.org, { roleCode: "SUPER_ADMIN" });
    dev = await createFullTestEmployee(world.org, { roleCode: DEVELOPER_ROLE_CODE });
    await grantPermissions(signerRole, ["payroll.approve", "payroll.rules.view", "payroll.salary.view", "employee.bank.view", "employee.statutory.view"]);
    signer = await createFullTestEmployee(world.org, { roleCode: signerRole });
    employee = await createFullTestEmployee(world.org, { roleCode: "EMPLOYEE" });
    world.userIds.push(sup.userId, dev.userId, signer.userId, employee.userId);
    // The people whose pay is under test are the three staff and the plain employee. The payroll and admin accounts that act in the test are marked inactive for its length
    // (nobody changes their own pay, so they could not be given a salary by the same maker anyway).
    everyone.push(...world.staff, employee);
    // The seeded company is in the test database: the set under test is these ten people, so everyone else "joins" after today for the length of the test.
    await prisma.employee.updateMany({ where: { id: { in: [world.maker, world.checkerA, world.checkerB, world.outsider, sup, dev, signer].map((p) => p.employeeId) } }, data: { status: "INACTIVE" } });
    const others = await prisma.employee.findMany({ where: { id: { notIn: everyone.map((e) => e.employeeId) }, status: "ACTIVE" }, select: { id: true, dateOfJoining: true } });
    // A year after "today", never a fixed date: a fixed 2027-06-01 made them employed again from that day on, and the clock audit failed this file from June 2027.
    await prisma.employee.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { dateOfJoining: addCalendarDays(businessToday(), 366) } });
    restoreSeeded = async () => {
      for (const o of others) await prisma.employee.update({ where: { id: o.id }, data: { dateOfJoining: o.dateOfJoining } });
    };
    [supToken, devToken, signerToken, employeeToken] = await Promise.all([loginAs(sup.employeeCode), loginAs(dev.employeeCode), loginAs(signer.employeeCode), loginAs(employee.employeeCode)]);
  }, 300_000);
  afterAll(async () => {
    await restoreSeeded?.();
    for (const p of [employee, signer, dev, sup]) await cleanupFullTestEmployee(p.employeeId);
    await teardownSalaryWorld(world);
    await cleanupTestRole(signerRole);
  });

  it("is open to whoever may see payroll rules, closed to an employee, and shows statuses in words, never a value", async () => {
    expect((await get(employeeToken, "/setup")).status).toBe(403);
    expect((await get(employeeToken, "/setup/ready")).status).toBe(403);
    const r = await get(devToken, "/setup"); // the developer sees the state of the setup: that is how it is operated
    expect(r.status).toBe(200);
    expect(r.body.sections.map((s: { id: string }) => s.id)).toEqual(["identifiers", "law", "company", "salary", "bank", "files", "people", "safety"]);
    const identifiers = r.body.sections[0].items;
    expect(identifiers.map((i: { id: string }) => i.id).sort()).toEqual(["rule:COMPANY_PAN", "rule:ESI_EMPLOYER_CODE", "rule:LWF_REGISTRATION", "rule:PF_ESTABLISHMENT_CODE", "rule:PT_REGISTRATION", "rule:TAN"]);
    for (const i of identifiers) expect(i.permissionNote).toMatch(/Company identifiers/);
    for (const i of r.body.sections.flatMap((s: { items: Array<SetupItemShape> }) => s.items)) {
      expect(["NOT_SET", "PLACEHOLDER", "CONFIRMED"]).toContain(i.status);
      expect(typeof i.why).toBe("string");
      expect((i.where as { path: string }).path).toMatch(/^\/admin\//);
    }
    expect(r.body.readiness.ready).toBe(false);
  });

  it("is red until every required item is Confirmed, and says exactly what is missing and where to enter it", async () => {
    const r = await get(devToken, "/setup/ready");
    expect(r.status).toBe(200);
    expect(r.body.ready).toBe(false);
    const ids = r.body.blockers.map((b: { itemId: string }) => b.itemId);
    expect(ids).toEqual(expect.arrayContaining(["rule:PF_ESTABLISHMENT_CODE", "rule:PAY_DAYS_BASIS", "layout:BANK_TEMPLATE", "bank:debit-account", "people:salaries", "people:bank"]));
    for (const b of r.body.blockers) {
      expect(b.missing.length).toBeGreaterThan(10);
      expect(b.where.path).toMatch(/^\/admin\//);
    }
    // Not needed for the first run: listed apart, never blocking.
    const optional = r.body.notRequiredYet.map((n: { itemId: string }) => n.itemId);
    expect(optional).toEqual(expect.arrayContaining(["rule:TAN", "rule:ENCASH_TAXABLE", "layout:PF_ECR"]));
    expect(ids).not.toContain("rule:TAN");
    expect(ids).not.toContain("layout:PF_ECR");
    // The shipped placeholders need a director's confirmation: they are blockers too.
    expect(ids).toContain("rule:PF_EMPLOYEE_RATE");
  });

  it("people's data: Not set, then partial with the people who lack it named, then complete but not checked", async () => {
    const before = await item("people:salaries");
    expect(before.status).toBe("NOT_SET");
    for (const p of world.staff) await giveSalary(world, p.employeeId, "600000");
    const partial = await item("people:salaries");
    expect(partial.status).toBe("PLACEHOLDER");
    expect(partial.coverage.covered).toBe(3);
    expect(partial.coverage.total).toBe(everyone.length);
    expect(partial.coverage.missing.map((m: { employeeId: string }) => m.employeeId)).toEqual([employee.employeeId]);
    expect(partial.detail).toMatch(/still need them/);
    await giveSalary(world, employee.employeeId, "600000");
    const complete = await item("people:salaries");
    expect(complete.status).toBe("PLACEHOLDER");
    expect(complete.coverage).toMatchObject({ covered: everyone.length, total: everyone.length });
    expect(complete.detail).toMatch(/still has to check them/);
  }, 300_000);

  it("a sign-off needs a payroll approver who may see the data, and never someone who entered some of it", async () => {
    const preview = (t: string, area: string) => post(t, `/setup/signoffs/${area}/preview`);
    expect((await preview(world.tokens.outsider, "SALARIES")).status).toBe(403); // somebody with no payroll permission holds no payroll.approve
    expect((await preview(world.tokens.checkerA, "BANK_ACCOUNTS")).status).toBe(200); // a director holds every permission, bank details included
    // The salaries were applied by the maker, so the maker could not sign (and holds no approve anyway); a signer with the right permissions can.
    const p = await preview(signerToken, "SALARIES");
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ blocked: null, covered: everyone.length, total: everyone.length });
    expect(p.body.enteredBy.length).toBeGreaterThan(0);
    // Somebody who entered a bank account (here, one the Super Admin wrote) cannot sign off the bank accounts.
    const row = await prisma.employeeBankAccount.findFirstOrThrow({ where: { employeeId: world.staff[0]!.employeeId } });
    await prisma.employeeBankAccount.update({ where: { id: row.id }, data: { createdByUserId: sup.userId } });
    const own = await preview(supToken, "BANK_ACCOUNTS");
    expect(own.body.blocked).toMatch(/You entered some of these/);
    const refused = await post(supToken, "/setup/signoffs/BANK_ACCOUNTS", { fingerprint: own.body.fingerprint, note: "looks right to me" });
    expect([refused.status, refused.body.error.code]).toEqual([403, "SIGNER_ENTERED_THIS"]);
    // An incomplete set cannot be signed off.
    const noUan = await preview(signerToken, "STATUTORY_IDS");
    expect(noUan.body.blocked).toMatch(/still have no PF numbers/);
    expect((await post(signerToken, "/setup/signoffs/STATUTORY_IDS", { fingerprint: noUan.body.fingerprint, note: "should not work" })).status).toBe(409);
  });

  it("on director authority a director may sign off bank accounts they entered themselves: recorded as such, the other director told; a plain approver still may not", async () => {
    const restore = await useSecondDirectorChecks({ SETUP_SIGNOFF: false });
    try {
      const p = await post(supToken, "/setup/signoffs/BANK_ACCOUNTS/preview"); // sup wrote one of the bank accounts in the test above
      expect(p.body.blocked).toBeNull();
      const done = await post(supToken, "/setup/signoffs/BANK_ACCOUNTS", { fingerprint: p.body.fingerprint, note: "checked against the bank letters" });
      expect(done.status).toBe(201);
      const row = await prisma.payrollSetupSignoff.findUniqueOrThrow({ where: { id: done.body.id } });
      expect([row.authority, row.signedByUserId]).toEqual(["DIRECTOR_AUTHORITY", sup.userId]);
      const notice = await prisma.directorActionNotice.findFirstOrThrow({ where: { step: "SETUP_SIGNOFF", actorUserId: sup.userId }, include: { receipts: true } });
      expect(notice.receipts.map((r) => r.recipientUserId)).not.toContain(sup.userId);
      expect(notice.receipts.length).toBeGreaterThan(0);
      // The readiness screen does not flag it, because it is a recorded director-authority act.
      expect((await item("people:bank")).status).toBe("CONFIRMED");
      // Someone who is not a director gains nothing from the switch: the signer role who entered rows is still barred.
      await prisma.employeeBankAccount.updateMany({ where: { employeeId: world.staff[1]!.employeeId }, data: { createdByUserId: signer.userId } });
      const q = await post(signerToken, "/setup/signoffs/BANK_ACCOUNTS/preview");
      expect(q.body.blocked).toMatch(/You entered some of these/);
    } finally {
      await restore();
    }
    // Switched back on: the same director is refused again.
    const again = await post(supToken, "/setup/signoffs/BANK_ACCOUNTS/preview");
    expect(again.body.blocked).toMatch(/You entered some of these/);
  }, 300_000);

  it("signing off makes the item Confirmed, by a named person on a date; any change afterwards makes it stale again", async () => {
    const p = await post(signerToken, "/setup/signoffs/SALARIES/preview");
    const wrong = await post(signerToken, "/setup/signoffs/SALARIES", { fingerprint: "payroll-hash-v1:" + "0".repeat(64), note: "checked against the letters" });
    expect([wrong.status, wrong.body.error.code]).toEqual([409, "PREVIEW_STALE"]);
    expect((await post(signerToken, "/setup/signoffs/SALARIES", { fingerprint: p.body.fingerprint, note: "x" })).status).toBe(400); // say what you checked
    const done = await post(signerToken, "/setup/signoffs/SALARIES", { fingerprint: p.body.fingerprint, note: "checked against the signed salary letters" });
    expect(done.status).toBe(201);
    const confirmed = await item("people:salaries");
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.confirmedBy.name).toBeTruthy();
    expect(confirmed.detail).toMatch(/were checked by/);
    expect(await prisma.auditLog.count({ where: { action: "payroll.setup.signed_off", entityId: "SALARIES", actorUserId: signer.userId } })).toBe(1);
    // A new salary revision for anyone changes the set: the sign-off no longer covers it.
    await giveSalary(world, world.staff[0]!.employeeId, "720000", "2026-04-01");
    const stale = await item("people:salaries");
    expect(stale.status).toBe("PLACEHOLDER");
    expect(stale.detail).toMatch(/something changed after .* signed off/);
    await expect(prisma.payrollSetupSignoff.update({ where: { id: done.body.id }, data: { note: "changed" } })).rejects.toThrow(/APPEND_ONLY/);
  }, 300_000);

  it("the readiness screen does not trust the confirm button: a value confirmed by the person who entered it is a blocker", async () => {
    const key = "PAY_DAYS_BASIS";
    const author = world.maker.userId;
    // The database's own trigger refuses a self-confirmation; it is switched off for the length of this test so the readiness check can be shown to catch one on its own.
    await prisma.$executeRawUnsafe('ALTER TABLE "payroll_item_confirmations" DISABLE TRIGGER "payroll_item_confirmations_guard"');
    try {
      await prisma.payrollItemVersion.create({ data: { kind: "RULE", key, version: 1, value: "CALENDAR_DAYS", valueHash: "payroll-hash-v1:test", note: "", authorUserId: author } });
      await prisma.payrollItemConfirmation.create({ data: { kind: "RULE", key, version: 1, valueHash: "payroll-hash-v1:test", confirmedByUserId: author, note: "self" } });
      const report = await buildSetupReport();
      const it = report.sections.flatMap((s) => s.items).find((i) => i.id === `rule:${key}`)!;
      expect(it.status).toBe("CONFIRMED");
      expect(it.problem).toMatch(/confirmed by the person who entered it/);
      const blocker = readinessOf(report).blockers.find((b) => b.itemId === `rule:${key}`);
      expect(blocker?.missing).toMatch(/confirmed by the person who entered it/);
    } finally {
      await cleanupPayrollRowsBy([author]);
      await prisma.$executeRawUnsafe('ALTER TABLE "payroll_item_confirmations" ENABLE TRIGGER "payroll_item_confirmations_guard"');
    }
  });

  it("the access table names who can see, change and confirm each kind of secret, and the developer is on none of the lines", async () => {
    const r = await get(devToken, "/setup/access");
    expect(r.status).toBe(200);
    const byId = Object.fromEntries(r.body.classes.map((c: { id: string }) => [c.id, c]));
    const names = (rows: Array<{ userId: string }>) => rows.map((h) => h.userId);
    expect(names(byId.COMPANY_IDENTIFIERS.edit)).toContain(world.maker.userId);
    expect(names(byId.COMPANY_IDENTIFIERS.confirm)).toContain(world.checkerA.userId);
    expect(names(byId.COMPANY_IDENTIFIERS.edit)).toContain(sup.userId);
    for (const c of r.body.classes) for (const kind of ["view", "edit", "confirm"]) expect(names(c[kind]), `${c.id} ${kind}`).not.toContain(dev.userId);
    expect(r.body.developers).toEqual(expect.arrayContaining([expect.objectContaining({ userId: dev.userId, holdsAnySecret: false, isSuperAdmin: false })]));
    expect((await get(employeeToken, "/setup/access")).status).toBe(403);
  });

  it("the safety items say plainly whether two different people can prepare and approve payroll", async () => {
    const two = await item("safety:two-people");
    expect(two.status).toBe("CONFIRMED");
    const dv = await item("safety:developer");
    expect(dv.status).toBe("CONFIRMED");
    // Configure the developer wrongly (raw SQL, a sensitive key on the Developer role): the screen says so even though access is stripped anyway.
    const role = await prisma.role.findUniqueOrThrow({ where: { code: DEVELOPER_ROLE_CODE } });
    const perm = await prisma.permission.findUniqueOrThrow({ where: { key: "payroll.salary.view" } });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
    try {
      const bad = await item("safety:developer");
      expect(bad.status).toBe("NOT_SET");
      expect(bad.detail).toMatch(/is set up with payroll\.salary\.view/);
      expect((await get(devToken, "/salary/employees")).status).toBe(403); // still cut off
    } finally {
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: perm.id } });
    }
  });
});
