// @vitest-environment jsdom
import "../../ui/__tests__/setup";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REPORT_KEYS } from "@shared/constants/reports";
import { DEVELOPER_ROLE_CODE, DEVELOPER_ROLE_PERMISSIONS } from "@shared/constants/sensitiveData";

// Owners' decision (2026-11-14): every report is closed to the Developer / operator role. This walks the whole Reports menu as the Developer: the
// role holds no report key, every report page shows the forbidden page (never a table or a figure), the overview says "You can't open reports",
// and the sidebar offers no report. The server side is backend/src/modules/reports/__tests__/developerNoReports.test.ts.
const who = { roleCodes: [DEVELOPER_ROLE_CODE] as string[], permissions: [...DEVELOPER_ROLE_PERMISSIONS] as string[] };
vi.mock("../../hooks/useAuth", () => ({
  useAuth: () => ({ user: { roleCodes: who.roleCodes, permissions: who.permissions }, hasPermission: (k: string) => who.permissions.includes(k), hasRole: (c: string) => who.roleCodes.includes(c) }),
}));
const fetched: string[] = [];
vi.mock("../../api/reports", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(real).map(([k, f]) => [k, typeof f === "function" ? () => { fetched.push(k); return Promise.resolve([]); } : f]));
});

const { adminApps, adminNeedsMet } = await import("../adminMenu.config");
const { adminNav } = await import("../../layouts/shell/nav");
const { RequireAccess } = await import("../../components/common/RequireAccess");
const { ReportsHomePage } = await import("../../pages/admin/reports/ReportsHomePage");

const reportsApp = adminApps.find((a) => a.key === "reports")!;
const items = reportsApp.menus!.flatMap((g) => g.items);
const has = (k: string) => who.permissions.includes(k);

afterEach(() => {
  cleanup();
  who.roleCodes = [DEVELOPER_ROLE_CODE];
  who.permissions = [...DEVELOPER_ROLE_PERMISSIONS];
  fetched.length = 0;
});

describe("the Reports menu, walked as the Developer", () => {
  it("covers every report (not a vacuous walk)", () => {
    expect(items.map((i) => i.path.replace("reports/", "")).sort()).toEqual([...REPORT_KEYS].sort());
  });

  it("the Developer role holds no report key", () => {
    expect(who.permissions.filter((k) => k.startsWith("reports."))).toEqual([]);
  });

  it("every report page refuses the Developer", () => {
    expect(items.filter((i) => adminNeedsMet(i.needs, has, false, true)).map((i) => i.path)).toEqual([]);
  });

  it("the Developer's sidebar offers no report", () => {
    const reports = adminNav(has, false, true).find((e) => e.key === "reports");
    const leaves = reports && reports.kind === "group" ? reports.children.filter((c) => c.kind === "leaf").map((c) => (c as { path: string }).path) : [];
    expect(leaves.filter((p) => p !== "/admin/reports")).toEqual([]);
  });

  it.each(items.map((i) => [i.label, i] as const))("%s shows the forbidden page to the Developer, never the report", (_label, i) => {
    render(<RequireAccess needs={i.needs ?? {}}><div>REPORT TABLE</div></RequireAccess>);
    expect(screen.getByText("This is not switched on for you")).toBeTruthy();
    expect(screen.queryByText("REPORT TABLE")).toBeNull();
  });

  it("the Reports overview says the Developer can't open reports, and asks the server for nothing", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><ReportsHomePage /></MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText("You can't open reports")).toBeTruthy();
    expect(fetched).toEqual([]);
  });

  it("a director still opens every report page (the control)", () => {
    who.roleCodes = ["SUPER_ADMIN"];
    who.permissions = ["reports.view", "reports.attendance.view", "reports.leave.view", "reports.liability.view"];
    for (const i of items) {
      render(<RequireAccess needs={i.needs ?? {}}><div>REPORT TABLE</div></RequireAccess>);
      expect(screen.getByText("REPORT TABLE"), i.path).toBeTruthy();
      cleanup();
    }
  });
});
