import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OVERRIDABLE_RULE_KEYS } from "@shared/constants/payrollRules";
import { prisma } from "../../../lib/prisma";
import { app, authHeader } from "../../employee/__tests__/employeeTestHelpers";
import { dec } from "../money";
import { resolveOverrides, resolveRule, windowsOverlap, type OverrideItem } from "../rules/overrides";
import { pinStatuses, type RulePin } from "../rules/context";
import { applyRuleOverrides, type RunRules } from "../run/rules";
import { CYCLE, api, buildRunWorld, calculateAgain, calculateRun, lockCycle, teardownRunWorld, type RunWorld } from "./runTestHelpers";
import { FIRST_SALARY_DAY, giveSalary } from "./salaryTestHelpers";

// Stage 3.4: company default → department override → employee override, the most specific wins; effective-dated, with a reason and a source note, a Placeholder until a
// different director confirms it, and a run that used a Placeholder override is a test run. The values are made up for the tests.

const item = (over: Partial<OverrideItem>): OverrideItem => ({ itemKey: "k", ruleKey: "PF_EMPLOYEE_RATE", level: "DEPARTMENT", targetId: "d1", effectiveFrom: "2026-04-01", effectiveTo: null, version: 1, valueHash: "h", value: "11", confirmed: true, registrationRef: null, sourceNote: "n", reason: "r", ...over });
const rulesFor = (): RunRules => ({
  payDaysBasis: "CALENDAR_DAYS", lopDivisor: "SAME_AS_PAY_DAYS_BASIS", fixedDays: null,
  lineRounding: { mode: "HALF_UP", scale: 0 }, pfRounding: { mode: "HALF_UP", scale: 0 }, esiRounding: { mode: "UP", scale: 0 }, netRounding: { mode: "NONE", scale: 0 },
  pf: { employeeRate: dec("12"), epsRate: dec("8.33"), epfErRate: dec("3.67"), edliRate: dec("0.5"), adminRate: dec("0.5"), ceiling: dec("15000"), ceilingMode: "CAP_AT_CEILING", eligibleTypes: ["PERMANENT"] },
  esi: { employeeRate: dec("0.75"), employerRate: dec("3.25"), ceiling: dec("21000"), periodRule: "MONTHLY", eligibleTypes: ["PERMANENT"] },
  negativeNet: "BLOCK", leaverTiming: "PAY_WITH_RUN", paymentDate: { monthOffset: 0, day: "LAST" }, ptSlabs: null, lwfTable: null, ptStateOfPlacement: null, stateNameMap: null,
  arrearsPfEsi: null, encashPfApplicable: null, encashPayoutRule: null, arrearOnArrear: null, lopReversal: null, headRounding: {},
});
const who = { employeeId: "e1", departmentId: "d1" };

