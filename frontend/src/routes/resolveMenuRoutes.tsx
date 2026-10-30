import { Navigate } from "react-router-dom";
import type { ComponentType, ReactElement } from "react";
import { PlaceholderPage } from "../components/common/PlaceholderPage";
import { RequireAccess } from "../components/common/RequireAccess";
import { adminApps, type AdminApp } from "./adminMenu.config";
import { employeeMenu, isEmployeeMenuGroup } from "./employeeMenu.config";

// Single source of truth for turning the two menu configs into route
// elements — used by router.tsx to build the real <Routes> tree, and by
// routes.test.tsx to prove every route that's supposed to be delivered
// actually resolves to something other than PlaceholderPage. Both read
// this same resolution, so the test can never drift from what the app
// actually does.
//
// `kind` is computed structurally (element present? a redirect target
// found?) rather than by rendering `element` and inspecting its type —
// `element` may wrap a real page component that calls hooks, which is
// only safe to invoke inside an actual React render tree, not from a
// plain test calling a function directly.

export type RouteKind = "real" | "redirect" | "placeholder";

export interface ResolvedRoute {
  fullPath: string; // absolute, e.g. "/admin/employee"
  relativePath: string; // relative to /admin or /app, as router.tsx's <Route path> needs it
  isIndex: boolean;
  label: string;
  phase?: string;
  kind: RouteKind;
  element: ReactElement;
}

function render(Component: ComponentType): ReactElement {
  return <Component />;
}

// The first sub-item (in declared order) that actually has a real page.
// An app's own base path (e.g. "employee", with no `element` of its own)
// lands here instead of a stub, so long as at least one of its screens is
// actually built — see router.tsx's adminRoutes for why.
export function firstRealSubPath(app: AdminApp): string | undefined {
  for (const group of app.menus ?? []) {
    for (const item of group.items) {
      if (item.element) return item.path;
    }
  }
  return undefined;
}

export function resolveAdminRoutes(): ResolvedRoute[] {
  const routes: ResolvedRoute[] = [];

  for (const app of adminApps) {
    const fallbackPath = app.element ? undefined : firstRealSubPath(app);
    const kind: RouteKind = app.element ? "real" : fallbackPath ? "redirect" : "placeholder";
    const element =
      kind === "real"
        ? render(app.element!)
        : kind === "redirect"
          ? <Navigate to={`/admin/${fallbackPath}`} replace />
          : <PlaceholderPage title={app.label} phase={app.phase} />;
    routes.push({
      fullPath: app.path === "" ? "/admin" : `/admin/${app.path}`,
      relativePath: app.path,
      isIndex: app.path === "",
      label: app.label,
      phase: app.phase,
      kind,
      element,
    });

    for (const group of app.menus ?? []) {
      for (const item of group.items) {
        const kind2: RouteKind = item.element ? "real" : "placeholder";
        const page = item.element ? render(item.element) : <PlaceholderPage title={item.label} phase={item.phase} />;
        // A page the person's permissions no longer cover (a duty a director switched off, a link from before) says so, instead of opening onto an error or an empty board.
        const element2 = item.needs ? <RequireAccess needs={item.needs}>{page}</RequireAccess> : page;
        routes.push({ fullPath: `/admin/${item.path}`, relativePath: item.path, isIndex: false, label: item.label, phase: item.phase, kind: kind2, element: element2 });
      }
    }
  }

  return routes;
}

export function resolveEmployeeRoutes(): ResolvedRoute[] {
  const leaves = employeeMenu.flatMap((entry) => (isEmployeeMenuGroup(entry) ? entry.children : [entry]));
  return leaves.map((leaf) => {
    const kind: RouteKind = leaf.element ? "real" : "placeholder";
    const element = leaf.element ? render(leaf.element) : <PlaceholderPage title={leaf.label} phase={leaf.phase} />;
    return { fullPath: `/app/${leaf.path}`, relativePath: leaf.path, isIndex: false, label: leaf.label, phase: leaf.phase, kind, element };
  });
}
