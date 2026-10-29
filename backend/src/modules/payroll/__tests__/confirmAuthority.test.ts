import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../../lib/prisma";
import { cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { confirmRule, editRule, getRule, previewConfirm, previewEdit } from "../rules/governed";
import { confirmComponent, previewComponentConfirm, previewComponentSave, saveComponent } from "../salary/components";
import { cleanupPayrollRowsBy, useSecondDirectorChecks } from "./payrollTestHelpers";

// Confirming a value on a director's own authority (docs/plans/DIRECTOR_AUTHORITY.md §4.3, D2). By default the director who wrote a rule, a component, a structure or a layout may
// confirm it themselves: it is recorded as self-confirmed under director authority, and the other director is told. With the step's check switched on, it is a different director,
// exactly as before (selfConfirmLayers.test.ts proves every layer of that).

describe("a director confirms their own value", () => {
  let org: TestOrgMasters;
  let a: { employeeId: string; userId: string; employeeCode: string };
  let b: { employeeId: string; userId: string; employeeCode: string };
  let hr: { employeeId: string; userId: string; employeeCode: string };
  let restore: () => Promise<void>;
  const key = "NEGATIVE_NET_POLICY";

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    a = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    b = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    hr = await createFullTestEmployee(org, { roleCode: "HR_EXECUTIVE" });
    restore = await useSecondDirectorChecks({ RULE_CONFIRM: false });
  });
  afterAll(async () => {
    await restore();
    await cleanupPayrollRowsBy([a.userId, b.userId, hr.userId]);
    for (const p of [hr, b, a]) await cleanupFullTestEmployee(p.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("on authority: the preview says so, the confirmation is recorded as self-confirmed under director authority, the value is Confirmed, and the other director is told", async () => {
    const e = await previewEdit(key, "BLOCK");
    await editRule(key, { value: "BLOCK", note: "typed by me", fingerprint: e.fingerprint }, { userId: a.userId });
    const p = await previewConfirm(key, a.userId);
    expect([p.blocked, p.checkers.state]).toEqual([null, "SELF"]);
    expect(p.checkers.message).toMatch(/yourself.*other director is told/i);
    await confirmRule(key, { version: p.version, note: "checked it against the written policy", fingerprint: p.fingerprint }, { userId: a.userId });
    expect((await getRule(key)).rule.status).toBe("CONFIRMED");
    const conf = await prisma.payrollItemConfirmation.findFirstOrThrow({ where: { kind: "RULE", key }, orderBy: { version: "desc" } });
    expect([conf.confirmedByUserId, conf.selfConfirmed]).toEqual([a.userId, true]);
    const approval = await prisma.payrollApproval.findUniqueOrThrow({ where: { id: conf.approvalId! } });
    expect([approval.authority, approval.makerUserId, approval.checkerUserId, approval.status]).toEqual(["DIRECTOR_AUTHORITY", a.userId, a.userId, "CONSUMED"]);
    const notice = await prisma.directorActionNotice.findFirstOrThrow({ where: { step: "RULE_CONFIRM", actorUserId: a.userId }, include: { receipts: true } });
    expect(notice.receipts.map((r) => r.recipientUserId)).not.toContain(a.userId);
    expect(notice.receipts.map((r) => r.recipientUserId)).toContain(b.userId);
    expect(JSON.stringify(notice)).not.toContain("BLOCK"); // no value, only that a rule was confirmed
  });

  it("a component the same way, and a person who is not a director never can: an HR Executive is refused, in both modes", async () => {
    const code = `T${Date.now().toString(36).toUpperCase()}_AUTH`.slice(0, 24); // allow-clock: a unique test code, not a business date
    const value = { name: "Auth", type: "EARNING", taxable: true, pfApplicable: false, esiApplicable: false, prorates: true, payslipLabel: "Auth", payslipOrder: 1 };
    const sp = await previewComponentSave(code, value);
    await saveComponent(code, { value, fingerprint: sp.fingerprint }, { userId: a.userId });
    const c = await previewComponentConfirm(code, a.userId);
    expect(c.blocked).toBeNull();
    // The other director confirming it: no self-confirmation recorded.
    const cb = await previewComponentConfirm(code, b.userId);
    expect(cb.blocked).toBeNull();
    await confirmComponent(code, { version: cb.version, note: "checked by the second director", fingerprint: cb.fingerprint }, { userId: b.userId });
    const conf = await prisma.payrollItemConfirmation.findFirstOrThrow({ where: { kind: "COMPONENT", key: code } });
    expect([conf.confirmedByUserId, conf.selfConfirmed]).toEqual([b.userId, false]);
    expect((await prisma.payrollApproval.findUniqueOrThrow({ where: { id: conf.approvalId! } })).authority).toBe("SECOND_DIRECTOR");
    // And a second component, confirmed by its own author on authority.
    const code2 = `${code}2`.slice(0, 24);
    const sp2 = await previewComponentSave(code2, value);
    await saveComponent(code2, { value, fingerprint: sp2.fingerprint }, { userId: a.userId });
    const c2 = await previewComponentConfirm(code2, a.userId);
    await confirmComponent(code2, { version: c2.version, note: "my own, on my authority", fingerprint: c2.fingerprint }, { userId: a.userId });
    expect((await prisma.payrollItemConfirmation.findFirstOrThrow({ where: { kind: "COMPONENT", key: code2 } })).selfConfirmed).toBe(true);
    // Somebody who is not a director: refused to confirm anything (no permission), whoever wrote it.
    const sp3 = await previewComponentSave(`${code}3`.slice(0, 24), value);
    await saveComponent(`${code}3`.slice(0, 24), { value, fingerprint: sp3.fingerprint }, { userId: a.userId });
    const c3 = await previewComponentConfirm(`${code}3`.slice(0, 24), hr.userId);
    await expect(confirmComponent(`${code}3`.slice(0, 24), { version: c3.version, note: "an HR person", fingerprint: c3.fingerprint }, { userId: hr.userId })).rejects.toMatchObject({ status: 403 });
  });

  it("with the check switched on for this step, the author is refused again, in the preview and in the confirmation", async () => {
    const undo = await useSecondDirectorChecks({ RULE_CONFIRM: true });
    try {
      const code = `T${Date.now().toString(36).toUpperCase()}_ON`.slice(0, 24); // allow-clock: a unique test code
      const value = { name: "On", type: "EARNING", taxable: true, pfApplicable: false, esiApplicable: false, prorates: true, payslipLabel: "On", payslipOrder: 1 };
      const sp = await previewComponentSave(code, value);
      await saveComponent(code, { value, fingerprint: sp.fingerprint }, { userId: a.userId });
      const c = await previewComponentConfirm(code, a.userId);
      expect(c.blocked).toMatch(/You wrote this value/);
      await expect(confirmComponent(code, { version: c.version, note: "my own", fingerprint: c.fingerprint }, { userId: a.userId })).rejects.toMatchObject({ code: "CHECKER_IS_MAKER" });
      expect(await prisma.payrollItemConfirmation.count({ where: { kind: "COMPONENT", key: code } })).toBe(0);
    } finally {
      await undo();
    }
  });
});
