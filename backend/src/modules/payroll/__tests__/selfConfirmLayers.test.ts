import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../../lib/prisma";
import { cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { confirmRule, editRule, getRule, previewConfirm, previewEdit } from "../rules/governed";
import { confirmComponent, previewComponentConfirm, previewComponentSave, saveComponent } from "../salary/components";
import { cleanupPayrollRowsBy, cleanupPayrollSubject } from "./payrollTestHelpers";

// "Nobody confirms a value they wrote" is stopped by four independent layers. rules.test.ts proves the whole stack refuses it; THIS file proves each
// layer refuses it on its own, so weakening one is caught even though the others still hold:
//
//   1. the rules service         governed.confirmRule     (refuses before any approval is written)
//   2. the approval core         approvals.recordCompletedApproval
//   3. the approvals table       CHECK payroll_approvals_checker_not_maker
//   4. the confirmations table   trigger PAYROLL_CONFIRM_SAME_PERSON
//
// Layers 1 and 2 are exercised with the layers beneath them replaced, so a pass means that layer's own check fired.

vi.mock("../approvals", async (importOriginal) => {
  const real = await importOriginal<typeof import("../approvals")>();
  return {
    ...real,
    // Layer 1's test needs to know whether confirmRule got past its own check. The real function is restored for layer 2 via vi.importActual.
    recordCompletedApproval: vi.fn(async () => {
      throw new Error("LAYER_2_REACHED");
    }),
  };
});

describe("a person cannot confirm their own value: each layer on its own", () => {
  let org: TestOrgMasters;
  let author: { employeeId: string; userId: string; employeeCode: string };
  const key = "NEGATIVE_NET_POLICY";

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    author = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    const confirmPermission = await prisma.permission.findUniqueOrThrow({ where: { key: "payroll.rules.confirm" } });
    await prisma.userPermissionOverride.create({ data: { userId: author.userId, permissionId: confirmPermission.id, effect: "GRANT", reason: "test: holds maker and checker permissions", createdByUserId: author.userId } });
    const preview = await previewEdit(key, "BLOCK");
    await editRule(key, { value: "BLOCK", note: "typed by the person who will try to confirm it", fingerprint: preview.fingerprint }, { userId: author.userId });
  });

  afterAll(async () => {
    await prisma.userPermissionOverride.deleteMany({ where: { userId: author.userId } });
    await cleanupPayrollRowsBy([author.userId]);
    await cleanupPayrollSubject("layer-test-");
    await cleanupFullTestEmployee(author.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("layer 1, the rules service: refuses before an approval is even attempted", async () => {
    const { recordCompletedApproval } = await import("../approvals");
    const preview = await previewConfirm(key, author.userId);
    expect(preview.blocked).toMatch(/You wrote this value/);
    await expect(confirmRule(key, { version: preview.version, note: "checked my own work", fingerprint: preview.fingerprint }, { userId: author.userId })).rejects.toMatchObject({ code: "CHECKER_IS_MAKER" });
    expect(recordCompletedApproval).not.toHaveBeenCalled(); // it never got as far as layer 2 (which would have thrown LAYER_2_REACHED)
    expect((await getRule(key)).rule.status).toBe("PLACEHOLDER");
  });

  it("the same holds for a salary component: its author cannot confirm it, in the shared core, before any approval is attempted", async () => {
    const code = `T${Date.now().toString(36).toUpperCase()}_OWN`.slice(0, 24); // allow-clock: a unique test code, not a business date
    const value = { name: "Own", type: "EARNING", taxable: true, pfApplicable: false, esiApplicable: false, prorates: true, payslipLabel: "Own", payslipOrder: 1 };
    const p = await previewComponentSave(code, value);
    await saveComponent(code, { value, fingerprint: p.fingerprint }, { userId: author.userId });
    const c = await previewComponentConfirm(code, author.userId);
    expect(c.blocked).toMatch(/You wrote this value/);
    await expect(confirmComponent(code, { version: c.version, note: "my own component", fingerprint: c.fingerprint }, { userId: author.userId })).rejects.toMatchObject({ code: "CHECKER_IS_MAKER" });
    expect(await prisma.payrollItemConfirmation.count({ where: { kind: "COMPONENT", key: code } })).toBe(0);
  });

  it("layer 2, the approval core: refuses a checker who is the maker, whoever calls it", async () => {
    const { recordCompletedApproval } = await vi.importActual<typeof import("../approvals")>("../approvals");
    const subjectId = `layer-test-${Date.now()}`; // allow-clock: unique test id, not a business date
    await expect(
      recordCompletedApproval({ subject: "RULE_CONFIRM", subjectId, hash: "payroll-hash-v1:x", makerUserId: author.userId, checkerUserId: author.userId, previewFingerprint: "f", note: "self" }, prisma),
    ).rejects.toMatchObject({ code: "CHECKER_IS_MAKER" });
    expect(await prisma.payrollApproval.count({ where: { subjectId } })).toBe(0); // refused before anything was written
  });

  it("layer 3, the approvals table: the database refuses a checker equal to the maker", async () => {
    const subjectId = `layer-test-${Date.now()}-db`; // allow-clock: unique test id, not a business date
    const row = await prisma.payrollApproval.create({ data: { subject: "RULE_CONFIRM", subjectId, contentHash: "payroll-hash-v1:x", makerUserId: author.userId, previewFingerprint: "f" } });
    await expect(
      prisma.payrollApproval.update({ where: { id: row.id }, data: { status: "APPROVED", checkerUserId: author.userId, hashAtDecision: "payroll-hash-v1:x", decidedAt: new Date() } }), // allow-clock: test fixture
    ).rejects.toThrow(/payroll_approvals_checker_not_maker/);
    await expect(prisma.payrollApproval.create({ data: { subject: "RULE_CONFIRM", subjectId: `${subjectId}2`, contentHash: "payroll-hash-v1:x", makerUserId: author.userId, checkerUserId: author.userId, previewFingerprint: "f" } })).rejects.toThrow(/payroll_approvals_checker_not_maker/);
  });

  it("layer 4, the confirmations table: the database refuses a confirmation by the author", async () => {
    const version = await prisma.payrollItemVersion.findFirstOrThrow({ where: { key, authorUserId: author.userId }, orderBy: { version: "desc" } });
    await expect(
      prisma.payrollItemConfirmation.create({ data: { kind: "RULE", key, version: version.version, valueHash: version.valueHash, confirmedByUserId: author.userId, note: "self" } }),
    ).rejects.toThrow(/PAYROLL_CONFIRM_SAME_PERSON/);
    expect(await prisma.payrollItemConfirmation.count({ where: { key, version: version.version } })).toBe(0);
  });
});