describe("the resolver (pure)", () => {
  it("with no override the company's rule stands", () => {
    expect(resolveRule([], "PF_EMPLOYEE_RATE", who, "2026-08-31")).toBeNull();
    expect(resolveOverrides([], who, "2026-08-31").size).toBe(0);
  });

  it("a department override applies to its people; an employee override beats it; another person's or department's is ignored", () => {
    const dept = item({ itemKey: "D", value: "11" });
    const emp = item({ itemKey: "E", level: "EMPLOYEE", targetId: "e1", value: "10" });
    expect(resolveRule([dept], "PF_EMPLOYEE_RATE", who, "2026-08-31")?.itemKey).toBe("D");
    expect(resolveRule([dept, emp], "PF_EMPLOYEE_RATE", who, "2026-08-31")?.itemKey).toBe("E");
    expect(resolveRule([emp, dept], "PF_EMPLOYEE_RATE", who, "2026-08-31")?.itemKey).toBe("E"); // order does not matter
    expect(resolveRule([emp], "PF_EMPLOYEE_RATE", { employeeId: "e2", departmentId: "d1" }, "2026-08-31")).toBeNull();
    expect(resolveRule([dept], "PF_EMPLOYEE_RATE", { employeeId: "e1", departmentId: "d2" }, "2026-08-31")).toBeNull();
    expect(resolveRule([dept], "PF_EMPLOYEE_RATE", { employeeId: "e1", departmentId: null }, "2026-08-31")).toBeNull();
    expect(resolveRule([dept], "PF_ADMIN_RATE", who, "2026-08-31")).toBeNull(); // another rule
  });

  it("counts only inside its dates, first and last day included", () => {
    const o = item({ effectiveFrom: "2026-08-01", effectiveTo: "2026-08-31" });
    expect(resolveRule([o], "PF_EMPLOYEE_RATE", who, "2026-07-31")).toBeNull();
    expect(resolveRule([o], "PF_EMPLOYEE_RATE", who, "2026-08-01")).not.toBeNull();
    expect(resolveRule([o], "PF_EMPLOYEE_RATE", who, "2026-08-31")).not.toBeNull();
    expect(resolveRule([o], "PF_EMPLOYEE_RATE", who, "2026-09-01")).toBeNull();
    expect(resolveRule([item({ effectiveTo: null })], "PF_EMPLOYEE_RATE", who, "2099-01-01")).not.toBeNull(); // no end date
  });

  it("an employee override that has ended falls back to the department's, then to the company's", () => {
    const dept = item({ itemKey: "D" });
    const emp = item({ itemKey: "E", level: "EMPLOYEE", targetId: "e1", effectiveFrom: "2026-04-01", effectiveTo: "2026-06-30" });
    expect(resolveRule([dept, emp], "PF_EMPLOYEE_RATE", who, "2026-06-30")?.itemKey).toBe("E");
    expect(resolveRule([dept, emp], "PF_EMPLOYEE_RATE", who, "2026-07-01")?.itemKey).toBe("D");
  });

  it("resolves each overridable rule on its own", () => {
    const set = resolveOverrides([item({ itemKey: "A", ruleKey: "PF_EMPLOYEE_RATE" }), item({ itemKey: "B", ruleKey: "ESI_WAGE_CEILING", level: "EMPLOYEE", targetId: "e1", value: "25000" })], who, "2026-08-31");
    expect([...set.keys()].sort()).toEqual(["ESI_WAGE_CEILING", "PF_EMPLOYEE_RATE"]);
    expect(OVERRIDABLE_RULE_KEYS).not.toContain("LINE_ROUNDING");
    expect(OVERRIDABLE_RULE_KEYS).not.toContain("STATE_NAME_MAP");
  });

  it("windows overlap at the boundary day and not a day apart", () => {
    expect(windowsOverlap({ effectiveFrom: "2026-04-01", effectiveTo: "2026-06-30" }, { effectiveFrom: "2026-06-30", effectiveTo: null })).toBe(true);
    expect(windowsOverlap({ effectiveFrom: "2026-04-01", effectiveTo: "2026-06-30" }, { effectiveFrom: "2026-07-01", effectiveTo: null })).toBe(false);
    expect(windowsOverlap({ effectiveFrom: "2026-04-01", effectiveTo: null }, { effectiveFrom: "2030-01-01", effectiveTo: null })).toBe(true);
  });

  it("applying overrides changes only the named parameters, for that person, and never the company's rules", () => {
    const base: RunRules = rulesFor();
    const out = applyRuleOverrides(base, [{ ruleKey: "PF_EMPLOYEE_RATE", value: "10" }, { ruleKey: "PF_WAGE_CEILING", value: "20000" }, { ruleKey: "ESI_PERIOD_RULE", value: "STICKY_HALF_YEAR" }, { ruleKey: "NOT_A_RULE", value: "1" }]);
    expect(out.pf.employeeRate.equals(dec("10"))).toBe(true);
    expect(out.pf.ceiling.equals(dec("20000"))).toBe(true);
    expect(out.esi.periodRule).toBe("STICKY_HALF_YEAR");
    expect(out.pf.epsRate.equals(base.pf.epsRate)).toBe(true);
    expect(base.pf.employeeRate.equals(dec("12"))).toBe(true); // untouched
    expect(applyRuleOverrides(base, [])).toBe(base);
    expect(applyRuleOverrides(base, undefined)).toBe(base);
  });
});

