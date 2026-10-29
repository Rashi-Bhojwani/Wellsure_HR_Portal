import type { ComponentType } from "react";
import { adminApps } from "../../routes/adminMenu.config";
import { canSeeLeaf, employeeMenu, isComingSoon, isEmployeeMenuGroup } from "../../routes/employeeMenu.config";

// The shell's navigation model, generated from the two menu configs (still the single source of truth for routes, sidebar, phone tabs and page titles).

export interface NavLeaf {
  kind: "leaf";
  key: string;
  label: string;
  /** Absolute path. */
  path: string;
  icon?: ComponentType;
  /** Not built yet ("Phase 7"): listed dimmed with a "Soon" chip, still opens its coming-soon page. */
  soon?: string;
  element?: unknown;
}
export interface NavSection {
  kind: "section";
  key: string;
  label: string;
}
export interface NavGroup {
  kind: "group";
  key: string;
  label: string;
  icon?: ComponentType;
  children: (NavLeaf | NavSection)[];
}
export type NavEntry = NavLeaf | NavGroup;

export const ADMIN_TIER_ROLES = ["HR_ADMIN", "HR_EXECUTIVE", "PAYROLL_ADMIN", "SUPER_ADMIN", "PAYROLL_APPROVER", "DEVELOPER"];

/** Employee portal: every menu entry the person may see (permission-gated leaves only for holders). Helpdesk is pinned at the bottom as "Help Center". */
export function employeeNav(hasPermission: (key: string) => boolean): NavEntry[] {
  return employeeMenu
    .filter((e) => e.key !== "helpdesk")
    .map((entry): NavEntry | null => {
      if (isEmployeeMenuGroup(entry)) {
        const children = entry.children
          .filter((c) => canSeeLeaf(c, hasPermission))
          .map((c): NavLeaf => ({ kind: "leaf", key: c.key, label: c.label, path: `/app/${c.path}`, icon: c.icon, soon: isComingSoon(c) ? (c.phase ?? "Later") : undefined, element: c.element }));
        if (children.length === 0) return null;
        return { kind: "group", key: entry.key, label: entry.label, icon: entry.icon, children };
      }
      return { kind: "leaf", key: entry.key, label: entry.label, path: `/app/${entry.path}`, icon: entry.icon, soon: isComingSoon(entry) ? (entry.phase ?? "Later") : undefined, element: entry.element };
    })
    .filter((e): e is NavEntry => e !== null);
}

/** HR / Admin portal: each app is a group (Homepage and Tasks are single items); an app's own overview page comes first, then its menus as sections. */
export function adminNav(): NavEntry[] {
  return adminApps.map((app): NavEntry => {
    const path = app.path === "" ? "/admin" : `/admin/${app.path}`;
    if (!app.menus || app.menus.length === 0) {
      return { kind: "leaf", key: app.key, label: app.label === "Homepage" ? "Home" : app.label, path, icon: app.icon, soon: app.phase, element: app.element };
    }
    const children: (NavLeaf | NavSection)[] = [];
    if (app.element) children.push({ kind: "leaf", key: `${app.key}-overview`, label: "Overview", path, element: app.element });
    const multi = app.menus.length > 1 || app.element;
    for (const group of app.menus) {
      if (multi) children.push({ kind: "section", key: `${app.key}-${group.key}`, label: group.label });
      for (const item of group.items) {
        children.push({ kind: "leaf", key: item.key, label: item.label, path: `/admin/${item.path}`, icon: item.icon, soon: item.phase, element: item.element });
      }
    }
    return { kind: "group", key: app.key, label: app.label, icon: app.icon, children };
  });
}

export function flattenLeaves(nav: NavEntry[]): (NavLeaf & { group?: string })[] {
  return nav.flatMap((e) => (e.kind === "leaf" ? [e] : e.children.filter((c): c is NavLeaf => c.kind === "leaf").map((c) => ({ ...c, group: e.label }))));
}

/** The leaf a path belongs to: exact, else the longest leaf path it sits under (detail pages). */
export function activeLeafFor(nav: NavEntry[], pathname: string): (NavLeaf & { group?: string }) | undefined {
  const leaves = flattenLeaves(nav);
  const clean = pathname.replace(/\/+$/, "") || "/";
  return leaves.find((l) => l.path === clean) ?? leaves.filter((l) => l.path !== "/admin" && clean.startsWith(`${l.path}/`)).sort((a, b) => b.path.length - a.path.length)[0] ?? (clean === "/admin" ? leaves.find((l) => l.path === "/admin") : undefined);
}
