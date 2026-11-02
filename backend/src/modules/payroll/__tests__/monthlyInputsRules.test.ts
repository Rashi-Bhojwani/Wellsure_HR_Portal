import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { dec } from "../money";
import { fixedColumnOf, normaliseHeader, parseCsv, parseDateText } from "../inputs/importParse";
import { currentCells, inputsHash, missingInputs, monthState, monthsBetween, parseAmountText } from "../inputs/rules";

// Stage 4: the pure rules of Monthly Inputs and the reading of a file. No database.

describe("a figure is exact text, zero or more unless the head allows negative figures", () => {
  it("reads whole and decimal figures exactly and canonically", () => {
    expect(parseAmountText("1500")).toEqual({ ok: true, value: "1500" });
    expect(parseAmountText("0")).toEqual({ ok: true, value: "0" });
    expect(parseAmountText(" 1234.50 ")).toEqual({ ok: true, value: "1234.5" });
    expect(parseAmountText("0.000001")).toEqual({ ok: true, value: "0.000001" });
    expect(parseAmountText("0.1")).toEqual({ ok: true, value: "0.1" });
  });
  it("refuses blank (that is 'nothing entered'), negative, separators, signs, words and a seventh decimal", () => {
    for (const bad of ["", "   ", "-1", "-0", "1,500", "₹500", "1e3", "abc", "1.", ".5", "0.0000001", "1000000000000"]) expect(parseAmountText(bad).ok, bad).toBe(false);
    expect(parseAmountText("999999999999").ok).toBe(true);
  });
  it("a negative figure is read only when the head allows it, exactly, and negative zero is zero", () => {
    expect(parseAmountText("-250.50", true)).toEqual({ ok: true, value: "-250.5" });
    expect(parseAmountText("-0", true)).toEqual({ ok: true, value: "0" });
    expect(parseAmountText("-0.000001", true)).toEqual({ ok: true, value: "-0.000001" });
    for (const bad of ["-", "--1", "-1,5", "- 1", "-1e3", "-1000000000000", "-0.0000001"]) expect(parseAmountText(bad, true).ok, bad).toBe(false);
    for (const text of ["-1", "-250.50", "-0.5"]) {
      const refused = parseAmountText(text);
      expect(refused.ok).toBe(false);
      expect(!refused.ok && refused.message).toMatch(/does not allow negative figures/);
    }
  });
  it("any decimal figure of up to six places round-trips with no loss (property)", () => {
    fc.assert(fc.property(fc.bigInt({ min: 0n, max: 999_999_999_999_999_999n }), (n) => {
      const whole = (n / 1_000_000n).toString();
      const frac = (n % 1_000_000n).toString().padStart(6, "0");
      const text = `${whole}.${frac}`;
      if (whole.length > 12) return true;
      const r = parseAmountText(text);
      return r.ok && dec(r.value).equals(dec(text));
    }), { numRuns: 300 });
  });
});

describe("the state of a month", () => {
  const base = { cycleOver: true, attendanceFinal: true, runUsesIt: false, confirmed: false };
  it("is closed until the month is over and attendance is final", () => {
    expect(monthState({ ...base, cycleOver: false }).state).toBe("CLOSED");
    expect(monthState({ ...base, attendanceFinal: false }).state).toBe("CLOSED");
    expect(monthState({ ...base, attendanceFinal: false }).reason).toMatch(/not finalised/);
  });
  it("is open, then confirmed, then locked once a run uses it (locked beats everything)", () => {
    expect(monthState(base).state).toBe("OPEN");
    expect(monthState({ ...base, confirmed: true }).state).toBe("CONFIRMED");
    expect(monthState({ ...base, confirmed: true, runUsesIt: true }).state).toBe("LOCKED");
    expect(monthState({ ...base, attendanceFinal: false, runUsesIt: true }).state).toBe("LOCKED");
    expect(monthState({ ...base, runUsesIt: true }).reason).toMatch(/unlock/i);
  });
});

