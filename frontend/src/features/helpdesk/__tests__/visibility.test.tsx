// @vitest-environment jsdom
import "../../../ui/__tests__/setup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CategoryVisibilityPanel } from "../CategoryVisibilityPanel";
import * as api from "../../../api/helpdesk";

const auth = vi.hoisted(() => ({ director: true }));
vi.mock("../../../hooks/useAuth", () => ({ useAuth: () => ({ hasPermission: () => true, hasRole: (code: string) => auth.director && code === "SUPER_ADMIN" }) }));
vi.mock("../../../api/helpdesk", () => ({ readVisibility: vi.fn(), setVisibility: vi.fn() }));
const category = { id: "demo-category", code: "DEMO_GENERAL", name: "DEMO team", isSensitive: false };
const initial: api.CategoryVisibility = { state: "NOT_SET", version: 0, hrRoleCodes: [], employeeIds: ["demo-director"], history: [], people: [{ id: "demo-director", employeeCode: "DEMO001", director: true }] };
function draw() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><CategoryVisibilityPanel category={category} onClose={() => undefined} /></QueryClientProvider>);
}
afterEach(cleanup);
beforeEach(() => { auth.director = true; vi.clearAllMocks(); vi.mocked(api.readVisibility).mockResolvedValue(initial); });
describe("category visibility controls", () => {
  it("HR cannot open the panel or fetch its named audience even with a forged permission", async () => {
    auth.director = false;
    draw();
    expect(screen.queryByTestId("helpdesk-category-visibility")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(api.readVisibility).not.toHaveBeenCalled();
  });
  it("a director sees Not set, must give a reason and saves against the displayed version", async () => {
    vi.mocked(api.setVisibility).mockResolvedValue({ ...initial, state: "CONFIGURED", version: 1 });
    draw();
    await screen.findByTestId("helpdesk-category-visibility");
    expect(screen.getByText("Not set")).toBeTruthy();
    expect(screen.getByText("No visibility decisions yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save visibility" }));
    await screen.findByText("Enter a reason.");
    expect(api.setVisibility).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "DEMO chosen audience" } });
    fireEvent.click(screen.getByRole("button", { name: "Save visibility" }));
    await waitFor(() => expect(api.setVisibility).toHaveBeenCalledWith(category.id, { version: 0, hrRoleCodes: [], employeeIds: ["demo-director"], reason: "DEMO chosen audience" }));
  });
  it("a denied server response renders the forbidden state without the audience", async () => {
    vi.mocked(api.readVisibility).mockRejectedValue({ response: { status: 403 } });
    draw();
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
    await waitFor(() => expect(api.readVisibility).toHaveBeenCalled());
    expect(screen.queryByTestId("helpdesk-category-visibility")).toBeNull();
  });
});
