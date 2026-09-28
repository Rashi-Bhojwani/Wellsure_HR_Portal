import { describe, expect, it } from "vitest";
import { resolveAdminRoutes, resolveEmployeeRoutes, type ResolvedRoute } from "../resolveMenuRoutes";

// Guards against exactly the bug this test was added for: a route that
// PROGRESS.md documents as delivered (no `phase` marker on its menu-config
// entry — see adminMenu.config.tsx's file comment for that convention)
// silently still resolving to PlaceholderPage, discoverable only by
// clicking around the app by hand. router.tsx builds its real <Routes>
// tree from the exact same resolveAdminRoutes()/resolveEmployeeRoutes()
// this test calls, so a route this test passes is a route router.tsx
// genuinely serves — not a parallel re-implementation that could drift.
//
// `kind` is computed structurally by resolveMenuRoutes.tsx, not by
// rendering `element` and inspecting its type — inspecting `.type` on a
// wrapped element only ever reveals the wrapper, not what it renders, so
// that approach can't actually detect a placeholder. See that file's
// comment for why.
//
// If a route legitimately isn't built yet, give its menu-config entry a
// `phase` (e.g. `phase: "Phase 2"`) and this test skips it. If you just
// shipped a screen, delete that entry's `phase` field — this test then
// starts enforcing it stays wired up.

function isPlaceholder(route: ResolvedRoute): boolean {
  return route.kind === "placeholder";
}

function assertNoUnexpectedPlaceholders(routes: ResolvedRoute[]): void {
  const broken = routes.filter((r) => !r.phase && isPlaceholder(r));
  if (broken.length > 0) {
    throw new Error(
      `${broken.length} route(s) have no \`phase\` marker (meaning: delivered) but still resolve to PlaceholderPage:\n` +
        broken.map((r) => `  - "${r.label}" at ${r.fullPath}`).join("\n"),
    );
  }
}

describe("every delivered route resolves to a real page, not a stub", () => {
  it("admin portal (/admin/...)", () => {
    assertNoUnexpectedPlaceholders(resolveAdminRoutes());
  });

  it("employee portal (/app/...)", () => {
    assertNoUnexpectedPlaceholders(resolveEmployeeRoutes());
  });

  // The two bugs found in the wild — the "Employee" and "Admin Tools" apps'
  // own base path fell through to PlaceholderPage even though every (or
  // nearly every) item under them was real — pinned individually so a
  // regression here fails with an obvious, specific message rather than
  // just showing up in the generic sweep above.
  it('the "Employee" app lands on All Employees, not a stub', () => {
    const route = resolveAdminRoutes().find((r) => r.fullPath === "/admin/employee");
    expect(route).toBeDefined();
    expect(isPlaceholder(route!)).toBe(false);
  });

  it('the "Admin Tools" app lands on a real page, not a stub', () => {
    const route = resolveAdminRoutes().find((r) => r.fullPath === "/admin/admin-tools");
    expect(route).toBeDefined();
    expect(isPlaceholder(route!)).toBe(false);
  });
});
