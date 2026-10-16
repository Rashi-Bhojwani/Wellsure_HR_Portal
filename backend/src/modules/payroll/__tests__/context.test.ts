import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_WATERMARK_TEXT } from "@shared/constants/payrollRules";
import { checkerAvailability } from "../approvals";
import { applyWatermarkToHtml, buildPayrollXlsx, watermarkHtml, withWatermark } from "../exports";
import { dec } from "../money";
import { RuleContext, RuleNotSetError, assertRunIsReal, pinStatuses, watermarkFor, watermarkFromStatuses } from "../rules/context";
import { confirmRule, editRule, ensurePayrollRules, previewConfirm, previewEdit } from "../rules/governed";
import { cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { cleanupPayrollRowsBy } from "./payrollTestHelpers";

// Pins, the gates, the watermark. A run is judged against the LIVE state of the exact rule versions it read.

describe("RuleContext, the gates and the watermark", () => {
  let org: TestOrgMasters;
  let maker: { employeeId: string; userId: string };
  let checker: { employeeId: string; userId: string };

  beforeAll(async () => {
    await ensurePayrollRules();
    org = await createEmployeeTestOrgMasters();
    maker = await createFullTestEmployee(org, { roleCode: "PAYROLL_ADMIN" });
    checker = await createFullTestEmployee(org, { roleCode: "PAYROLL_APPROVER" });
  });

  afterAll(async () => {
    await cleanupPayrollRowsBy([maker.userId, checker.userId]);
    await cleanupFullTestEmployee(maker.employeeId);
    await cleanupFullTestEmployee(checker.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  const who = (userId: string) => ({ userId });
  async function confirmStatutory(userId: string, key: string, typed: unknown) {
    const p = await previewConfirm(key, userId);
    return confirmRule(key, { version: p.version, typedValue: typed, note: "checked against its source", fingerprint: p.fingerprint }, who(userId));
  }

  it("reading a rule pins exactly that rule, and only the rules read", async () => {
    const ctx = await RuleContext.load();
    expect(ctx.pins()).toEqual([]);
    expect(ctx.decimal("PF_WAGE_CEILING").toFixed()).toBe("15000");
    expect(ctx.decimal("PF_EMPLOYEE_RATE").equals(dec("12"))).toBe(true);
    expect(ctx.pins().map((p) => p.key)).toEqual(["PF_EMPLOYEE_RATE", "PF_WAGE_CEILING"]); // sorted; ESI, PT and the rest not read, so not pinned
    expect(ctx.pins()[0]).toMatchObject({ key: "PF_EMPLOYEE_RATE", version: 1 });
    expect(ctx.pins()[0]!.valueHash).toMatch(/^payroll-hash-v1:/);
  });

  it("a rule nobody has entered a value for stops the calculation, by name, rather than guessing", async () => {
    const ctx = await RuleContext.load();
    expect(() => ctx.rule("PAY_DAYS_BASIS")).toThrow(RuleNotSetError);
    try {
      ctx.rule("PAY_DAYS_BASIS");
    } catch (e) {
      expect((e as RuleNotSetError).code).toBe("RULE_NOT_SET");
      expect((e as RuleNotSetError).message).toContain("Pay days basis");
    }
    expect(ctx.pins()).toEqual([]); // a read that fails pins nothing
    expect(ctx.isSet("PAY_DAYS_BASIS")).toBe(false);
    expect(() => ctx.rule("NOT_A_RULE")).toThrow(/no payroll rule/);
  });

  it("a run that read a Placeholder cannot be real; one that read nothing statutory is not blocked by them", async () => {
    const ctx = await RuleContext.load();
    ctx.decimal("PF_EMPLOYEE_RATE");
    ctx.rule("ESI_ROUNDING");
    await expect(assertRunIsReal(ctx.pins(), "approved")).rejects.toMatchObject({
      status: 409,
      code: "PLACEHOLDER_RULES",
      details: { rules: [{ key: "ESI_ROUNDING", label: "Rounding of ESI contributions" }, { key: "PF_EMPLOYEE_RATE", label: "PF: employee rate" }] },
    });
    // PF switched off for everyone: nothing statutory was read, so nothing statutory can block it.
    await expect(assertRunIsReal(new_pins_none(), "approved")).resolves.toBeUndefined();
    const wm = await watermarkFor(ctx.pins());
    expect(wm).toMatchObject({ test: true, text: TEST_WATERMARK_TEXT });
    expect(wm.rules.map((r) => r.key)).toEqual(["ESI_ROUNDING", "PF_EMPLOYEE_RATE"]);
  });

  it("confirming the very version a run used promotes it to real with no recalculation; editing the rule makes the run stale", async () => {
    const ctx = await RuleContext.load();
    ctx.decimal("PF_ADMIN_RATE");
    const pins = ctx.pins();
    expect((await pinStatuses(pins))[0]).toMatchObject({ status: "PLACEHOLDER", stale: false });

    // A different person types the value in again and confirms it.
    const done = await confirmStatutory(checker.userId, "PF_ADMIN_RATE", "0.50");
    expect(done.status).toBe("CONFIRMED");
    expect((await pinStatuses(pins))[0]).toMatchObject({ status: "CONFIRMED", stale: false });
    await expect(assertRunIsReal(pins, "approved")).resolves.toBeUndefined();
    expect((await watermarkFor(pins)).test).toBe(false);

    // The rule is then edited (a proposed change): the run that used the old version is stale and must be recalculated; a fresh read is a Placeholder again.
    const preview = await previewEdit("PF_ADMIN_RATE", "0.6");
    expect(preview.willResetConfirmation).toBe(true);
    await editRule("PF_ADMIN_RATE", { value: "0.6", note: "trying a change", fingerprint: preview.fingerprint }, who(maker.userId));
    expect((await pinStatuses(pins))[0]).toMatchObject({ status: "CONFIRMED", stale: true, currentVersion: 2 }); // the old version is still the confirmed one it used
    await expect(assertRunIsReal(pins, "approved")).rejects.toMatchObject({ status: 409, code: "RULES_CHANGED" });
    const fresh = await RuleContext.load();
    expect(fresh.decimal("PF_ADMIN_RATE").toFixed()).toBe("0.6");
    await expect(assertRunIsReal(fresh.pins(), "approved")).rejects.toMatchObject({ code: "PLACEHOLDER_RULES" });
    // A draft on the edited value is allowed and is a test.
    expect((await watermarkFor(fresh.pins())).test).toBe(true);
  });

  it("a rule confirmation made by somebody else and for a different value does not carry over", async () => {
    const ctx = await RuleContext.load();
    ctx.decimal("PF_EDLI_RATE");
    const wrongPin = { ...ctx.pins()[0]!, valueHash: "payroll-hash-v1:something-else" };
    await confirmStatutory(checker.userId, "PF_EDLI_RATE", "0.5");
    expect((await pinStatuses([wrongPin]))[0]!.status).toBe("PLACEHOLDER"); // the confirmation vouches for a hash; a pin with another hash is not covered by it
    expect((await pinStatuses(ctx.pins()))[0]!.status).toBe("CONFIRMED");
  });

  it("the test helper builds a context without the database, and still pins", () => {
    const ctx = RuleContext.fromValuesForTests({ PF_EMPLOYEE_RATE: "12" });
    expect(ctx.decimal("PF_EMPLOYEE_RATE").toFixed()).toBe("12");
    expect(ctx.pins()).toHaveLength(1);
    expect(() => ctx.rule("ESI_ROUNDING")).toThrow(RuleNotSetError);
  });

  it("checker availability for a rule confirmation names the real checkers and leaves out the author", async () => {
    const seen = await checkerAvailability("RULE_CONFIRM", { makerUserId: checker.userId });
    expect(seen.excluded.map((e) => e.userId)).toContain(checker.userId);
    expect(seen.eligible.map((e) => e.userId)).not.toContain(checker.userId);
    const open = await checkerAvailability("RULE_CONFIRM", { makerUserId: null });
    expect(open.eligible.map((e) => e.userId)).toContain(checker.userId);
    expect(open.eligible.map((e) => e.userId)).not.toContain(maker.userId); // PAYROLL_ADMIN cannot confirm
  });
});

const new_pins_none = () => [] as const;

describe("the watermark on what leaves the screen", () => {
  const draft = watermarkFromStatuses([{ pin: { key: "PF_EMPLOYEE_RATE", version: 1, valueHash: "h" }, label: "PF: employee rate", status: "PLACEHOLDER", stale: false, currentVersion: 1 }]);
  const real = watermarkFromStatuses([{ pin: { key: "PF_EMPLOYEE_RATE", version: 1, valueHash: "h" }, label: "PF: employee rate", status: "CONFIRMED", stale: false, currentVersion: 1 }]);
  const sheets = [{ name: "Salary register", columns: [{ key: "a", header: "Employee" }, { key: "n", header: "Net pay", type: "money" as const }], rows: [{ a: "Asha", n: "40000.00" }] }];

  it("a draft's workbook says TEST on every sheet, in the file itself", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildPayrollXlsx(sheets, draft)) as never);
    const ws = wb.worksheets[0]!;
    expect(ws.name).toBe("TEST Salary register");
    expect(String(ws.getRow(1).getCell(1).value)).toBe(TEST_WATERMARK_TEXT);
    expect(String(ws.getRow(2).getCell(1).value)).toContain("PF: employee rate");
    expect(String(ws.getRow(3).getCell(1).value)).toBe("Employee"); // the table is still there, below the banner
    expect(String(ws.getRow(4).getCell(1).value)).toBe("Asha");
    expect(ws.getRow(1).font?.bold).toBe(true);
    // The footer repeats it, so a cropped screenshot of the bottom of the sheet carries it too.
    const last = ws.getRow(ws.rowCount).getCell(1).value;
    expect(String(last)).toBe(TEST_WATERMARK_TEXT);
  });

  it("a confirmed run's workbook carries no mark at all", async () => {
    expect(withWatermark(sheets, real)).toBe(sheets);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildPayrollXlsx(sheets, real)) as never);
    const ws = wb.worksheets[0]!;
    expect(ws.name).toBe("Salary register");
    expect(String(ws.getRow(1).getCell(1).value)).toBe("Employee");
    expect(JSON.stringify(ws.getSheetValues())).not.toContain("TEST");
  });

  it("a draft's payslip preview HTML has the diagonal mark and the top line; a confirmed one is untouched", () => {
    const html = "<html><body><h1>Payslip</h1></body></html>";
    const marked = applyWatermarkToHtml(html, draft);
    expect(marked).toContain(TEST_WATERMARK_TEXT);
    expect(marked).toContain("wm-diag");
    expect(marked).toContain("PF: employee rate");
    expect(marked.indexOf("wm-top")).toBeLessThan(marked.indexOf("</body>"));
    expect(applyWatermarkToHtml(html, real)).toBe(html);
    expect(watermarkHtml(real)).toBe("");
    // The rule names are escaped (they could one day come from user-entered labels).
    const hostile = watermarkFromStatuses([{ pin: { key: "X", version: 1, valueHash: "h" }, label: '<script>alert("x")</script>', status: "PLACEHOLDER", stale: false, currentVersion: 1 }]);
    expect(watermarkHtml(hostile)).not.toContain("<script>");
  });
});
