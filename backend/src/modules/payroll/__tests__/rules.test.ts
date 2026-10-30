import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PLACEHOLDER_SOURCE_LABEL, RULE_BY_KEY, RULE_CATALOG, SHIPPED_PLACEHOLDER_KEYS } from "@shared/constants/payrollRules";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { ensurePayrollRules, getRule, listRules } from "../rules/governed";
import { parseRuleValue } from "../rules/schemas";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { cleanupPayrollRowsBy, useSecondDirectorChecks } from "./payrollTestHelpers";

// Phase 6 P6-1: governed rules. Since Stage 3.2 NO rule ships a value, statutory ones included; an edit is an
// unconfirmed new version; a different person confirms; a statutory figure is confirmed only by typing it again.

describe("the rules catalog", () => {
  it("describes every rule, and ships no figure at all", () => {
    for (const r of RULE_CATALOG) {
      expect(r.label.length, r.key).toBeGreaterThan(3);
      expect(r.description.length, r.key).toBeGreaterThan(10);
      expect(r.affects.length, r.key).toBeGreaterThan(3);
      expect(r.whoConfirms.length, r.key).toBeGreaterThan(1);
      // Nothing is shipped: no rule, statutory or company, carries a value.
      expect(r.placeholder, r.key).toBeUndefined();
    }
    expect(SHIPPED_PLACEHOLDER_KEYS).toEqual([]);
    expect(new Set(RULE_CATALOG.map((r) => r.key)).size).toBe(RULE_CATALOG.length);
  });

  it("values still come out in canonical form", () => {
    expect(RULE_BY_KEY.PF_EMPLOYEE_RATE).toBeDefined();
    expect(parseRuleValue("PF_EMPLOYEE_RATE", "12.00")).toBe("12");
    expect(parseRuleValue("PF_WAGE_CEILING", "15000.0")).toBe("15000");
  });

  it("refuses nonsense values with a message that says what is wrong", () => {
    expect(() => parseRuleValue("PF_EMPLOYEE_RATE", "120")).toThrow(/cannot be more than 100/);
    expect(() => parseRuleValue("PF_EMPLOYEE_RATE", "twelve")).toThrow(/plain number/);
    expect(() => parseRuleValue("PF_ROUNDING", { mode: "HALF_UP", scale: 9 })).toThrow();
    expect(() => parseRuleValue("PF_ROUNDING", { mode: "SOMETIMES", scale: 0 })).toThrow();
    expect(() => parseRuleValue("PAY_DAYS_BASIS", "WEEKDAYS")).toThrow();
    expect(() => parseRuleValue("FIXED_DAYS_VALUE", 40)).toThrow();
    expect(() => parseRuleValue("PAYMENT_DATE_RULE", { monthOffset: 1, day: 31 })).toThrow();
    expect(parseRuleValue("PAYMENT_DATE_RULE", { monthOffset: 1, day: "LAST" })).toEqual({ monthOffset: 1, day: "LAST" });
    expect(() => parseRuleValue("ENCASH_DAILY_RATE_FORMULA", "BASIC /")).toThrow();
    expect(parseRuleValue("ENCASH_DAILY_RATE_FORMULA", "BASIC / 30")).toBe("BASIC / 30");
    expect(parseRuleValue("PF_ELIGIBLE_TYPES", ["PERMANENT", "CONTRACT", "PERMANENT"])).toEqual(["CONTRACT", "PERMANENT"]);
    expect(() => parseRuleValue("NOT_A_RULE", 1)).toThrow(/no such rule/);
  });

  it("checks the structure of a PT slab table: from zero, no gaps, open at the top", () => {
    const ok = { states: { KARNATAKA: { slabs: [{ fromGross: "0", toGross: "15000", monthlyAmount: "0" }, { fromGross: "15000", toGross: null, monthlyAmount: "200", monthOverrides: { "2": "300" } }] } } };
    expect(() => parseRuleValue("PT_SLABS", ok)).not.toThrow();
    const gap = { states: { KARNATAKA: { slabs: [{ fromGross: "0", toGross: "15000", monthlyAmount: "0" }, { fromGross: "16000", toGross: null, monthlyAmount: "200" }] } } };
    expect(() => parseRuleValue("PT_SLABS", gap)).toThrow(/should start at 15000/);
    const closed = { states: { KARNATAKA: { slabs: [{ fromGross: "0", toGross: "15000", monthlyAmount: "0" }] } } };
    expect(() => parseRuleValue("PT_SLABS", closed)).toThrow(/no upper limit/);
    expect(() => parseRuleValue("PT_SLABS", { states: { "bad key": ok.states.KARNATAKA } })).toThrow();
    // A month exception sits on the slab it replaces. The old shape, on the whole state, is refused rather than guessed at.
    const stateLevel = { states: { KARNATAKA: { slabs: [{ fromGross: "0", toGross: null, monthlyAmount: "200" }], monthOverrides: { "2": "300" } } } };
    expect(() => parseRuleValue("PT_SLABS", stateLevel)).toThrow();
    expect(() => parseRuleValue("PT_SLABS", { states: { KARNATAKA: { slabs: [{ fromGross: "0", toGross: null, monthlyAmount: "200", monthOverrides: { "13": "300" } }] } } })).toThrow();
  });
});

