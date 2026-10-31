// @vitest-environment jsdom
import "../../../ui/__tests__/setup";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PayslipWhy } from "../../../api/payroll";
import { PayslipWhyButton } from "../PayslipWhy";

afterEach(() => cleanup());

const why: PayslipWhy = {
  payslipId: "p1",
  cycleLabel: "Sep 2026",
  lines: [
    {
      code: "BASIC",
      label: "Basic",
      kind: "EARNING",
      source: "COMPONENT",
      amount: "20000",
      explanation: ["Basic is its monthly amount for the days you were paid."],
      working: [{ name: "unrounded", value: "20000" }],
      rules: [{ key: "LINE_ROUNDING", label: "Rounding of salary lines", value: { mode: "HALF_UP", scale: 0 }, version: 1, status: "CONFIRMED", sourceNote: "A made-up note", effectiveFrom: "2026-04-01", enteredBy: "A", confirmedBy: "B", confirmedOn: "2026-04-02", level: "DEPARTMENT", overridden: true, registrationRef: "REG-1" }],
    },
  ],
};

const view = (load: () => Promise<PayslipWhy>, masked = false) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PayslipWhyButton queryKey={["why", "p1"]} load={load} masked={masked} />
    </QueryClientProvider>,
  );

describe("the payslip Why? button", () => {
  it("renders closed without loading anything and without an error (it crashed the payslip page once)", () => {
    const load = vi.fn();
    view(load);
    expect(screen.getByRole("button", { name: /why\?/i })).toBeTruthy();
    expect(screen.queryByText(/could not load/i)).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it("opens and shows the line, the rule, where it came from, who confirmed it, and that it came from an override", async () => {
    view(vi.fn().mockResolvedValue(why));
    fireEvent.click(screen.getByRole("button", { name: /why\?/i }));
    await waitFor(() => expect(screen.getByText("Rounding of salary lines")).toBeTruthy());
    expect(screen.getByText(/A made-up note/)).toBeTruthy();
    expect(screen.getByText(/confirmed by B/)).toBeTruthy();
    expect(screen.getByText(/From an override \(department\)/)).toBeTruthy();
    expect(screen.getByText(/registration REG-1/)).toBeTruthy();
  });

  it("hides amounts and figures while the employee has salary masked", async () => {
    view(vi.fn().mockResolvedValue(why), true);
    fireEvent.click(screen.getByRole("button", { name: /why\?/i }));
    await waitFor(() => expect(screen.getByText("Rounding of salary lines")).toBeTruthy());
    expect(screen.getByText("₹ *****")).toBeTruthy();
    expect(screen.queryByText("unrounded:")).toBeNull();
    expect(document.body.textContent).not.toContain("20,000");
  });

  it("says in words when the explanation cannot be loaded", async () => {
    view(vi.fn().mockRejectedValue(new Error("boom")));
    fireEvent.click(screen.getByRole("button", { name: /why\?/i }));
    await waitFor(() => expect(screen.getAllByText(/could not load the explanation/i).length).toBeGreaterThan(0));
  });
});
