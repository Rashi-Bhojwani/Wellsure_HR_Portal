// @vitest-environment jsdom
import "../../../ui/__tests__/setup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OfferSection } from "../OfferPanel";
import * as offersApi from "../offersApi";
import type * as api from "../api";

vi.mock("../../../hooks/useAuth", () => ({ useAuth: () => ({ user: { employeeId: "DEMO_A" } }) }));
vi.mock("../offersApi", () => ({ offers: vi.fn(), offer: vi.fn(), compensation: vi.fn(), expectedPay: vi.fn(), joining: vi.fn() }));
vi.mock("../api", () => ({ options: vi.fn().mockResolvedValue({ departments: [], locations: [] }), panelOptions: vi.fn().mockResolvedValue([]) }));

const candidate: api.Candidate = { id: "c", name: "DEMO candidate", anonymized: false, expired: false, createdAt: "2098-01-01", canManage: true, applications: [] };
const offer: offersApi.Offer = { id: "o", applicationId: "a", candidate: { id: "c", name: "DEMO candidate" }, job: { id: "j", title: "DEMO job" }, title: "DEMO role", department: null, location: null, reportingManager: null, employmentType: "PERMANENT", joiningDate: "2098-06-01", state: "DRAFT", version: 0, approvalRequired: null, createdAt: "2098-01-01", convertedEmployeeId: null, canManage: true, isDirector: false, events: [] };
function draw(status: offersApi.OfferStatus) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><OfferSection candidate={candidate} status={status} /></MemoryRouter></QueryClientProvider>);
}
afterEach(cleanup);
beforeEach(() => {
  vi.mocked(offersApi.offers).mockReset().mockResolvedValue({ items: [offer] });
  vi.mocked(offersApi.offer).mockReset().mockResolvedValue(offer);
  vi.mocked(offersApi.compensation).mockReset().mockResolvedValue({ offerId: "o", version: 1, value: { amount: "123.45", period: "ANNUAL", currency: "INR" } });
  vi.mocked(offersApi.expectedPay).mockReset().mockResolvedValue({ candidateId: "c", value: null });
});

describe("offer pay in the UI", () => {
  it("a Wellsure Office member never requests or sees offer pay or expected pay", async () => {
    draw({ offerManage: true, onboarding: false, isDirector: false, isApprover: false });
    await screen.findByText("DEMO role");
    expect(screen.queryByText(/directors only/i)).toBeNull();
    expect(offersApi.compensation).not.toHaveBeenCalled();
    expect(offersApi.expectedPay).not.toHaveBeenCalled();
  });
  it("a director loads pay only after choosing Show pay", async () => {
    vi.mocked(offersApi.offer).mockResolvedValue({ ...offer, isDirector: true, pay: { recorded: true, version: 1 } });
    draw({ offerManage: true, onboarding: true, isDirector: true, isApprover: false });
    fireEvent.click(await screen.findByRole("button", { name: "Show pay" }));
    expect(await screen.findByText("INR 123.45 per year")).toBeTruthy();
    expect(offersApi.compensation).toHaveBeenCalledTimes(1);
    expect(offersApi.expectedPay).not.toHaveBeenCalled();
  });
});