describe("governed rules in the database", () => {
  let org: TestOrgMasters;
  let maker: { employeeId: string; userId: string; employeeCode: string }; // PAYROLL_ADMIN: writes
  let checker: { employeeId: string; userId: string; employeeCode: string }; // PAYROLL_APPROVER: confirms
  let makerToken = "";
  let checkerToken = "";
  const userIds: string[] = [];

  let restoreChecks: () => Promise<void>; // these tests describe the two-director behaviour: a value is confirmed by a different director
  beforeAll(async () => {
    restoreChecks = await useSecondDirectorChecks();
    await ensurePayrollRules();
    org = await createEmployeeTestOrgMasters();
    maker = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    checker = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    userIds.push(maker.userId, checker.userId);
    makerToken = await loginAs(maker.employeeCode);
    checkerToken = await loginAs(checker.employeeCode);
  });

  afterAll(async () => {
    await restoreChecks();
    await cleanupPayrollRowsBy(userIds);
    await cleanupFullTestEmployee(maker.employeeId);
    await cleanupFullTestEmployee(checker.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  const api = (token: string) => ({
    get: (p: string) => request(app).get(`/api/payroll${p}`).set(...authHeader(token)),
    post: (p: string, b: object = {}) => request(app).post(`/api/payroll${p}`).set(...authHeader(token)).send(b),
    put: (p: string, b: object = {}) => request(app).put(`/api/payroll${p}`).set(...authHeader(token)).send(b),
  });

  /** Preview then confirm an edit, as the screen does. */
  async function setRule(token: string, key: string, value: unknown, note = "") {
    const preview = await api(token).post(`/rules/${key}/edit-preview`, { value });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    return api(token).put(`/rules/${key}`, { value, note, sourceNote: "test fixture: a made-up source note", effectiveFrom: "2026-04-01", fingerprint: preview.body.fingerprint });
  }
  async function confirmRule(token: string, key: string, over: { typedValue?: unknown; note?: string } = {}) {
    const preview = await api(token).post(`/rules/${key}/confirm-preview`);
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    return api(token).post(`/rules/${key}/confirm`, { version: preview.body.version, typedValue: over.typedValue, note: over.note ?? "checked against the CA's letter dated 1 Oct", fingerprint: preview.body.fingerprint });
  }

  it("ships nothing: every rule, statutory or company, is Not set, and a statutory one still needs a retype to confirm", async () => {
    const rules = await listRules();
    for (const r of rules) {
      expect(r.status, r.key).toBe("NOT_SET");
      expect(r.current, r.key).toBeNull();
    }
    expect(rules.find((r) => r.key === "PF_EMPLOYEE_RATE")?.requiresRetype).toBe(true);
    expect((await ensurePayrollRules()).created).toEqual([]);
  });

  it("a figure an older build shipped 'from memory' (authored by nobody) is never a value: the rule is Not set, and a director's entry replaces it", async () => {
    const key = "PF_EDLI_RATE";
    await prisma.payrollItemVersion.create({ data: { kind: "RULE", key, version: 1, value: "0.5", valueHash: "payroll-hash-v1:legacy", note: PLACEHOLDER_SOURCE_LABEL, authorUserId: null } });
    try {
      expect((await getRule(key)).rule.status).toBe("NOT_SET");
      const { RuleContext } = await import("../rules/context");
      await expect(RuleContext.load().then((c) => c.rule(key))).rejects.toThrow();
      expect((await setRule(makerToken, key, "0.5")).status).toBe(200);
      const r = await getRule(key);
      expect(r.rule.status).toBe("PLACEHOLDER");
      expect(r.rule.current?.version).toBe(2);
      expect((await RuleContext.load()).rule(key)).toBe("0.5");
    } finally {
      const legacy = await prisma.payrollItemVersion.findMany({ where: { kind: "RULE", key, authorUserId: null }, select: { id: true } });
      await deleteWithDependents("PayrollItemVersion", legacy.map((l) => l.id));
    }
  });

  it("a company-specific rule: Not set, then a Placeholder when somebody enters it, then Confirmed by a different person", async () => {
    const key = "PAY_DAYS_BASIS";
    expect((await getRule(key)).rule.status).toBe("NOT_SET");
    const nothing = await api(checkerToken).post(`/rules/${key}/confirm-preview`);
    expect(nothing.status).toBe(409); // nothing to confirm yet
    expect(nothing.body.error.code).toBe("RULE_NOT_SET");
    const set = await setRule(makerToken, key, "CALENDAR_DAYS", "HR confirmed on the call");
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({ status: "PLACEHOLDER", current: { version: 1, value: "CALENDAR_DAYS" } });
    expect(set.body.sourceLabel).toMatch(/^Entered by .* on \d{4}-\d{2}-\d{2}; not yet confirmed$/);
    expect(set.body.requiresRetype).toBe(false); // company-specific: no retype

    // The author cannot confirm their own value.
    const own = await api(makerToken).post(`/rules/${key}/confirm-preview`);
    expect(own.status).toBe(200); // D1: a director holds both permissions, so they may look...
    expect(own.body.blocked).toMatch(/You wrote this value/); // ...and are told why they cannot confirm what they wrote
    // A different person confirms.
    const done = await confirmRule(checkerToken, key);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body).toMatchObject({ status: "CONFIRMED", current: { version: 1, confirmation: { confirmedByUserId: checker.userId } } });
    expect(done.body.sourceLabel).toMatch(/^Confirmed by .* on \d{4}-\d{2}-\d{2}$/);
    // Already confirmed: nothing more to do.
    const again = await api(checkerToken).post(`/rules/${key}/confirm-preview`);
    expect(again.body.blocked).toMatch(/already confirmed/);
  });

  it("a person who holds BOTH permissions still cannot confirm a value they wrote: the preview says so and the confirm is refused", async () => {
    const both = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    userIds.push(both.userId);
    try {
      const perm = await prisma.permission.findUniqueOrThrow({ where: { key: "payroll.rules.confirm" } });
      await prisma.userPermissionOverride.create({ data: { userId: both.userId, permissionId: perm.id, effect: "GRANT", reason: "test: holds maker and checker permissions", createdByUserId: maker.userId } });
      const bothToken = await loginAs(both.employeeCode);
      const key = "LINE_ROUNDING";
      expect((await setRule(bothToken, key, { mode: "HALF_UP", scale: 1 }, "typed by the same person")).status).toBe(200);
      const preview = await api(bothToken).post(`/rules/${key}/confirm-preview`);
      expect(preview.status).toBe(200); // they may see it...
      expect(preview.body.blocked).toMatch(/You wrote this value/); // ...and are told why they cannot
      const attempt = await api(bothToken).post(`/rules/${key}/confirm`, { version: preview.body.version, note: "I checked my own work", fingerprint: preview.body.fingerprint });
      expect(attempt.status).toBe(403);
      expect(attempt.body.error.code).toBe("CHECKER_IS_MAKER");
      expect((await getRule(key)).rule.status).toBe("PLACEHOLDER");
      expect(await prisma.payrollItemConfirmation.count({ where: { key } })).toBe(0);
      // A different person can.
      expect((await confirmRule(checkerToken, key)).status).toBe(200);
    } finally {
      await prisma.userPermissionOverride.deleteMany({ where: { userId: both.userId } });
      await cleanupPayrollRowsBy([both.userId]);
      await cleanupFullTestEmployee(both.employeeId);
    }
  });

  it("changing a Confirmed rule resets it to unconfirmed, keeps the last Confirmed value in view, and needs a new confirmation", async () => {
    const key = "PAY_DAYS_BASIS";
    const edit = await api(makerToken).post(`/rules/${key}/edit-preview`, { value: "FIXED_DAYS" });
    expect(edit.body).toMatchObject({ willResetConfirmation: true, unchanged: false, before: { version: 1, value: "CALENDAR_DAYS", status: "CONFIRMED" } });
    expect(edit.body.lastConfirmed.value).toBe("CALENDAR_DAYS");
    const changed = await api(makerToken).put(`/rules/${key}`, { value: "FIXED_DAYS", note: "trying 30 fixed", fingerprint: edit.body.fingerprint });
    expect(changed.body).toMatchObject({ status: "PLACEHOLDER", current: { version: 2, value: "FIXED_DAYS" }, lastConfirmed: { version: 1, value: "CALENDAR_DAYS" } });
    // The old confirmed version is untouched in the history.
    const detail = await api(makerToken).get(`/rules/${key}`);
    expect(detail.body.history.map((h: { version: number }) => h.version)).toEqual([2, 1]);
    expect(detail.body.history[1].confirmation).not.toBeNull();
    expect(detail.body.history[0].confirmation).toBeNull();
    // Confirming the new one is a fresh act by a different person.
    const done = await confirmRule(checkerToken, key);
    expect(done.body).toMatchObject({ status: "CONFIRMED", current: { version: 2 } });
  });

  it("refuses a no-op edit, a stale preview and a stale confirm, and nothing changes", async () => {
    const key = "LEAVER_PAYMENT_TIMING";
    const first = await setRule(makerToken, key, "PAY_WITH_RUN");
    expect(first.status).toBe(200);
    const same = await api(makerToken).post(`/rules/${key}/edit-preview`, { value: "PAY_WITH_RUN" });
    expect(same.body.unchanged).toBe(true);
    const noop = await api(makerToken).put(`/rules/${key}`, { value: "PAY_WITH_RUN", fingerprint: same.body.fingerprint });
    expect(noop.status).toBe(409);
    expect(noop.body.error.code).toBe("NO_CHANGE");

    const staleView = await api(makerToken).post(`/rules/${key}/edit-preview`, { value: "HOLD_FOR_FNF" });
    await setRule(makerToken, key, "HOLD_FOR_FNF"); // somebody else gets in first
    const stale = await api(makerToken).put(`/rules/${key}`, { value: "HOLD_FOR_FNF", fingerprint: staleView.body.fingerprint });
    expect(stale.status).toBe(409);

    const confirmPreview = await api(checkerToken).post(`/rules/${key}/confirm-preview`);
    await setRule(makerToken, key, "PAY_WITH_RUN"); // and again, after the checker looked
    const staleConfirm = await api(checkerToken).post(`/rules/${key}/confirm`, { version: confirmPreview.body.version, note: "checked it carefully", fingerprint: confirmPreview.body.fingerprint });
    expect(staleConfirm.status).toBe(409);
    expect(staleConfirm.body.error.code).toBe("PREVIEW_STALE");
    expect((await getRule(key)).rule.status).toBe("PLACEHOLDER");
  });

  it("a confirmation needs a real note, and an edit without a preview fingerprint is refused", async () => {
    const key = "NEGATIVE_NET_POLICY";
    await setRule(makerToken, key, "BLOCK");
    const preview = await api(checkerToken).post(`/rules/${key}/confirm-preview`);
    const thin = await api(checkerToken).post(`/rules/${key}/confirm`, { version: preview.body.version, note: "ok", fingerprint: preview.body.fingerprint });
    expect(thin.status).toBe(400);
    const forged = await api(makerToken).put(`/rules/${key}`, { value: "HOLD_PAYMENT", fingerprint: "payroll-hash-v1:not-what-was-shown" });
    expect(forged.status).toBe(409);
    expect((await getRule(key)).rule.current?.value).toBe("BLOCK");
  });

  describe("a statutory figure is confirmed only by typing it again", () => {
    const key = "PF_EMPLOYEE_RATE";

    beforeAll(async () => {
      expect((await setRule(makerToken, key, "12")).status).toBe(200); // nothing is shipped: a director enters the figure first
    });

    it("shows the source label before confirming, and refuses a confirm with no retype", async () => {
      const preview = await api(checkerToken).post(`/rules/${key}/confirm-preview`);
      expect(preview.body).toMatchObject({ requiresRetype: true, value: "12", blocked: null });
      const none = await api(checkerToken).post(`/rules/${key}/confirm`, { version: preview.body.version, note: "checked against the EPFO circular", fingerprint: preview.body.fingerprint });
      expect(none.status).toBe(400);
      expect(none.body.error.code).toBe("RETYPE_REQUIRED");
      expect((await getRule(key)).rule.status).toBe("PLACEHOLDER");
    });

    it("refuses a retype that does not match, and a retype that is not even a value; nothing is confirmed", async () => {
      for (const typedValue of ["13", "12.5", "twelve", "", null]) {
        const r = await confirmRule(checkerToken, key, { typedValue });
        expect(r.status, String(typedValue)).toBe(400);
        expect(["RETYPE_MISMATCH", "RETYPE_REQUIRED"]).toContain(r.body.error.code);
      }
      expect((await getRule(key)).rule.status).toBe("PLACEHOLDER");
      expect(await prisma.payrollItemConfirmation.count({ where: { key } })).toBe(0);
    });

    it("accepts the same value however it is written, and records who and when", async () => {
      const r = await confirmRule(checkerToken, key, { typedValue: "12.00", note: "EPFO circular, checked 16 Oct" });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body).toMatchObject({ status: "CONFIRMED", current: { version: 1, confirmation: { confirmedByUserId: checker.userId, note: "EPFO circular, checked 16 Oct" } } });
    });

    it("a structured statutory table is retyped whole; a different table is refused", async () => {
      const table = { states: { KARNATAKA: { slabs: [{ fromGross: "0", toGross: "15000", monthlyAmount: "0" }, { fromGross: "15000", toGross: null, monthlyAmount: "200" }] } } };
      expect((await setRule(makerToken, "PT_SLABS", table)).status).toBe(200);
      const wrong = { states: { KARNATAKA: { slabs: [{ fromGross: "0", toGross: "15000", monthlyAmount: "0" }, { fromGross: "15000", toGross: null, monthlyAmount: "250" }] } } };
      expect((await confirmRule(checkerToken, "PT_SLABS", { typedValue: wrong })).body.error.code).toBe("RETYPE_MISMATCH");
      expect((await getRule("PT_SLABS")).rule.status).toBe("PLACEHOLDER");
      const ok = await confirmRule(checkerToken, "PT_SLABS", { typedValue: table });
      expect(ok.body.status).toBe("CONFIRMED");
    });
  });

  it("the database refuses what the service would: a confirmation by the author, a mismatched hash, an edit or delete of a version", async () => {
    const key = "VARIANCE_FLAG_PERCENT";
    await setRule(makerToken, key, "10");
    const v = await prisma.payrollItemVersion.findFirstOrThrow({ where: { key, version: 1 } });
    await expect(prisma.payrollItemConfirmation.create({ data: { kind: "RULE", key, version: 1, valueHash: v.valueHash, confirmedByUserId: maker.userId, note: "self" } })).rejects.toThrow(/PAYROLL_CONFIRM_SAME_PERSON/);
    await expect(prisma.payrollItemConfirmation.create({ data: { kind: "RULE", key, version: 1, valueHash: "payroll-hash-v1:other", confirmedByUserId: checker.userId, note: "x" } })).rejects.toThrow(/PAYROLL_CONFIRM_VALUE_MISMATCH/);
    await expect(prisma.payrollItemConfirmation.create({ data: { kind: "RULE", key, version: 9, valueHash: v.valueHash, confirmedByUserId: checker.userId, note: "x" } })).rejects.toThrow(/PAYROLL_CONFIRM_NO_VERSION/);
    await expect(prisma.payrollItemVersion.update({ where: { id: v.id }, data: { value: "99" } })).rejects.toThrow(/PAYROLL_VERSION_APPEND_ONLY/);
    await expect(prisma.payrollItemVersion.delete({ where: { id: v.id } })).rejects.toThrow(/PAYROLL_VERSION_APPEND_ONLY/);
    await expect(prisma.$executeRawUnsafe("TRUNCATE payroll_item_versions")).rejects.toThrow(/PAYROLL_VERSION_APPEND_ONLY/);
  });

  it("audits every edit and confirmation with before and after", async () => {
    const edits = await prisma.auditLog.findMany({ where: { actorUserId: maker.userId, action: "payroll.rule.edited", entityId: "PAY_DAYS_BASIS" }, orderBy: { createdAt: "asc" } });
    expect(edits).toHaveLength(2);
    expect(edits[0]).toMatchObject({ entityType: "PayrollRule", before: null, after: { version: 1, value: "CALENDAR_DAYS", status: "PLACEHOLDER" } });
    expect(edits[1]).toMatchObject({ before: { version: 1, value: "CALENDAR_DAYS", status: "CONFIRMED" }, after: { version: 2, value: "FIXED_DAYS", status: "PLACEHOLDER", resetConfirmation: true } });
    const confirmed = await prisma.auditLog.findFirstOrThrow({ where: { actorUserId: checker.userId, action: "payroll.rule.confirmed", entityId: "PF_EMPLOYEE_RATE" } });
    expect(confirmed).toMatchObject({ before: { status: "PLACEHOLDER", source: expect.any(String) }, after: { status: "CONFIRMED", retyped: true } });
    // And the maker-checker record exists for each confirmation.
    const approvals = await prisma.payrollApproval.findMany({ where: { subject: "RULE_CONFIRM", checkerUserId: checker.userId } });
    expect(approvals.length).toBeGreaterThanOrEqual(3);
    expect(approvals.every((a) => a.status === "CONSUMED" && a.hashAtDecision === a.contentHash && a.makerUserId !== a.checkerUserId)).toBe(true);
  });

  describe("a statutory figure carries its source note and the date it applies from", () => {
    const put = async (token: string, key: string, value: unknown, extra: object) => {
      const preview = await api(token).post(`/rules/${key}/edit-preview`, { value });
      expect(preview.status, JSON.stringify(preview.body)).toBe(200);
      return api(token).put(`/rules/${key}`, { value, fingerprint: preview.body.fingerprint, ...extra });
    };

    it("refuses a statutory figure with no source note, a one-word note, no date, or a bad date; accepts it with all", async () => {
      const key = "PF_ADMIN_RATE";
      const none = await put(makerToken, key, "0.61", {});
      expect([none.status, none.body.error.code]).toEqual([400, "SOURCE_NOTE_REQUIRED"]);
      const short = await put(makerToken, key, "0.61", { sourceNote: "memo", effectiveFrom: "2026-04-01" });
      expect([short.status, short.body.error.code]).toEqual([400, "SOURCE_NOTE_REQUIRED"]);
      const nodate = await put(makerToken, key, "0.61", { sourceNote: "the notification dated 1 April" });
      expect([nodate.status, nodate.body.error.code]).toEqual([400, "EFFECTIVE_FROM_REQUIRED"]);
      const bad = await put(makerToken, key, "0.61", { sourceNote: "the notification dated 1 April", effectiveFrom: "1st April" });
      expect(bad.status).toBe(400);
      const ok = await put(makerToken, key, "0.61", { sourceNote: "the notification dated 1 April, para 3", effectiveFrom: "2026-04-01" });
      expect(ok.status).toBe(200);
      expect([ok.body.current.sourceNote, ok.body.current.effectiveFrom]).toEqual(["the notification dated 1 April, para 3", "2026-04-01"]);
    });

    it("an ordinary company choice does not need them, but keeps them if given", async () => {
      const r = await put(makerToken, "NEGATIVE_NET_POLICY", "HOLD_PAYMENT", {});
      expect(r.status).toBe(200);
      expect([r.body.current.sourceNote, r.body.current.effectiveFrom]).toEqual(["", null]);
    });

    it("the confirming director is shown the source note and the date, confirms against them, and the rule then shows who confirmed it", async () => {
      const key = "PF_ADMIN_RATE";
      const cp = await api(checkerToken).post(`/rules/${key}/confirm-preview`);
      expect([cp.body.sourceNote, cp.body.effectiveFrom]).toEqual(["the notification dated 1 April, para 3", "2026-04-01"]);
      const done = await confirmRule(checkerToken, key, { typedValue: "0.61", note: "checked against the notification" });
      expect(done.status, JSON.stringify(done.body)).toBe(200);
      const view = (await api(checkerToken).get(`/rules/${key}`)).body.rule ?? done.body;
      expect(view.current.sourceNote).toBe("the notification dated 1 April, para 3");
      expect([view.current.confirmation.confirmedByName.length > 0, view.current.confirmation.selfConfirmed]).toEqual([true, false]);
    });
  });
});
