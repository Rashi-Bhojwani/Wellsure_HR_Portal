import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { HASH_VERSION, NonCanonicalValueError, canonicalJson, payrollHash } from "../hash";
import { Dec, canonicalDecimal, dec, fixed, intDec, percentOf, roundTo, sum, type RoundingMode } from "../money";

describe("exact money", () => {
  it("does what floats cannot", () => {
    expect(dec("0.1").plus(dec("0.2")).toFixed()).toBe("0.3");
    expect(0.1 + 0.2).not.toBe(0.3); // the problem this module exists to avoid
    expect(sum([dec("0.10"), dec("0.20"), dec("0.30")]).toFixed()).toBe("0.6");
    // Division is the one inexact operation (a third has no finite decimal form). It is accurate to 40 digits and rounding happens only where a rule names it.
    const third = dec("100").dividedBy(dec("3")).times(dec("3"));
    expect(third.toFixed()).not.toBe("100");
    expect(roundTo(third, 2, "HALF_UP").toFixed()).toBe("100");
  });

  it("only accepts strings and whole numbers: a float cannot get in", () => {
    expect(() => dec("12.5.1")).toThrow(/not a decimal/);
    expect(() => dec("1e3")).toThrow(/not a decimal/);
    expect(() => dec("NaN")).toThrow();
    expect(() => intDec(0.5)).toThrow(/whole numbers only/);
    expect(intDec(30).toFixed()).toBe("30");
    // @ts-expect-error a number is not a valid argument to dec(), at compile time as well as run time
    expect(() => dec(12.5)).toThrow();
  });

  it.each<[string, number, RoundingMode, string]>([
    ["2.5", 0, "HALF_UP", "3"],
    ["2.5", 0, "HALF_EVEN", "2"],
    ["3.5", 0, "HALF_EVEN", "4"],
    ["-2.5", 0, "HALF_UP", "-3"], // half away from zero
    ["2.01", 0, "UP", "3"],
    ["2.99", 0, "DOWN", "2"],
    ["-2.01", 0, "UP", "-3"],
    ["2.01", 0, "CEIL", "3"],
    ["-2.99", 0, "CEIL", "-2"],
    ["-2.01", 0, "FLOOR", "-3"],
    ["1234.5678", 2, "HALF_UP", "1234.57"],
    ["0.005", 2, "HALF_UP", "0.01"],
    ["0.004999", 2, "HALF_UP", "0"],
  ])("rounds %s to %i places, %s: %s", (value, scale, mode, expected) => {
    expect(roundTo(dec(value), scale, mode).toFixed()).toBe(expected);
  });

  it("refuses a nonsense scale", () => {
    expect(() => roundTo(dec("1"), -1, "HALF_UP")).toThrow();
    expect(() => roundTo(dec("1"), 7, "HALF_UP")).toThrow();
  });

  it("takes a percentage as a percentage, exactly", () => {
    expect(percentOf(dec("15000"), dec("12")).toFixed()).toBe("1800");
    expect(percentOf(dec("15000"), dec("8.33")).toFixed()).toBe("1249.5");
    expect(percentOf(dec("21000"), dec("0.75")).toFixed()).toBe("157.5");
  });

  it("has one canonical string, whatever the construction", () => {
    expect(canonicalDecimal(dec("1.50"))).toBe("1.5");
    expect(canonicalDecimal(dec("1.5"))).toBe("1.5");
    expect(canonicalDecimal(dec("1000000000000000000000.25"))).toBe("1000000000000000000000.25"); // no exponent form
    expect(canonicalDecimal(dec("0.0000001"))).toBe("0.0000001");
    expect(fixed(dec("1234.5"), 2)).toBe("1234.50");
  });

  it("is the same Decimal family Prisma stores, so values go to and from the database untouched", () => {
    expect(Prisma.Decimal.isDecimal(dec("1.25"))).toBe(true);
    expect(new Prisma.Decimal(dec("1.25").toString()).equals(dec("1.25"))).toBe(true);
    expect(Dec.precision).toBe(40);
  });
});

describe("the canonical hash", () => {
  it("is the same whatever the key order, and different for one changed paisa", () => {
    const a = { b: dec("100.10"), a: [dec("1"), dec("2.50")], c: { y: "x", x: 3 } };
    const b = { c: { x: 3, y: "x" }, a: [dec("1.0"), dec("2.5")], b: dec("100.1") };
    expect(payrollHash(a)).toBe(payrollHash(b));
    expect(payrollHash({ ...a, b: dec("100.11") })).not.toBe(payrollHash(a));
    expect(payrollHash(a)).toMatch(new RegExp(`^${HASH_VERSION}:[0-9a-f]{64}$`));
  });

  it("refuses floats and undefined, which could differ by a hair between two runs", () => {
    expect(() => payrollHash({ x: 1.5 })).toThrow(NonCanonicalValueError);
    expect(() => payrollHash({ x: Number.NaN })).toThrow(NonCanonicalValueError);
    expect(() => payrollHash({ x: undefined })).toThrow(NonCanonicalValueError);
    expect(() => payrollHash({ x: () => 1 })).toThrow(NonCanonicalValueError);
    expect(payrollHash({ x: 7 })).toBeTruthy(); // whole numbers are fine (counts, versions)
  });

  it("serialises dates and bigints as text, and keeps array order", () => {
    expect(canonicalJson({ d: new Date("2026-10-16T00:00:00Z"), n: 5n })).toBe('{"d":"2026-10-16T00:00:00.000Z","n":"5"}');
    expect(payrollHash([1, 2])).not.toBe(payrollHash([2, 1]));
  });
});
