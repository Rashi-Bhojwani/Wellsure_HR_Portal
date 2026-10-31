import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app, authHeader } from "../../employee/__tests__/employeeTestHelpers";
import { dec } from "../money";
import { BreakupError, computeBreakup } from "../salary/breakup";
import { InvalidSalaryValueError, calculationOrder, parseComponentValue, parseStructureValue, unusableInStructure, type ComponentValue, type StructureValue } from "../salary/schemas";
import { buildSalaryWorld, componentPin, makeComponent, teardownSalaryWorld, type SalaryWorld } from "./salaryTestHelpers";

// Stage 3.1b: a table lookup as a way to work out a line, the order lines are worked out in, a head that comes from Monthly Inputs, and heads that are retired, never deleted.

const comp = (over: Partial<ComponentValue> = {}): ComponentValue => parseComponentValue({ name: "Head", type: "EARNING", taxable: true, pfApplicable: false, esiApplicable: false, prorates: true, payslipLabel: "x", payslipOrder: 1, ...over });
const pin = (code: string) => ({ component: code, componentVersion: 1, componentHash: `hash-for-${code}` });
const components = (...codes: string[]) => new Map(codes.map((c) => [c, { version: 1, value: comp() }]));
const whole = { mode: "HALF_UP" as const, scale: 0 };
const slab = (of: string, slabs: Array<{ from: string; to: string | null; amount: string }>) => ({ method: "SLAB" as const, of, slabs });
const structure = (lines: StructureValue["lines"]): StructureValue => ({ name: "Test structure", description: "", ctcIncludes: ["EARNING"], lines });
const table = [
  { from: "0", to: "10000", amount: "100" },
  { from: "10000", to: "50000", amount: "250" },
  { from: "50000", to: null, amount: "400" },
];

describe("a line looked up in a table (pure)", () => {
  const s = structure([
    { ...pin("BASIC"), calc: { method: "PERCENT", of: "CTC", percent: "40" } },
    { ...pin("LEVY"), calc: slab("BASIC", table) },
    { ...pin("REST"), calc: { method: "BALANCE" } },
  ]);
  const at = (annual: string) => Object.fromEntries(computeBreakup({ annualCtc: dec(annual), structure: s, components: components("BASIC", "LEVY", "REST"), rounding: whole }).lines.map((l) => [l.component, l.amount.toString()]));

  it("picks the row whose from <= value < up to, and the open last row", () => {
    expect(at("120000").LEVY).toBe("100"); // basic 4,000
    expect(at("360000").LEVY).toBe("250"); // basic 12,000
    expect(at("1500000").LEVY).toBe("400"); // basic 50,000 exactly is the third row
  });

  it("takes the boundary into the next row, not the one before", () => {
    // basic 10,000 exactly: 10000 is not < 10000, so row two applies
    expect(at("300000").BASIC).toBe("10000");
    expect(at("300000").LEVY).toBe("250");
  });

  it("refuses a value in no row, with words", () => {
    const gap = structure([{ ...pin("BASIC"), calc: { method: "PERCENT", of: "CTC", percent: "40" } }, { ...pin("LEVY"), calc: slab("BASIC", [{ from: "5000", to: null, amount: "1" }]) }, { ...pin("REST"), calc: { method: "BALANCE" } }]);
    expect(() => computeBreakup({ annualCtc: dec("120000"), structure: gap, components: components("BASIC", "LEVY", "REST"), rounding: whole })).toThrow(BreakupError);
  });

  it("is checked when the structure is parsed: base above, rows in order, no overlap, only the last open", () => {
    const parse = (lines: StructureValue["lines"]) => parseStructureValue(structure(lines), () => "EARNING");
    const base = { ...pin("BASIC"), calc: { method: "PERCENT" as const, of: "CTC", percent: "40" } };
    expect(() => parse([base, { ...pin("LEVY"), calc: slab("LATER", table) }, { ...pin("LATER"), calc: { method: "BALANCE" } }])).toThrow(/neither/);
    expect(() => parse([base, { ...pin("LEVY"), calc: slab("BASIC", [{ from: "0", to: "10", amount: "1" }, { from: "5", to: null, amount: "2" }]) }])).toThrow(/overlap/);
    expect(() => parse([base, { ...pin("LEVY"), calc: slab("BASIC", [{ from: "0", to: null, amount: "1" }, { from: "5", to: "9", amount: "2" }]) }])).toThrow(/only the last/);
    expect(() => parse([base, { ...pin("LEVY"), calc: slab("BASIC", [{ from: "5", to: "5", amount: "1" }]) }])).toThrow(/more than/);
    expect(() => parse([base, { ...pin("LEVY"), calc: slab("BASIC", table) }])).not.toThrow();
    expect(() => parse([{ ...pin("LEVY"), calc: slab("BASIC", table) }, base])).toThrow(InvalidSalaryValueError);
  });
});

