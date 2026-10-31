// @vitest-environment jsdom
import "../../../ui/__tests__/setup";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { EngineResult, RegimeComparison } from "../../../api/tax";
import { RegimeCompare } from "../RegimeCompare";

afterEach(cleanup);

const result = (regime: "NEW" | "OLD", annualTax: string): EngineResult => ({ regime, taxablePay: "1600000", standardDeduction: "50000", sections: [], sectionsTotal: "0", taxableIncome: "1550000", slabTax: annualTax, rebate: "0", surchargeRate: "0", surcharge: "0", cessPercent: "4", cess: "0", beforeRounding: annualTax, annualTax, notModelled: [] });
const base: RegimeComparison = { available: true, missing: [], draft: false, basis: "DECLARED", taxablePay: "1600000", results: { NEW: result("NEW", "165360"), OLD: result("OLD", "309400") }, chosen: null, defaultRegime: "NEW" };

describe("the two regimes side by side", () => {
  it("shows both regimes and never marks one as chosen on the person's behalf", () => {
    render(<RegimeCompare comparison={base} />);
    expect(screen.getAllByText("New regime").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Old regime").length).toBeGreaterThan(0);
    expect(screen.queryByText("You chose this")).toBeNull();
    expect(screen.getByText(/You have not chosen/)).toBeTruthy();
  });
  it("marks only the regime the person chose", () => {
    render(<RegimeCompare comparison={{ ...base, chosen: "OLD" }} />);
    for (const el of screen.getAllByText(/^New regime/)) expect(el.textContent).not.toContain("You chose this");
    expect(screen.getAllByText(/^Old regime/).some((el) => el.textContent?.includes("You chose this"))).toBe(true);
  });
  it("says it is a draft while the tax year is not confirmed, and names what is missing when it cannot be shown", () => {
    render(<RegimeCompare comparison={{ ...base, draft: true }} />);
    expect(screen.getByText("Draft")).toBeTruthy();
    cleanup();
    render(<RegimeCompare comparison={{ ...base, available: false, results: {}, missing: ["the cess percentage"] }} />);
    expect(screen.getByText(/the cess percentage/)).toBeTruthy();
  });
});
