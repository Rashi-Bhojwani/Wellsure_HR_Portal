// @vitest-environment jsdom
import "../../../ui/__tests__/setup";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as payrollApi from "../../../api/payroll";
import type { ImportView } from "../../../api/payroll";
import { MonthlyInputsImport } from "./MonthlyInputsImport";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const preview: ImportView = {
  id: "b1",
  fileName: "sample.csv",
  fileHash: "h",
  status: "PREVIEW",
  alreadyApplied: null,
  fingerprint: "fp",
  canApply: false,
  canApplySkippingInvalid: true,
  analysis: {
    columns: [{ header: "Employee Number", kind: "FIXED" }, { header: "Incentive", kind: "HEAD", head: "INC" }],
    fileProblems: [],
    valid: 1,
    invalid: 1,
    cells: 1,
    months: ["2026-08-01"],
    notices: ["Override From and Override Till are read as an inclusive range of payroll months. The owners have not confirmed this reading."],
    rows: [
      { line: 2, employeeNumber: "E1", employeeId: "x", name: "A Person", from: "2026-08-01", till: "2026-08-31", months: ["2026-08-01"], figures: { INC: "10" }, principal: null, interest: null, remarks: "", problems: [] },
      { line: 3, employeeNumber: "NOPE", employeeId: null, name: null, from: null, till: null, months: [], figures: {}, principal: null, interest: null, remarks: "", problems: ["No employee has the number NOPE."] },
    ],
  },
};

const view = () => {
  vi.spyOn(payrollApi, "listImports").mockResolvedValue([{ id: "b1", fileName: "sample.csv", status: "PREVIEW", summary: { valid: 1, invalid: 1 }, createdAt: "2026-10-31T00:00:00Z", appliedAt: null }]);
  vi.spyOn(payrollApi, "getImport").mockResolvedValue(preview);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MonthlyInputsImport canEdit onApplied={() => undefined} />
    </QueryClientProvider>,
  );
};

describe("the Monthly Inputs import screen", () => {
  it("starts with nothing previewed and says nothing is saved before a confirm", () => {
    view();
    expect(screen.getByText(/Nothing is saved until you confirm the preview/)).toBeTruthy();
    expect(screen.queryByText(/Preview:/)).toBeNull();
  });

  it("shows a preview with line numbers, the problem in words, the unconfirmed reading, and a skip choice (never silently saved)", async () => {
    view();
    fireEvent.click(await screen.findByText("Open"));
    await waitFor(() => expect(screen.getByText(/No employee has the number NOPE/)).toBeTruthy());
    expect(screen.getByText(/The owners have not confirmed this reading/)).toBeTruthy();
    expect(screen.getByText(/1 valid, 1 with a problem/)).toBeTruthy();
    expect(screen.getByText(/Skip the 1 invalid row and save the 1 valid/)).toBeTruthy();
    const save = screen.getByText("Save these figures").closest("button") as HTMLButtonElement;
    expect(save.disabled).toBe(true); // needs a reason, and the skip choice, before it can save
  }, 20_000);
});
