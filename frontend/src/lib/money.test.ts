import { describe, expect, it } from "vitest";
import { formatDifference, formatRupees } from "./money";

describe("formatRupees", () => {
  it("groups the Indian way, without ever becoming a number", () => {
    expect(formatRupees("0")).toBe("₹0");
    expect(formatRupees("999")).toBe("₹999");
    expect(formatRupees("1000")).toBe("₹1,000");
    expect(formatRupees("100000")).toBe("₹1,00,000");
    expect(formatRupees("1234567.5")).toBe("₹12,34,567.5");
    expect(formatRupees("1234567.5", 2)).toBe("₹12,34,567.50");
    expect(formatRupees("-2065")).toBe("-₹2,065");
    expect(formatRupees("99999999999999999999.123456")).toBe("₹9,99,99,99,99,99,99,99,99,999.123456"); // far past 2^53: still exact
  });
  it("leaves anything that is not an amount alone, and signs a difference", () => {
    expect(formatRupees("n/a")).toBe("n/a");
    expect(formatDifference("4000")).toBe("+₹4,000");
    expect(formatDifference("-2000")).toBe("-₹2,000");
    expect(formatDifference("0")).toBe("₹0");
    expect(formatDifference("-0.00")).toBe("₹0");
  });
});
