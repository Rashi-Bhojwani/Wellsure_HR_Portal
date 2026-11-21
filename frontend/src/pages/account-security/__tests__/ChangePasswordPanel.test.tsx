// @vitest-environment jsdom
import "../../../ui/__tests__/setup";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { AppThemeProvider } from "../../../theme/ThemeProvider";

// FIX-M1 (independent audit 2026-11-20): "There is no in-app change password." The panel sends the current and new password, keeps this device signed in on
// the token the API returns, and refuses two new passwords that differ before calling the API.
const authApi = vi.hoisted(() => ({ changePassword: vi.fn() }));
vi.mock("../../../api/auth", () => authApi);
const client = vi.hoisted(() => ({ setAccessToken: vi.fn() }));
vi.mock("../../../api/client", () => client);

import { ChangePasswordPanel } from "../ChangePasswordPanel";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
afterAll(() => new Promise((resolve) => setTimeout(resolve, 1500)));

const renderPanel = (onChanged = vi.fn()) => {
  render(
    <AppThemeProvider>
      <MemoryRouter>
        <ChangePasswordPanel onChanged={onChanged} />
      </MemoryRouter>
    </AppThemeProvider>,
  );
  return onChanged;
};
const fill = (current: string, next: string, again: string) => {
  fireEvent.change(screen.getByLabelText("Current password"), { target: { value: current } });
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: next } });
  fireEvent.change(screen.getByLabelText("New password again"), { target: { value: again } });
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));
};

describe("Change password (M1)", () => {
  it("the audit's case: a signed-in person changes their password in the app, and this device keeps the fresh token", async () => {
    authApi.changePassword.mockResolvedValue({ accessToken: "fresh-token" });
    const onChanged = renderPanel();
    fill("Old-pass1", "New-pass12", "New-pass12");
    await waitFor(() => expect(authApi.changePassword).toHaveBeenCalledWith("Old-pass1", "New-pass12"));
    await waitFor(() => expect(client.setAccessToken).toHaveBeenCalledWith("fresh-token"));
    expect(onChanged).toHaveBeenCalled();
  });

  it("two new passwords that differ are refused before anything is sent", async () => {
    renderPanel();
    fill("Old-pass1", "New-pass12", "New-pass13");
    expect(await screen.findByText("The two new passwords are not the same")).toBeTruthy();
    expect(authApi.changePassword).not.toHaveBeenCalled();
  });

  it("a wrong current password shows the API's message and keeps the old token", async () => {
    authApi.changePassword.mockRejectedValue({ isAxiosError: true, response: { status: 400, data: { error: { message: "Your current password is not correct.", code: "WRONG_PASSWORD" } } } });
    renderPanel();
    fill("Wrong-pass1", "New-pass12", "New-pass12");
    expect(await screen.findByText("Your current password is not correct.")).toBeTruthy();
    expect(client.setAccessToken).not.toHaveBeenCalled();
  });
});
