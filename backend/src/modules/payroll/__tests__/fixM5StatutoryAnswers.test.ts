import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setSetting } from "../../../lib/settings";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { RuleContext } from "../rules/context";
import { loadRunRules } from "../run/rules";
import { buildSetupReport, readinessOf } from "../setup/status";
import { statutoryRunProblems } from "../statutoryAnswers";
import { setStatutoryAnswers } from "./payrollTestHelpers";
import { COMPANY_RULES } from "./runTestHelpers";

// FIX-M5 (independent audit 2026-11-20, finding M5): professional tax, LWF and minimum wages each need the directors' explicit answer, "Does not apply to us" or
// "Applies". Not set BLOCKS a real company's first run (a blocking row on Ready for First Run) and every real monthly run; the demo company is exempt;
// "Does not apply to us" deducts nothing, pins nothing as "not set" and skips the minimum wages check. (The run step's blocker over a real calculated run is
// proved in payslipNotSet.test.ts, the "Applies with no table" case.)
type P = { employeeId: string; employeeCode: string; userId: string };
const KEYS = ["statutory.professionalTax", "statutory.labourWelfareFund", "statutory.minimumWages"] as const;
const ROWS = ["statutory:answer:professionalTax", "statutory:answer:labourWelfareFund", "statutory:answer:minimumWages"];

describe("FIX-M5: statutory answers are explicit, and Not set blocks a real run", () => {
  let org: TestOrgMasters;
  let director: P, hr: P, developer: P;
  let tDirector: string, tHr: string, tDev: string;
  let restore: () => Promise<void>;

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    director = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    developer = await createFullTestEmployee(org, { roleCode: "DEVELOPER" });
    [tDirector, tHr, tDev] = [await loginAs(director.employeeCode), await loginAs(hr.employeeCode), await loginAs(developer.employeeCode)];
    restore = await setStatutoryAnswers({ "statutory.professionalTax": null, "statutory.labourWelfareFund": null, "statutory.minimumWages": null });
  });
  afterAll(async () => {
    await setSetting("demo.company", false, director.userId);
    await restore();
    for (const p of [director, hr, developer]) await cleanupFullTestEmployee(p.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("the audit's case: with nothing answered, a real company's Ready for First Run has three BLOCKING rows and the run is refused", async () => {
    await setSetting("demo.company", false, director.userId);
    const report = await buildSetupReport();
    const items = report.sections.flatMap((s) => s.items);
    for (const id of ROWS) expect([items.find((i) => i.id === id)?.required, items.find((i) => i.id === id)?.status], id).toEqual([true, "NOT_SET"]);
    const blockers = readinessOf(report).blockers.map((b) => b.itemId);
    for (const id of ROWS) expect(blockers).toContain(id);
    expect(await statutoryRunProblems()).toHaveLength(3);
  });

  it("the demo company is exempt: the rows are not required and nothing blocks", async () => {
    await setSetting("demo.company", true, director.userId);
    const report = await buildSetupReport();
    expect(readinessOf(report).blockers.some((b) => b.itemId.startsWith("statutory:answer:"))).toBe(false);
    for (const id of ROWS) expect(report.sections.flatMap((s) => s.items).find((i) => i.id === id)?.required).toBe(false);
    await setSetting("demo.company", false, director.userId);
  });

  it("'Applies' with no values entered still blocks; 'Does not apply to us' is green and clears the block", async () => {
    await setStatutoryAnswers({ "statutory.professionalTax": "APPLIES", "statutory.labourWelfareFund": "NOT_APPLICABLE", "statutory.minimumWages": "NOT_APPLICABLE" });
    expect(await statutoryRunProblems()).toEqual([expect.stringMatching(/^Professional Tax: "Applies", but its values are not entered/)]);
    await setStatutoryAnswers({ "statutory.professionalTax": "NOT_APPLICABLE" });
    expect(await statutoryRunProblems()).toEqual([]);
    const items = (await buildSetupReport()).sections.flatMap((s) => s.items);
    for (const id of ROWS) expect(items.find((i) => i.id === id)?.status, id).toBe("CONFIRMED");
  });

  it("'Does not apply to us' deducts nothing and pins nothing as 'not set'; an open answer still pins 'not set'", () => {
    const open = RuleContext.fromValuesForTests({ ...COMPANY_RULES });
    expect(loadRunRules(open, { arrears: false, encashment: false }).notSet).toEqual(["PT", "LWF"]);
    expect(open.pins().filter((p) => p.key === "PT_SLABS" || p.key === "LWF_TABLE")).toHaveLength(2);
    const na = RuleContext.fromValuesForTests({ ...COMPANY_RULES });
    const rules = loadRunRules(na, { arrears: false, encashment: false, statutoryNotApplicable: { pt: true, lwf: true } });
    expect([rules.ptSlabs, rules.lwfTable, rules.notSet]).toEqual([null, null, []]);
    expect(na.pins().filter((p) => p.key === "PT_SLABS" || p.key === "LWF_TABLE")).toEqual([]);
  });

  it("minimum wages 'Does not apply to us': the check is not run (director only; HR and the Developer 403)", async () => {
    await setStatutoryAnswers({ "statutory.minimumWages": "NOT_APPLICABLE" });
    const res = await request(app).get("/api/payroll-minimum-wages/check?runId=none").set(...authHeader(tDirector));
    expect([res.status, res.body.notApplicable]).toEqual([200, true]);
    for (const t of [tHr, tDev]) expect((await request(app).get("/api/payroll-minimum-wages/check?runId=none").set(...authHeader(t))).status).toBe(403);
  });

  it("only a director proposes an answer (one of the two values); HR and the Developer are refused", async () => {
    const propose = (t: string, value: unknown) => request(app).post("/api/behaviours/statutory.professionalTax/proposals").set(...authHeader(t)).send({ value, reason: "test" });
    for (const t of [tHr, tDev]) expect((await propose(t, "APPLIES")).status).toBe(403);
    expect((await propose(tDirector, "MAYBE")).status).toBe(400);
    expect((await propose(tDirector, "APPLIES")).status).toBe(201);
    for (const k of KEYS) expect(k.startsWith("statutory.")).toBe(true);
  });
});
