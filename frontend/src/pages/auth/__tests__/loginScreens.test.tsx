// @vitest-environment jsdom
import "../../../ui/__tests__/setup";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { FORGOT_PASSWORD_REPLY } from "@shared/constants/login";
import { AppThemeProvider } from "../../../theme/ThemeProvider";

// Employee-number login (docs/plans/LOGIN_CHECKLIST.md): the login and Forgot password screens ask for the employee number, send it trimmed, and
// Forgot password always shows the one reply (it never says whether a number exists).

const auth = vi.hoisted(() => ({ login: vi.fn() }));
vi.mock("../../../hooks/useAuth", () => ({ useAuth: () => ({ login: auth.login }) }));
const authApi = vi.hoisted(() => ({ forgotPassword: vi.fn(), isLoginChallenge: () => false }));
vi.mock("../../../api/auth", () => authApi);

import { LoginPage } from "../login/LoginPage";
import { ForgotPasswordPage } from "../forgot-password/ForgotPasswordPage";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
// Ant Design's form feedback schedules short delayed state updates (rc-component useDelayState). Let them run while the jsdom window still exists,
// or they fire after teardown as "window is not defined" and fail the run (found by CI run 422).
afterAll(() => new Promise((resolve) => setTimeout(resolve, 1500)));

const renderAt = (ui: React.ReactNode) =>
  render(
    <AppThemeProvider>
      <MemoryRouter>{ui}</MemoryRouter>
    </AppThemeProvider>,
  );

describe("login screen", () => {
  it("asks for the employee number (the machine number), focused first, and sends it trimmed", async () => {
    auth.login.mockResolvedValue({ user: { roleCodes: [] } });
    renderAt(<LoginPage />);
    const number = screen.getByLabelText(/Employee number/);
    expect(document.activeElement).toBe(number);
    expect(screen.getByText("The same number as on the attendance machine.")).toBeTruthy();
    expect(screen.queryByText(/Employee Code/)).toBeNull();
    fireEvent.change(number, { target: { value: "  0486 " } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: "Secret123" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() => expect(auth.login).toHaveBeenCalledWith("0486", "Secret123"));
  });

  it("shows the server's message for a wrong password, and refuses an all-spaces number before sending", async () => {
    auth.login.mockRejectedValue({ isAxiosError: true, response: { status: 401, data: { error: { code: "INVALID_CREDENTIALS", message: "The employee number or password is not correct." } } } });
    renderAt(<LoginPage />);
    fireEvent.change(screen.getByLabelText(/Employee number/), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByText("Enter your employee number")).toBeTruthy();
    expect(auth.login).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Employee number/), { target: { value: "486" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByText("The employee number or password is not correct.")).toBeTruthy();
  });

  it("always shows the first-time hint, before any attempt and after a failed one", async () => {
    auth.login.mockRejectedValue({ response: { status: 401, data: { error: { code: "INVALID_CREDENTIALS", message: "The employee number or password is not correct." } } } });
    renderAt(<LoginPage />);
    const hint = "First time, or forgot your password? Use Forgot password with your employee number.";
    expect(screen.getByText(hint)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Employee number/), { target: { value: "486" } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByText("The employee number or password is not correct.")).toBeTruthy();
    expect(screen.getByText(hint)).toBeTruthy();
  });

  it("links to Forgot password", () => {
    renderAt(<LoginPage />);
    expect(screen.getByRole("link", { name: "Forgot password?" }).getAttribute("href")).toBe("/forgot-password");
  });
});

describe("forgot-password screen", () => {
  it("asks for the employee number, sends it trimmed, then shows the one reply", async () => {
    authApi.forgotPassword.mockResolvedValue(undefined);
    renderAt(<ForgotPasswordPage />);
    const number = screen.getByLabelText(/Employee number/);
    expect(document.activeElement).toBe(number);
    expect(screen.getByText(/set your first password/)).toBeTruthy();
    fireEvent.change(number, { target: { value: " 486 " } });
    fireEvent.click(screen.getByRole("button", { name: "Send link" }));
    await waitFor(() => expect(authApi.forgotPassword).toHaveBeenCalledWith("486"));
    expect(await screen.findByText(FORGOT_PASSWORD_REPLY)).toBeTruthy();
    expect(FORGOT_PASSWORD_REPLY).toBe("If that account exists, a link has been sent to the email on record.");
  });

  it("shows the plain rate-limit message when the server refuses", async () => {
    authApi.forgotPassword.mockRejectedValue({ response: { status: 429, data: { error: { message: "Too many requests for this employee number. Please wait an hour and try again, or ask HR." } } } });
    renderAt(<ForgotPasswordPage />);
    fireEvent.change(screen.getByLabelText(/Employee number/), { target: { value: "486" } });
    fireEvent.click(screen.getByRole("button", { name: "Send link" }));
    expect(await screen.findByText("Too many requests for this employee number. Please wait an hour and try again, or ask HR.")).toBeTruthy();
  });
});
