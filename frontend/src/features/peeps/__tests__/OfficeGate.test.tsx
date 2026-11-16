// @vitest-environment jsdom
import "../../../ui/__tests__/setup";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { OfficeGate } from "../OfficeGate";

const state: { value: Record<string, unknown> } = { value: {} };
vi.mock("../usePeepsMe", () => ({ usePeepsMe: () => state.value }));

// The Office front door: a failed check shows the error state (with Try again), never "no access"; a refusal and a non-member see "no access".
describe("OfficeGate", () => {
  const show = () => render(<MemoryRouter><OfficeGate title="Peeps settings" need="director"><p>inside</p></OfficeGate></MemoryRouter>);

  it("a server error is an error, not a refusal", () => {
    state.value = { isLoading: false, error: { isAxiosError: true, response: { status: 500 } }, refetch: vi.fn() };
    show();
    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
    expect(screen.queryByText("You don't have access")).toBeNull();
    expect(screen.queryByText("inside")).toBeNull();
  });

  it("a refusal, or someone outside the Office, sees no access", () => {
    state.value = { isLoading: false, error: { isAxiosError: true, response: { status: 403 } }, refetch: vi.fn() };
    show();
    expect(screen.getByText("You don't have access")).toBeTruthy();
    state.value = { isLoading: false, data: { isDirector: false, isMember: false, capabilities: [] } };
    show();
    expect(screen.getAllByText("You don't have access").length).toBeGreaterThan(0);
  });

  it("a director sees the page", () => {
    state.value = { isLoading: false, data: { isDirector: true, isMember: false, capabilities: [] } };
    show();
    expect(screen.getByText("inside")).toBeTruthy();
  });
});