describe("the hash a confirmation is bound to", () => {
  const cells = [
    { employeeId: "e2", head: "B", amount: "10" },
    { employeeId: "e1", head: "A", amount: "5.5" },
    { employeeId: "e1", head: "B", amount: "0" },
  ];
  it("does not depend on the order the cells arrive in, nor on how a figure is written", () => {
    const h = inputsHash("2026-08-01", cells);
    expect(inputsHash("2026-08-01", [...cells].reverse())).toBe(h);
    expect(inputsHash("2026-08-01", cells.map((c) => ({ ...c, amount: c.amount === "5.5" ? "5.50" : c.amount })))).toBe(h);
  });
  it("changes with any figure, any cell added or removed, a zero versus a blank, and the month", () => {
    const h = inputsHash("2026-08-01", cells);
    expect(inputsHash("2026-08-01", cells.map((c, i) => (i === 0 ? { ...c, amount: "10.000001" } : c)))).not.toBe(h);
    expect(inputsHash("2026-08-01", cells.slice(1))).not.toBe(h);
    expect(inputsHash("2026-08-01", [...cells, { employeeId: "e3", head: "A", amount: "0" }])).not.toBe(h);
    expect(inputsHash("2026-09-01", cells)).not.toBe(h);
    expect(inputsHash("2026-08-01", cells.map((c) => (c.employeeId === "e1" && c.head === "B" ? { ...c, head: "C" } : c)))).not.toBe(h);
  });
  it("the same figures in any order always hash the same (property)", () => {
    fc.assert(fc.property(fc.array(fc.record({ employeeId: fc.constantFrom("e1", "e2", "e3"), head: fc.constantFrom("A", "B", "C"), amount: fc.integer({ min: 0, max: 100000 }).map(String) }), { maxLength: 9 }), fc.integer(), (cs, seed) => {
      const uniq = [...new Map(cs.map((c) => [`${c.employeeId}|${c.head}`, c])).values()];
      const shuffled = [...uniq].sort((a, b) => ((a.amount.length * 31 + seed) % 7) - ((b.amount.length * 17 + seed) % 7));
      return inputsHash("2026-08-01", uniq) === inputsHash("2026-08-01", shuffled);
    }));
  });
});

describe("the ledger: the newest row is the figure; cleared is blank; zero is entered", () => {
  it("reads the newest row of each cell, oldest first in", () => {
    const rows = [
      { employeeId: "e1", head: "A", amount: "5", cleared: false },
      { employeeId: "e1", head: "A", amount: "7", cleared: false },
      { employeeId: "e1", head: "B", amount: "3", cleared: false },
      { employeeId: "e1", head: "B", amount: null, cleared: true },
      { employeeId: "e2", head: "A", amount: "0", cleared: false },
    ];
    expect(currentCells(rows)).toEqual([
      { employeeId: "e1", head: "A", amount: "7" },
      { employeeId: "e2", head: "A", amount: "0" },
    ]);
  });
  it("names every person × head with nothing entered; a zero counts as entered", () => {
    const cells = [{ employeeId: "e1", head: "A", amount: "0" }];
    expect(missingInputs(["e1", "e2"], ["A", "B"], cells)).toEqual([
      { employeeId: "e1", head: "B" },
      { employeeId: "e2", head: "A" },
      { employeeId: "e2", head: "B" },
    ]);
    expect(missingInputs(["e1"], ["A"], cells)).toEqual([]);
    expect(missingInputs(["e1"], [], [])).toEqual([]);
  });
});

describe("a range of months, inclusive", () => {
  const starts = ["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"];
  it("runs from the month containing From to the month containing Till", () => {
    expect(monthsBetween(starts, "2026-07-15", "2026-08-02")).toEqual(["2026-07-01", "2026-08-01"]);
    expect(monthsBetween(starts, "2026-08-01", "2026-08-31")).toEqual(["2026-08-01"]);
    expect(monthsBetween(starts, "2026-06-30", "2026-09-01")).toEqual(starts);
  });
  it("is empty when Till is before From, or the dates are before the first month", () => {
    expect(monthsBetween(starts, "2026-08-02", "2026-08-01")).toEqual([]);
    expect(monthsBetween(starts, "2020-01-01", "2020-02-01")).toEqual([]);
  });
});

describe("reading a file", () => {
  it("reads quotes, doubled quotes, commas and line breaks inside quotes, CRLF, and drops a byte-order mark", () => {
    expect(parseCsv('﻿A,B\r\n"x,1","he said ""hi"""\r\n"two\nlines",z\n')).toEqual([["A", "B"], ["x,1", 'he said "hi"'], ["two\nlines", "z"]]);
    expect(parseCsv("a,b")).toEqual([["a", "b"]]);
    expect(parseCsv("")).toEqual([]);
  });
  it("reads the sample's headers, with its spelling 'Overide'", () => {
    expect(fixedColumnOf("Overide From")).toBe("Override From");
    expect(fixedColumnOf("OVERRIDE TILL")).toBe("Override Till");
    expect(fixedColumnOf("Employee Number")).toBe("Employee Number");
    expect(fixedColumnOf("Principal Part")).toBe("Principal Part");
    expect(fixedColumnOf("Slab Salary Bonus")).toBeNull(); // a head's name is never assumed
    expect(normaliseHeader("Old Month Discrepency")).toBe("oldmonthdiscrepency");
  });
  it("reads yyyy-mm-dd and dd-Mon-yyyy, and refuses what could be read two ways or does not exist", () => {
    expect(parseDateText("2008-04-01")).toBe("2008-04-01");
    expect(parseDateText("01-Apr-2008")).toBe("2008-04-01");
    expect(parseDateText("1-apr-2008")).toBe("2008-04-01");
    expect(parseDateText("29-Feb-2024")).toBe("2024-02-29");
    for (const bad of ["01/04/2008", "04/01/2008", "2008-02-30", "31-Apr-2008", "1 April", "", "2008-4-1"]) expect(parseDateText(bad), bad).toBeNull();
  });
});
