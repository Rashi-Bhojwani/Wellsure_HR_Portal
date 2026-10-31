// @vitest-environment jsdom
import "../../ui/__tests__/setup";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api/remoteAttendance";
import { RemoteCheckCard } from "./RemoteCheckCard";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const view = (today: api.RemoteToday) => {
  vi.spyOn(api, "myRemoteToday").mockResolvedValue(today);
  vi.spyOn(api, "myRemoteRecords").mockResolvedValue([]);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RemoteCheckCard />
    </QueryClientProvider>,
  );
};

describe("the remote check-in card", () => {
  it("shows nothing to a person who is not marked as remote (nobody is, by default)", async () => {
    const { container } = view({ remote: false, today: "2026-10-30", serverTime: "10:00", state: "NOT_STARTED", record: null, canCheckIn: false, canCheckOut: false });
    await waitFor(() => expect(api.myRemoteToday).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(container.textContent).toBe("");
  });

  it("offers Check in only before checking in, and Check out only after, and says nothing about where the person is", async () => {
    view({ remote: true, today: "2026-10-30", serverTime: "10:00", state: "NOT_STARTED", record: null, canCheckIn: true, canCheckOut: false });
    const checkIn = (await screen.findByText("Check in")).closest("button") as HTMLButtonElement;
    const checkOut = screen.getByText("Check out").closest("button") as HTMLButtonElement;
    expect([checkIn.disabled, checkOut.disabled]).toEqual([false, true]);
    expect(screen.getByText(/Nothing about where you are is asked for or kept/)).toBeTruthy();
  });

  it("after check-in the times are shown as time of day only", async () => {
    view({ remote: true, today: "2026-10-30", record: { id: "r", date: "2026-10-30", checkIn: "09:35", checkOut: null, status: "OPEN", half: null, decidedAt: null, decisionReason: null, rejectOutcome: null, reopenCount: 0, openRequests: 0, hours: null, reviewUsed: false }, serverTime: "10:00", state: "CHECKED_IN", canCheckIn: false, canCheckOut: true });
    expect(await screen.findByText(/In 09:35/)).toBeTruthy();
    const checkOut = screen.getByText("Check out").closest("button") as HTMLButtonElement;
    expect(checkOut.disabled).toBe(false);
  });

  it("shows the server time and today's state, and the state in words", async () => {
    view({ remote: true, today: "2026-10-30", serverTime: "10:42", state: "NOT_STARTED", record: null, canCheckIn: true, canCheckOut: false });
    expect(await screen.findByText(/server time 10:42/)).toBeTruthy();
    expect(screen.getByText("Not started")).toBeTruthy();
  });

  it("a rejected day shows the director's reason and the outcome, and a day with a used review offers none", async () => {
    const rejected = { id: "r", date: "2026-10-30", checkIn: "09:00", checkOut: "17:00", status: "REJECTED" as const, half: null, decidedAt: "2026-10-30T12:00:00Z", decisionReason: "No work was shown for the day", rejectOutcome: "LOSS_OF_PAY" as const, reopenCount: 0, openRequests: 0, hours: "8:00", reviewUsed: true };
    vi.spyOn(api, "myRemoteToday").mockResolvedValue({ remote: true, today: "2026-10-30", serverTime: "18:00", state: "REJECTED", record: rejected, canCheckIn: false, canCheckOut: false });
    vi.spyOn(api, "myRemoteRecords").mockResolvedValue([rejected]);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RemoteCheckCard />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/Not approved: Loss of pay/)).toBeTruthy();
    expect(screen.getAllByText(/No work was shown for the day/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Ask for a review/)).toBeNull(); // the one review has been used
    expect(screen.getAllByText(/8:00 h/).length).toBeGreaterThan(0);
  });
});