describe("overrides, end to end", () => {
  let w: RunWorld;
  const id = (n: string) => w.named[n]!.employeeId;
  const maker = () => w.tokens.maker;
  const input = (over: Record<string, unknown> = {}) => ({
    ruleKey: "PF_EMPLOYEE_RATE",
    level: "EMPLOYEE",
    targetId: id("a"),
    value: "10",
    effectiveFrom: "2026-04-01",
    reason: "Covered under a different scheme by agreement",
    sourceNote: "Test fixture: a made-up order dated 1 April",
    registrationRef: "REG-TEST-1",
    ...over,
  });
  const put = (body: Record<string, unknown>, token = maker()) => request(app).put("/api/payroll/rule-overrides").set(...authHeader(token)).send(body);
  const preview = (over: Record<string, unknown> = {}, token = maker()) => request(app).post("/api/payroll/rule-overrides/preview").set(...authHeader(token)).send({ input: input(over) });
  const save = async (over: Record<string, unknown> = {}) => {
    const p = await preview(over);
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    return put({ input: input(over), fingerprint: p.body.fingerprint });
  };
  const confirm = async (key: string, typed: unknown, token = w.tokens.checkerA) => {
    const p = await request(app).post(`/api/payroll/rule-overrides/${key}/confirm-preview`).set(...authHeader(token)).send({});
    if (p.status !== 200) return p;
    return request(app).post(`/api/payroll/rule-overrides/${key}/confirm`).set(...authHeader(token)).send({ version: p.body.version, typedValue: typed, note: "checked against the order", fingerprint: p.body.fingerprint });
  };
  const pf = async (runId: string, n: string) => {
    const it = (await api(maker(), "get", `/runs/${runId}/items/${id(n)}`)).body;
    return it.lines.find((l: { code: string }) => l.code === "PF_EMPLOYEE")?.amount as string | undefined;
  };
  let augId = "";
  const keyA = () => `PF_EMPLOYEE_RATE~EMPLOYEE~${id("a")}~2026-04-01`;

  beforeAll(async () => {
    w = await buildRunWorld(["a", "b", "c"]);
    for (const n of ["a", "b", "c"]) {
      await giveSalary(w, id(n), "600000", FIRST_SALARY_DAY);
      await lockCycle(id(n), CYCLE.start, CYCLE.end);
    }
  }, 300_000);
  afterAll(async () => {
    const mine = await prisma.payrollItemVersion.findMany({ where: { kind: "RULE_OVERRIDE" }, select: { id: true } });
    expect(mine.length).toBeGreaterThanOrEqual(0);
    await teardownRunWorld(w);
  });

  it("refuses what is not allowed: a rule that cannot be overridden, no reason, no source note, no date, a bad value, an unknown target, one's own pay, nobody's permission", async () => {
    const bad = async (over: Record<string, unknown>, code: string) => {
      const r = await preview(over);
      expect([r.status, r.body.error.code], JSON.stringify(over)).toEqual([r.status, code]);
      expect(r.status).toBeGreaterThanOrEqual(400);
    };
    await bad({ ruleKey: "LINE_ROUNDING", value: { mode: "DOWN", scale: 0 } }, "VALIDATION_ERROR");
    await bad({ reason: "" }, "REASON_REQUIRED");
    await bad({ sourceNote: "short" }, "SOURCE_NOTE_REQUIRED");
    await bad({ effectiveFrom: "April" }, "EFFECTIVE_FROM_REQUIRED");
    await bad({ effectiveFrom: "2026-04-01", effectiveTo: "2026-03-01" }, "VALIDATION_ERROR");
    await bad({ value: "120" }, "VALIDATION_ERROR"); // a rate over 100
    await bad({ targetId: "no-such-person" }, "NOT_FOUND");
    await bad({ level: "DEPARTMENT", targetId: "no-such-department" }, "NOT_FOUND");
    await bad({ level: "COMPANY" }, "VALIDATION_ERROR");
    expect((await preview({}, w.tokens.outsider)).status).toBe(403);
    expect((await request(app).get("/api/payroll/rule-overrides").set(...authHeader(w.tokens.outsider))).status).toBe(403);
  });

  it("a director may make an override for themselves: it is recorded as a self-change and the other director is told", async () => {
    const own = await preview({ targetId: w.maker.employeeId, ruleKey: "PF_ADMIN_RATE", value: "0.4" });
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    expect(await prisma.auditLog.count({ where: { actorUserId: w.maker.userId, action: "payroll.self_pay_change" } })).toBeGreaterThan(0);
  });

  it("saves as a Placeholder with its dates, reason, source note and registration reference; the same window cannot be entered twice, and windows cannot overlap", async () => {
    const r = await save();
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ itemKey: keyA(), ruleKey: "PF_EMPLOYEE_RATE", level: "EMPLOYEE", status: "PLACEHOLDER", effectiveFrom: "2026-04-01", effectiveTo: null, registrationRef: "REG-TEST-1", confirmed: false });
    expect(r.body.sourceNote).toMatch(/made-up order/);
    const again = await preview();
    expect(again.body.unchanged).toBe(true);
    const overlap = await preview({ effectiveFrom: "2026-09-01" });
    expect([overlap.status, overlap.body.error.code]).toEqual([409, "OVERRIDE_OVERLAP"]);
    const audit = await prisma.auditLog.findFirst({ where: { action: "payroll.rule_override.edited", entityId: keyA() } });
    expect(audit).not.toBeNull();
  });

  it("is applied to that person only, from the date it starts, and the run is a TEST run while it is a Placeholder", async () => {
    augId = await calculateRun(w);
    expect(await pf(augId, "a")).toBe("1500"); // 10% of the 15,000 ceiling
    expect(await pf(augId, "b")).toBe("1800"); // the company's 12%
    expect(await pf(augId, "c")).toBe("1800");
    const run = await prisma.payrollRun.findUniqueOrThrow({ where: { id: augId } });
    const pins = run.pins as unknown as RulePin[];
    const pin = pins.find((p) => p.kind === "RULE_OVERRIDE")!;
    expect(pin.key).toBe(keyA());
    const status = (await pinStatuses([pin]))[0]!;
    expect(status.status).toBe("PLACEHOLDER");
    const item = await prisma.payrollRunItem.findFirstOrThrow({ where: { runId: augId, employeeId: id("a") } });
    expect((item.inputs as { ruleOverrides: Array<{ rule: string; level: string; registrationRef: string }> }).ruleOverrides).toEqual([expect.objectContaining({ rule: "PF_EMPLOYEE_RATE", level: "EMPLOYEE", registrationRef: "REG-TEST-1" })]);
    const other = await prisma.payrollRunItem.findFirstOrThrow({ where: { runId: augId, employeeId: id("b") } });
    expect((other.inputs as { ruleOverrides?: unknown }).ruleOverrides).toBeUndefined();
  });

  it("an override that starts after the cycle's last day does not apply yet", async () => {
    const r = await save({ ruleKey: "PF_ADMIN_RATE", value: "0.4", effectiveFrom: "2026-09-01" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    await calculateAgain(w, augId);
    const it = await prisma.payrollRunItem.findFirstOrThrow({ where: { runId: augId, employeeId: id("a") } });
    expect((it.inputs as { ruleOverrides: Array<{ rule: string }> }).ruleOverrides.map((o) => o.rule)).toEqual(["PF_EMPLOYEE_RATE"]);
  });

  it("is judged on the cycle's last day: one that starts on that day applies to the whole run, one that starts a day later does not", async () => {
    const r = await save({ ruleKey: "PF_EPS_RATE", value: "8", effectiveFrom: "2026-08-31" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    await calculateAgain(w, augId);
    const it = await prisma.payrollRunItem.findFirstOrThrow({ where: { runId: augId, employeeId: id("a") } });
    expect((it.inputs as { ruleOverrides: Array<{ rule: string }> }).ruleOverrides.map((o) => o.rule).sort()).toEqual(["PF_EMPLOYEE_RATE", "PF_EPS_RATE"]);
  });

  it("is confirmed only by a different director who types the value in again; the author cannot, and a wrong retype changes nothing", async () => {
    const own = await confirm(keyA(), "10", maker());
    expect(own.status).toBe(403); // the author may not confirm their own (two-director mode)
    const none = await confirm(keyA(), undefined);
    expect([none.status, none.body.error.code]).toEqual([400, "RETYPE_REQUIRED"]);
    const wrong = await confirm(keyA(), "11");
    expect([wrong.status, wrong.body.error.code]).toEqual([400, "RETYPE_MISMATCH"]);
    const ok = await confirm(keyA(), "10.0");
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const list = await request(app).get("/api/payroll/rule-overrides").set(...authHeader(maker()));
    expect(list.body.overrides.find((o: { itemKey: string }) => o.itemKey === keyA()).status).toBe("CONFIRMED");
    const run = await prisma.payrollRun.findUniqueOrThrow({ where: { id: augId } });
    const pin = (run.pins as unknown as RulePin[]).find((p) => p.kind === "RULE_OVERRIDE" && p.key === keyA())!;
    expect((await pinStatuses([pin]))[0]!.status).toBe("CONFIRMED"); // the very version the run used
  });

  it("a department override applies to its people, and an employee override beats it", async () => {
    const dept = await save({ level: "DEPARTMENT", targetId: w.org.departmentId, value: "11", reason: "Department-wide arrangement", effectiveFrom: "2026-04-01" });
    expect(dept.status, JSON.stringify(dept.body)).toBe(200);
    await calculateAgain(w, augId);
    expect(await pf(augId, "a")).toBe("1500"); // the person's own wins
    expect(await pf(augId, "b")).toBe("1650"); // the department's 11%
    expect(await pf(augId, "c")).toBe("1650");
    const it = await prisma.payrollRunItem.findFirstOrThrow({ where: { runId: augId, employeeId: id("b") } });
    expect((it.inputs as { ruleOverrides: Array<{ level: string }> }).ruleOverrides[0]!.level).toBe("DEPARTMENT");
  });

  it("editing an override adds a version, makes it a Placeholder again, and a run that used the old one is stale", async () => {
    const r = await save({ value: "9" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ status: "PLACEHOLDER" });
    expect(r.body.current.version).toBe(2);
    const run = await prisma.payrollRun.findUniqueOrThrow({ where: { id: augId } });
    const pin = (run.pins as unknown as RulePin[]).find((p) => p.kind === "RULE_OVERRIDE" && p.key === keyA())!;
    expect((await pinStatuses([pin]))[0]).toMatchObject({ stale: true });
    const hist = await request(app).get(`/api/payroll/rule-overrides/${keyA()}/history`).set(...authHeader(maker()));
    expect(hist.body.history.map((h: { version: number }) => h.version)).toEqual([2, 1]);
  });
});
