import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HttpError } from "../../../middleware/errorHandler";
import { dec } from "../money";
import { BreakupError, computeBreakup } from "../salary/breakup";
import { previewComponentSave } from "../salary/components";
import { isActiveOn, notSetChoices, parseComponentValue, unusableInStructure, type ComponentValue } from "../salary/schemas";
import { previewStructureSave } from "../salary/structures";
import { buildSalaryWorld, componentPin, makeComponent, teardownSalaryWorld, type SalaryWorld } from "./salaryTestHelpers";

// Stage 3.1a: the options of a pay head. Every new option is optional ("absent" is Not set), a head with a choice Not set cannot be used, and the links to an
// arrears head and a reversal head can never point at nothing, at the head itself, at a head that is not there when this one is, or round in a ring.

const base = { name: "Basic", type: "EARNING", taxable: true, pfApplicable: false, esiApplicable: false, prorates: true, payslipLabel: "Basic", payslipOrder: 1 };

describe("the value of a pay head (pure)", () => {
  it("still reads a stored version from before the new options, and adds nothing to it", () => {
    const v = parseComponentValue(base);
    expect(Object.keys(v).sort()).toEqual(Object.keys(base).sort());
  });

  it("accepts every new option and keeps none of them when absent", () => {
    const v = parseComponentValue({ ...base, headKind: "REIMBURSEMENT", oneTime: true, carryForward: false, reimbursement: true, ctcGroup: "Fixed", ytd: true, bankTransfer: true, payslipVisible: false, activeFrom: "2027-04-01", activeTo: "2028-03-31", arrearsHead: "ARR_X", reversalHead: "REV_X" });
    expect(v.headKind).toBe("REIMBURSEMENT");
    expect(v.arrearsHead).toBe("ARR_X");
    expect(() => parseComponentValue({ ...base, headKind: "BONUS" })).toThrow();
    expect(() => parseComponentValue({ ...base, activeFrom: "1 April" })).toThrow();
  });

  it("refuses an end date before the start date, and a reimbursement flag on a deduction", () => {
    expect(() => parseComponentValue({ ...base, activeFrom: "2027-04-01", activeTo: "2027-03-31" })).toThrow(/cannot be before/);
    expect(() => parseComponentValue({ ...base, headKind: "DEDUCTION", reimbursement: true })).toThrow(/reimbursement/);
  });

  it("taxable can be Not set (null), and a head with it Not set reports what is missing", () => {
    const v = parseComponentValue({ ...base, taxable: null });
    expect(v.taxable).toBeNull();
    expect(notSetChoices(v)).toEqual(["whether it is taxable"]);
    expect(notSetChoices(parseComponentValue(base))).toEqual([]);
    expect(() => parseComponentValue({ ...base, taxable: undefined })).toThrow();
  });

  it("is active on a day inside its dates and open on a side with no date", () => {
    expect(isActiveOn({}, "2027-01-01")).toBe(true);
    expect(isActiveOn({ activeFrom: "2027-04-01" }, "2027-03-31")).toBe(false);
    expect(isActiveOn({ activeFrom: "2027-04-01" }, "2027-04-01")).toBe(true);
    expect(isActiveOn({ activeTo: "2027-03-31" }, "2027-03-31")).toBe(true);
    expect(isActiveOn({ activeTo: "2027-03-31" }, "2027-04-01")).toBe(false);
  });

  it("a counter, a statutory head, a head with a choice Not set and an inactive head cannot be a line of a structure", () => {
    const v = (over: object): ComponentValue => parseComponentValue({ ...base, ...over });
    expect(unusableInStructure("DAYS", v({ headKind: "COUNTER" }), "2027-01-01")).toMatch(/counter/);
    expect(unusableInStructure("PFX", v({ headKind: "STATUTORY" }), "2027-01-01")).toMatch(/statutory/);
    expect(unusableInStructure("TAXQ", v({ taxable: null }), "2027-01-01")).toMatch(/taxable/);
    expect(unusableInStructure("OLD", v({ activeTo: "2026-12-31" }), "2027-01-01")).toMatch(/not active/);
    expect(unusableInStructure("OK", v({ headKind: "EARNING" }), "2027-01-01")).toBeNull();
  });

  it("no salary can be worked out with a head whose choice is Not set", () => {
    const comp = (taxable: boolean | null) => new Map([["BASIC", { version: 1, value: parseComponentValue({ ...base, taxable }) }]]);
    const structure = { name: "S", description: "", ctcIncludes: ["EARNING" as const], lines: [{ component: "BASIC", componentVersion: 1, componentHash: "hash-for-BASIC", calc: { method: "BALANCE" as const } }] };
    expect(computeBreakup({ annualCtc: dec("120000"), structure, components: comp(true), rounding: { mode: "HALF_UP", scale: 0 } }).lines).toHaveLength(1);
    expect(() => computeBreakup({ annualCtc: dec("120000"), structure, components: comp(null), rounding: { mode: "HALF_UP", scale: 0 } })).toThrow(BreakupError);
  });
});

