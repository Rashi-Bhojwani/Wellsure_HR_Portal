// @vitest-environment jsdom
import "../../../ui/__tests__/setup";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DirectorNoticeView, DirectorSwitchView } from "../../../api/director";

const api = vi.hoisted(() => ({ listSwitches: vi.fn(), setSwitch: vi.fn(), listNotices: vi.fn(), acknowledgeNotice: vi.fn() }));
vi.mock("../../../api/director", () => api);

import { DirectorAuthorityCard } from "../DirectorAuthorityCard";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const switches = (over: Partial<DirectorSwitchView> = {}): DirectorSwitchView[] => [
  { step: "BANK_FILE", label: "The bank file", covers: "Generating the bank transfer file.", requireSecondDirector: false, ...over },
  { step: "SETTINGS", label: "System settings", covers: "Changes to System Settings.", requireSecondDirector: false },
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
  it("shows every step with its switch off by default, and says what the other director is told", async () => {
    api.listSwitches.mockResolvedValue(switches());
    api.listNotices.mockResolvedValue([]);
    show();
    expect(await screen.findByText("The bank file")).toBeTruthy();
    expect(screen.getByText("System settings")).toBeTruthy();
    for (const sw of screen.getAllByRole("switch")) expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText(/The other director is told and sees a red banner/)).toBeTruthy();
    expect(await screen.findByText("Nothing waiting")).toBeTruthy();
  });

  it("switching a step changes it at once and does not ask anyone", async () => {
    api.listSwitches.mockResolvedValue(switches());
    api.listNotices.mockResolvedValue([]);
    api.setSwitch.mockResolvedValue(switches({ requireSecondDirector: true }));
    show();
    await screen.findByText("The bank file");
    fireEvent.click(screen.getAllByRole("switch")[0]!);
    await waitFor(() => expect(api.setSwitch).toHaveBeenCalledWith("BANK_FILE", true));
    await waitFor(() => expect(screen.getAllByRole("switch")[0]!.getAttribute("aria-checked")).toBe("true"));
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
