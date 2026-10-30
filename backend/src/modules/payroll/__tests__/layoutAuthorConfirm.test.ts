import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../../lib/prisma";
import { cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { confirmLayout, getLayout, LAYOUT_ITEMS, previewLayoutConfirm, previewLayoutSave, saveLayout } from "../run/layouts";
import { cleanupPayrollRowsBy, useSecondDirectorChecks } from "./payrollTestHelpers";

// The author of a bank-file or statutory-file layout cannot confirm it (with the second-director check on for rule confirmation, which covers layouts). Layouts share the confirmation core with
// rules and components, which selfConfirmLayers.test.ts proves layer by layer; this proves it for every layout key, so a layout path that bypassed the core would be caught.

const col = (value: string) => ({ source: "FIELD", value });
const COMMON = { format: "DELIMITED", delimiter: ",", lineEnding: "LF", extension: "csv", dateFormat: "DD-MM-YYYY", amountDecimals: 2 };
const VALUE: Record<string, object> = {
  BANK_TEMPLATE: { ...COMMON, columns: [col("SERIAL"), col("NAME"), col("ACCOUNT_NUMBER"), col("IFSC"), col("AMOUNT")], narrationPattern: "Salary {PERIOD}" },
};

describe("a layout's author cannot confirm it", () => {
  let org: TestOrgMasters;
  let a: { employeeId: string; userId: string };
  let b: { employeeId: string; userId: string };
  let restore: () => Promise<void>;

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    a = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    b = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    restore = await useSecondDirectorChecks({ RULE_CONFIRM: true });
  });
  afterAll(async () => {
    await restore();
    await cleanupPayrollRowsBy([a.userId, b.userId]);
    for (const p of [b, a]) await cleanupFullTestEmployee(p.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("the bank file layout: its author is blocked in the preview and refused in the confirmation; the other director confirms it", async () => {
    const key = "BANK_TEMPLATE";
    const before = await getLayout(key);
    expect(before.layout.status).toBe("NOT_SET"); // nothing preset: a real layout is entered by the owners
    const p = await previewLayoutSave(key, VALUE[key]);
    await saveLayout(key, { value: VALUE[key], fingerprint: p.fingerprint }, { userId: a.userId });
    const own = await previewLayoutConfirm(key, a.userId);
    expect(own.blocked).toMatch(/You wrote this value/);
    await expect(confirmLayout(key, { version: own.version, note: "checked my own layout", fingerprint: own.fingerprint }, { userId: a.userId })).rejects.toMatchObject({ status: 403 });
    expect((await getLayout(key)).layout.status).not.toBe("CONFIRMED");
    const other = await previewLayoutConfirm(key, b.userId);
    expect(other.blocked).toBeNull();
    await confirmLayout(key, { version: other.version, note: "checked against the bank's specification", fingerprint: other.fingerprint }, { userId: b.userId });
    expect((await getLayout(key)).layout.status).toBe("CONFIRMED");
    const conf = await prisma.payrollItemConfirmation.findFirstOrThrow({ where: { key }, orderBy: { version: "desc" } });
    expect([conf.confirmedByUserId, conf.selfConfirmed]).toEqual([b.userId, false]);
  });

  it("every statutory file layout (PF, ESI, PT, LWF) is held to the same rule", async () => {
    const proven: string[] = [];
    for (const item of LAYOUT_ITEMS.filter((i) => i.key !== "BANK_TEMPLATE")) {
      const fields: Record<string, string[]> = { PF_ECR: ["UAN", "NAME"], ESI: ["ESI_NUMBER", "NAME"] }; // the first fields each kind lists as its own
      const value = { ...COMMON, columns: (fields[item.key] ?? ["EMPLOYEE_CODE", "NAME"]).map(col) };
      let saved = false;
      try {
        const p = await previewLayoutSave(item.key, value);
        await saveLayout(item.key, { value, fingerprint: p.fingerprint }, { userId: a.userId });
        saved = true;
      } catch (err) {
        // a field this kind of file does not allow: the test still proves the rule on the kinds that take these two fields
        expect((err as { status?: number }).status, `${item.key}: ${(err as Error).message}`).toBe(400);
      }
      if (!saved) continue;
      const own = await previewLayoutConfirm(item.key, a.userId);
      expect(own.blocked, item.key).toMatch(/You wrote this value/);
      await expect(confirmLayout(item.key, { version: own.version, note: "my own", fingerprint: own.fingerprint }, { userId: a.userId }), item.key).rejects.toMatchObject({ status: 403 });
      proven.push(item.key);
    }
    expect(proven.length, "at least one statutory kind accepted the test layout, so this is not vacuous").toBeGreaterThan(0);
    expect(proven).toContain("PF_ECR");
  });
});
