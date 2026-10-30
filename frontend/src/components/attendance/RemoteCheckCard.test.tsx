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
    const { container } = view({ remote: false, today: "2026-10-30", record: null, canCheckIn: false, canCheckOut: false });
    await waitFor(() => expect(api.myRemoteToday).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(container.textContent).toBe("");
  });

  it("offers Check in only before checking in, and Check out only after, and says nothing about where the person is", async () => {
    view({ remote: true, today: "2026-10-30", record: null, canCheckIn: true, canCheckOut: false });
    const checkIn = (await screen.findByText("Check in")).closest("button") as HTMLButtonElement;
    const checkOut = screen.getByText("Check out").closest("button") as HTMLButtonElement;
    expect([checkIn.disabled, checkOut.disabled]).toEqual([false, true]);
    expect(screen.getByText(/Nothing about where you are is asked for or kept/)).toBeTruthy();
  });

  it("after check-in the times are shown as time of day only", async () => {
    view({ remote: true, today: "2026-10-30", record: { id: "r", date: "2026-10-30", checkIn: "09:35", checkOut: null, status: "OPEN", half: null, decidedAt: null, decisionReason: null, rejectOutcome: null, reopenCount: 0, openRequests: 0 }, canCheckIn: false, canCheckOut: true });
    expect(await screen.findByText(/In 09:35/)).toBeTruthy();
    const checkOut = screen.getByText("Check out").closest("button") as HTMLButtonElement;
    expect(checkOut.disabled).toBe(false);
  });
});