describe("links between heads, and structures (database)", () => {
  let w: SalaryWorld;
  const code = (s: string) => `${w.prefix}_${s}`;
  const rejects = async (p: Promise<unknown>, text: RegExp) => {
    const err = (await p.then(() => null, (e: unknown) => e)) as HttpError | null;
    expect(err, "expected a refusal").toBeInstanceOf(HttpError);
    expect(JSON.stringify([err!.message, err!.details])).toMatch(text);
  };

  beforeAll(async () => {
    w = await buildSalaryWorld();
    await makeComponent(w, code("ARR"), { payslipOrder: 20 });
    await makeComponent(w, code("REV"), { payslipOrder: 21 });
    await makeComponent(w, code("GONE"), { payslipOrder: 22, activeTo: "2020-01-01" });
  }, 120_000);
  afterAll(async () => {
    await teardownSalaryWorld(w);
  }, 120_000);

  const value = (over: object) => ({ ...base, name: "Head", payslipLabel: "Head", ...over });

  it("accepts links to heads that exist", async () => {
    const p = await previewComponentSave(code("MAIN"), value({ arrearsHead: code("ARR"), reversalHead: code("REV") }));
    expect(p.after.value.arrearsHead).toBe(code("ARR"));
  });

  it("refuses a link to a head that does not exist, and to the head itself", async () => {
    await rejects(previewComponentSave(code("MAIN"), value({ arrearsHead: code("NOPE") })), /does not exist/);
    await rejects(previewComponentSave(code("MAIN"), value({ reversalHead: code("MAIN") })), /cannot be the head itself/);
  });

  it("refuses a link to a head that is not active when this head starts", async () => {
    await rejects(previewComponentSave(code("MAIN"), value({ arrearsHead: code("GONE"), activeFrom: "2027-04-01" })), /not active on 2027-04-01/);
  });

  it("refuses a ring of links", async () => {
    await makeComponent(w, code("A1"), { payslipOrder: 30, arrearsHead: code("ARR") });
    await rejects(previewComponentSave(code("ARR"), value({ arrearsHead: code("A1") })), /ring/);
  });

  it("a structure refuses a head with a choice Not set, a counter, and an inactive head", async () => {
    await makeComponent(w, code("UNSET"), { taxable: null, payslipOrder: 40 });
    await makeComponent(w, code("CNT"), { headKind: "COUNTER", payslipOrder: 41 });
    const lines = async (extra: string) => [
      { ...(await componentPin(w.basic)), calc: { method: "PERCENT", of: "CTC", percent: "40" } },
      { ...(await componentPin(extra)), calc: { method: "FIXED_AMOUNT", amount: "100" } },
      { ...(await componentPin(w.special)), calc: { method: "BALANCE" } },
    ];
    const structure = async (extra: string) => ({ name: "Test structure", ctcIncludes: ["EARNING"], lines: await lines(extra) });
    await rejects(previewStructureSave(code("S1"), await structure(code("UNSET")), "1200000"), /taxable/);
    await rejects(previewStructureSave(code("S2"), await structure(code("CNT")), "1200000"), /counter/);
    await rejects(previewStructureSave(code("S3"), await structure(code("GONE")), "1200000"), /not active/);
    const ok = await previewStructureSave(code("S4"), await structure(code("ARR")), "1200000");
    expect(ok.unconfirmedComponents).toEqual([]);
  });
});