describe("the order lines are worked out in (pure)", () => {
  it("shows what each line reads, in an order that never puts a line before what it reads", () => {
    const s = structure([
      { ...pin("BASIC"), calc: { method: "PERCENT", of: "CTC", percent: "40" } },
      { ...pin("HRA"), calc: { method: "PERCENT", of: "BASIC", percent: "50" } },
      { ...pin("CAP"), calc: { method: "FORMULA", formula: "MIN(BASIC, HRA)" } },
      { ...pin("REST"), calc: { method: "BALANCE" } },
    ]);
    const order = calculationOrder(s);
    expect(order.map((o) => o.component)).toEqual(["BASIC", "HRA", "CAP", "REST"]);
    expect(order.map((o) => o.step)).toEqual([1, 2, 3, 4]);
    expect(order[1]!.dependsOn).toEqual(["BASIC"]);
    expect(order[2]!.dependsOn).toEqual(["BASIC", "HRA"]);
    expect(order[3]!.dependsOn).toEqual(["BASIC", "CAP", "HRA"]); // the balance reads every other line
    const seen = new Set<string>();
    for (const o of order) {
      for (const d of o.dependsOn) if (d !== "CTC") expect(seen.has(d) || o.component === "REST").toBe(true);
      seen.add(o.component);
    }
  });
});

describe("a head that takes its value from Monthly Inputs (pure)", () => {
  it("is not worked out from CTC, so it cannot be a line of a structure", () => {
    expect(unusableInStructure("BONUS_IN", comp({ inputItem: true }), "2027-01-01")).toMatch(/Monthly Inputs/);
    expect(unusableInStructure("BONUS_IN", comp({ inputItem: false }), "2027-01-01")).toBeNull();
  });
});

describe("heads are retired, never deleted (database)", () => {
  let w: SalaryWorld;
  beforeAll(async () => {
    w = await buildSalaryWorld();
    await makeComponent(w, `${w.prefix}_UNUSED`, { payslipOrder: 50 });
  }, 120_000);
  afterAll(async () => {
    await teardownSalaryWorld(w);
  }, 120_000);

  it("refuses to delete a head, used or not, and says how to retire it", async () => {
    for (const code of [w.basic, `${w.prefix}_UNUSED`]) {
      const res = await request(app).delete(`/api/payroll/components/${code}`).set(...authHeader(w.tokens.maker));
      expect(res.status).toBe(409);
      expect(res.body.code ?? res.body.error?.code).toBe("HEAD_DELETE_REFUSED");
      expect(JSON.stringify(res.body)).toMatch(/last active day/);
    }
    expect((await componentPin(w.basic)).component).toBe(w.basic); // still there
  });

  it("says a head that a finalised run used cannot be deleted, by name of the run", async () => {
    const { prisma } = await import("../../../lib/prisma");
    const res = await request(app).delete(`/api/payroll/components/NO_SUCH_HEAD`).set(...authHeader(w.tokens.maker));
    expect(res.status).toBe(404);
    expect(await prisma.payrollItemVersion.count({ where: { kind: "COMPONENT", key: w.basic } })).toBe(1);
  });

  it("is not open to somebody without salary-edit permission", async () => {
    const res = await request(app).delete(`/api/payroll/components/${w.basic}`).set(...authHeader(w.tokens.outsider));
    expect(res.status).toBe(403);
  });
});
