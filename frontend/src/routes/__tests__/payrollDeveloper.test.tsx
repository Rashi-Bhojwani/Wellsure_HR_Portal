// @vitest-environment jsdom
import "../../ui/__tests__/setup";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEVELOPER_ROLE_CODE, DEVELOPER_ROLE_PERMISSIONS } from "@shared/constants/sensitiveData";

// The Developer / operator role never sees a payroll table or figure: every payroll page (the whole Payroll menu, the run and its steps) shows the
// forbidden page instead. This walks the payroll menu as the Developer: the menu rule, the sidebar, and each page as it renders.
const who = { roleCodes: [DEVELOPER_ROLE_CODE] as string[], permissions: [...DEVELOPER_ROLE_PERMISSIONS] as string[] };
vi.mock("../../hooks/useAuth", () => ({
  useAuth: () => ({ user: { roleCodes: who.roleCodes, permissions: who.permissions }, hasPermission: (k: string) => who.permissions.includes(k), hasRole: (c: string) => who.roleCodes.includes(c) }),
}));

const { adminApps, adminNeedsMet, isDeveloperOnly, PAYROLL_NEEDS } = await import("../adminMenu.config");
const { adminNav } = await import("../../layouts/shell/nav");
const { RequireAccess } = await import("../../components/common/RequireAccess");

const payrollItems = adminApps.find((a) => a.key === "payroll")!.menus!.flatMap((g) => g.items);
// The two pages outside the menu are gated with PAYROLL_NEEDS in PortalRoutes.tsx.
const pages = [...payrollItems.map((i) => ({ path: i.path, label: i.label, needs: i.needs })), { path: "payroll/run/:id", label: "Payroll run", needs: PAYROLL_NEEDS }, { path: "payroll/run/:id/step/:slug", label: "Run step", needs: PAYROLL_NEEDS }];
const has = (k: string) => who.permissions.includes(k);

afterEach(() => {
  cleanup();
  who.roleCodes = [DEVELOPER_ROLE_CODE];
  who.permissions = [...DEVELOPER_ROLE_PERMISSIONS];
});

describe("the payroll menu, walked as the Developer", () => {
  it("covers the whole payroll menu (not a vacuous walk)", () => {
    expect(payrollItems.length).toBeGreaterThan(30);
    expect(isDeveloperOnly([DEVELOPER_ROLE_CODE])).toBe(true);
    expect(isDeveloperOnly([DEVELOPER_ROLE_CODE, "SUPER_ADMIN"])).toBe(false);
  });

  it("every payroll page refuses the Developer, though it holds payroll.rules.view", () => {
    expect(has("payroll.rules.view")).toBe(true);
    const open = pages.filter((p) => adminNeedsMet(p.needs, has, false, true));
    expect(open.map((p) => p.path)).toEqual([]);
  });

  it("the run and its steps (outside the menu) are wrapped in the same gate in PortalRoutes.tsx", async () => {
    const src: string = (await import("../PortalRoutes.tsx?raw")).default;
    for (const path of ["payroll/run/:id", "payroll/run/:id/step/:slug"]) {
      const route = src.split("\n").find((l: string) => l.includes(`path="${path}"`)) ?? "";
      expect(route, path).toContain("<RequireAccess needs={PAYROLL_NEEDS}>");
    }
  });

  it("the Developer's sidebar has no payroll entry", () => {
    const leaves = adminNav(has, false, true).flatMap(function walk(e: { path?: string; children?: unknown[] }): string[] {
      return [...(e.path ? [e.path] : []), ...((e.children as Array<{ path?: string; children?: unknown[] }> | undefined) ?? []).flatMap(walk)];
    });
    expect(leaves.filter((p) => p.includes("/payroll/") || p.startsWith("payroll/"))).toEqual([]);
  });

  it.each(pages.map((p) => [p.label, p] as const))("%s shows the forbidden page to the Developer, never the page itself", (_label, p) => {
    render(<RequireAccess needs={p.needs ?? {}}><div>PAGE CONTENT</div></RequireAccess>);
    expect(screen.getByText("This is not switched on for you")).toBeTruthy();
    expect(screen.queryByText("PAGE CONTENT")).toBeNull();
  });

  it("a director still opens every payroll page (the control)", () => {
    who.roleCodes = ["SUPER_ADMIN"];
    for (const p of pages) {
      render(<RequireAccess needs={p.needs ?? {}}><div>PAGE CONTENT</div></RequireAccess>);
      expect(screen.getByText("PAGE CONTENT")).toBeTruthy();
      cleanup();
    }
  });
});
