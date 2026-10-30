// @vitest-environment jsdom
import "../../../ui/__tests__/setup";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DirectorNoticeView, DirectorSwitchView } from "../../../api/director";

const api = vi.hoisted(() => ({ listSwitches: vi.fn(), setSwitch: vi.fn(), confirmSwitch: vi.fn(), listNotices: vi.fn(), acknowledgeNotice: vi.fn() }));
vi.mock("../../../api/director", () => api);

import { DirectorAuthorityCard } from "../DirectorAuthorityCard";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const row = (over: Partial<DirectorSwitchView>): DirectorSwitchView => ({
  step: "BANK_FILE",
  label: "The bank file",
  covers: "Generating the bank transfer file.",
  required: true,
  recommendedSecond: true,
  status: "NOT_SET",
  mode: null,
  demo: false,
  confirmed: null,
  proposed: null,
  ...over,
});
const switches = (over: Partial<DirectorSwitchView> = {}): DirectorSwitchView[] => [
  row(over),
  row({ step: "SETTINGS", label: "System settings", covers: "Changes to System Settings.", required: false, recommendedSecond: false }),
];
const notice = (over: Partial<DirectorNoticeView> = {}): DirectorNoticeView => ({
  id: "n1",
  kind: "ACTION",
  step: "BANK_FILE",
  stepLabel: "The bank file",
  subjectLabel: "the bank file for a test month",
  itemCount: 12,
  authority: "DIRECTOR_AUTHORITY",
  createdAt: "2026-10-29T09:00:00.000Z",
  actorName: "Another Director",
  seenAt: null,
  acknowledgedAt: null,
  escalated: false,
  ...over,
});

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <DirectorAuthorityCard />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("Director authority card", () => {
  it("starts with every payroll step Not set, recommends a different director for the steps that matter most, and says what is blocked", async () => {
    api.listSwitches.mockResolvedValue(switches());
    api.listNotices.mockResolvedValue([]);
    show();
    expect(await screen.findByText("The bank file")).toBeTruthy();
    expect(screen.getByText("System settings")).toBeTruthy();
    expect(screen.getByText("Not set")).toBeTruthy();
    expect(screen.getByText("Recommended")).toBeTruthy();
    expect(screen.getByText(/We recommend turning the second-director check ON/)).toBeTruthy();
    expect(screen.getByText(/Ready for first real run stays red/)).toBeTruthy();
    expect(await screen.findByText("Nothing waiting")).toBeTruthy();
  });

  it("proposing a choice does not set it: it waits for the other director", async () => {
    api.listSwitches.mockResolvedValue(switches());
    api.listNotices.mockResolvedValue([]);
    api.setSwitch.mockResolvedValue(switches({ status: "PENDING_CONFIRMATION", proposed: { mode: "SECOND_DIRECTOR", byName: "Me", at: "2026-10-30T09:00:00.000Z", byMe: true } }));
    show();
    await screen.findByText("The bank file");
    const card = within(screen.getByTestId("choice-BANK_FILE"));
    fireEvent.click(card.getByLabelText("A different director must decide"));
    fireEvent.click(card.getByRole("button", { name: "Propose this" }));
    await waitFor(() => expect(api.setSwitch).toHaveBeenCalledWith("BANK_FILE", "SECOND_DIRECTOR"));
    expect(await screen.findByText("Waiting for the other director")).toBeTruthy();
    // The proposer has nothing to confirm.
    expect(screen.queryByRole("button", { name: /^Confirm/ })).toBeNull();
  });

  it("the other director sees what was proposed and confirms exactly that", async () => {
    api.listSwitches.mockResolvedValue(switches({ status: "PENDING_CONFIRMATION", proposed: { mode: "DIRECTOR_AUTHORITY", byName: "Another Director", at: "2026-10-30T09:00:00.000Z", byMe: false } }));
    api.listNotices.mockResolvedValue([]);
    api.confirmSwitch.mockResolvedValue(switches({ status: "CONFIRMED", mode: "DIRECTOR_AUTHORITY" }));
    show();
    await screen.findByText("The bank file");
    expect(screen.getByText(/Another Director proposed/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Confirm “The acting director decides alone; the other is told”/ }));
    await waitFor(() => expect(api.confirmSwitch).toHaveBeenCalledWith("BANK_FILE", "DIRECTOR_AUTHORITY"));
    expect(await screen.findByText(/Confirmed: The acting director decides alone/)).toBeTruthy();
  });

  it("labels a made-up choice in the demo company", async () => {
    api.listSwitches.mockResolvedValue(switches({ status: "CONFIRMED", mode: "SECOND_DIRECTOR", demo: true }));
    api.listNotices.mockResolvedValue([]);
    show();
    expect(await screen.findByText("DEMO choice")).toBeTruthy();
  });

  it("lists what the other director did, counts only, and acknowledging needs a few words", async () => {
    api.listSwitches.mockResolvedValue(switches());
    api.listNotices.mockResolvedValue([notice()]);
    api.acknowledgeNotice.mockResolvedValue(undefined);
    show();
    expect(await screen.findByText(/the bank file for a test month · 12/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /review & acknowledge/i }));
    const confirm = screen.getByRole("button", { name: "Acknowledge" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("What you checked"), { target: { value: "checked the file" } });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(api.acknowledgeNotice).toHaveBeenCalledWith("n1", "checked the file"));
  });

  it("marks one that has waited too long", async () => {
    api.listSwitches.mockResolvedValue(switches());
    api.listNotices.mockResolvedValue([notice({ escalated: true })]);
    show();
    expect(await screen.findByText(/Waiting > 3 days/)).toBeTruthy();
  });
});
