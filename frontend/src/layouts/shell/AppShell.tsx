import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Drawer, Dropdown, type MenuProps } from "antd";
import { DownOutlined, LogoutOutlined, MenuOutlined, MoonOutlined, SearchOutlined, SunOutlined } from "@ant-design/icons";
import { useAuth } from "../../hooks/useAuth";
import { useThemeMode } from "../../theme/ThemeProvider";
import { fs, fw, v } from "../../theme/tokens";
import { getMyProfile } from "../../api/employee";
import { EmployeeAvatar } from "../../components/common/EmployeeAvatar";
import { PageSkeleton } from "../../ui/Skeletons";
import { useIsCompact, useIsPhone } from "../../ui/hooks";
import { NotificationBell } from "../../components/common/NotificationBell";
import { DemoCompanyBanner } from "../../components/common/DemoCompanyBanner";
import type { PaletteAction } from "./CommandPalette";
import { Sidebar, type PinnedLink } from "./Sidebar";
import { ThemeToggle } from "./ThemeToggle";
import { activeLeafFor, type NavEntry } from "./nav";
import "./shell.css";

const loadPalette = () => import("./CommandPalette");
const CommandPalette = lazy(() => loadPalette().then((m) => ({ default: m.CommandPalette })));

const COLLAPSE_KEY = "wellsure-sidebar-collapsed";

export interface AppShellProps {
  nav: NavEntry[];
  homeKey: string;
  homePath: string;
  pinned: PinnedLink[];
  /** Desktop top-bar links (only pages the person can open). */
  topLinks?: { label: string; to: string }[];
  /** Extra controls in the desktop top bar (admin: payroll month, employee filter). */
  topExtras?: ReactNode;
  /** Avatar menu items above "Sign out". */
  userMenu?: MenuProps["items"];
  /** The phone bottom tab bar (employee portal), or null. */
  tabBar?: ReactNode;
  /** On phones without a tab bar, the menu opens from a hamburger (admin portal). */
  phoneMenu?: boolean;
  /** Notices above every page (security events, install prompt). */
  notices?: ReactNode;
  /** Title for a path the menu does not know (detail pages, phone tabs). */
  titleFor?: (pathname: string) => string | undefined;
  version?: string;
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

// The app shell shared by both portals (docs/DESIGN_SYSTEM.md §4–5). It stays mounted while pages change: only the content area swaps, with a 180 ms fade-up and a
// page-shaped skeleton while a page's code loads. ≥ 1280: sidebar; 768–1279: sidebar in a drawer; < 768: header + bottom tabs (employee) or a menu drawer (admin).
export function AppShell({ nav, homeKey, homePath, pinned, topLinks = [], topExtras, userMenu = [], tabBar, phoneMenu = false, notices, titleFor, version = "v0.1.0" }: AppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const phone = useIsPhone();
  const compact = useIsCompact();
  const { user, logout } = useAuth();
  const { mode, toggleMode } = useThemeMode();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  // The palette (an antd Modal) loads on first use, or when the browser is idle, never in the shell's first download.
  const [paletteUsed, setPaletteUsed] = useState(false);
  if (palette && !paletteUsed) setPaletteUsed(true);
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 2000));
    idle(() => void loadPalette().catch(() => undefined));
  }, []);

  const active = activeLeafFor(nav, location.pathname);
  const title = titleFor?.(location.pathname) ?? active?.label ?? "Wellsure HR";

  useEffect(() => {
    document.title = `${title} · Wellsure HR Portal`;
  }, [title]);

  // New page: menu drawer closed (adjusted during render, so it never flashes open) and back to the top.
  const [drawerPath, setDrawerPath] = useState(location.pathname);
  if (drawerPath !== location.pathname) {
    setDrawerPath(location.pathname);
    setDrawer(false);
  }
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  // Ctrl/⌘ K and "/" open search (DESIGN_SYSTEM.md §10 D10).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPalette((p) => !p);
      } else if (e.key === "/" && !typing) {
        e.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleCollapsed = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        /* per-viewer convenience */
      }
      return !c;
    });

  async function signOut(): Promise<void> {
    await logout();
    navigate("/login");
  }

  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const paletteActions = useMemo<PaletteAction[]>(
    () => [
      { key: "theme", label: mode === "dark" ? "Switch to light theme" : "Switch to dark theme", icon: mode === "dark" ? <SunOutlined /> : <MoonOutlined />, run: toggleMode },
      { key: "signout", label: "Sign out", icon: <LogoutOutlined />, run: () => void signOut() },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- signOut is stable enough for a menu action
    [mode, toggleMode],
  );

  const name = user?.fullName ?? "";
  // The account avatar shows the person's photo once they have one (same query as View My Info, so an upload there updates it here), else initials.
  const { data: me } = useQuery({ queryKey: ["employees", "me"], queryFn: getMyProfile, enabled: Boolean(user?.employeeId), staleTime: 5 * 60_000, retry: false });
  const firstName = name.split(" ")[0] ?? "";
  const menuItems: MenuProps["items"] = [
    {
      key: "who",
      disabled: true,
      label: (
        <div style={{ padding: "4px 0", cursor: "default" }}>
          <div style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{name}</div>
          <div style={{ fontSize: fs.sm, color: v.textSecondary }}>{user?.employeeCode ? `Employee code ${user.employeeCode}` : ""}</div>
        </div>
      ),
    },
    { type: "divider" },
    ...(userMenu ?? []),
    { type: "divider" },
    { key: "signout", icon: <LogoutOutlined />, label: "Sign out", onClick: () => void signOut() },
  ];

  const sidebarFooter = (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <ThemeToggle />
      <div style={{ fontSize: fs.xs, color: v.textSecondary, textAlign: "center" }}>Wellsure HR Portal {version}</div>
    </div>
  );

  const sidebar = (inDrawer: boolean) => (
    <Sidebar
      nav={nav}
      homeKey={homeKey}
      pinned={pinned}
      footer={sidebarFooter}
      collapsed={collapsed}
      onToggleCollapsed={inDrawer ? undefined : toggleCollapsed}
      onNavigate={inDrawer ? () => setDrawer(false) : undefined}
      inDrawer={inDrawer}
    />
  );

  const showMenuButton = compact && (!phone || phoneMenu);

  return (
    <div className="ws-shell">
      <a href="#main" className="ws-skip-link">
        Skip to content
      </a>
      {!compact && sidebar(false)}
      {compact && (
        <Drawer open={drawer} onClose={() => setDrawer(false)} placement="left" size={300} closable={false} styles={{ body: { padding: 0 } }} title={null} aria-label="Menu">
          {sidebar(true)}
        </Drawer>
      )}
      <div className="ws-main">
        <div className="ws-header">
          <DemoCompanyBanner />
          <header className="ws-topbar">
            {showMenuButton && (
              <button type="button" className="ws-icon-btn" aria-label="Open the menu" onClick={() => setDrawer(true)}>
                <MenuOutlined />
              </button>
            )}
            {phone ? (
              <h1 style={{ margin: 0, flex: 1, minWidth: 0, fontSize: fs.xl, fontWeight: fw.bold, color: v.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</h1>
            ) : (
              <button type="button" className="ws-search-trigger" onClick={() => setPalette(true)} aria-label="Search pages and actions">
                <SearchOutlined aria-hidden style={{ color: v.textPrimary, fontSize: fs.lg }} />
                <span>Search anything…</span>
                <span className="ws-kbd" aria-hidden>
                  {isMac ? "⌘" : "Ctrl"} K
                </span>
              </button>
            )}
            {!compact && topLinks.length > 0 && (
              <nav aria-label="Quick links" style={{ display: "flex", gap: 12, marginLeft: 12 }}>
                {topLinks.map((l) => (
                  <a
                    key={l.to}
                    className="ws-toplink"
                    href={l.to}
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(l.to);
                    }}
                  >
                    {l.label}
                  </a>
                ))}
              </nav>
            )}
            <div style={{ flex: phone ? "none" : 1 }} />
            {!compact && topExtras}
            {phone && (
              <button type="button" className="ws-icon-btn" aria-label="Search pages and actions" onClick={() => setPalette(true)}>
                <SearchOutlined />
              </button>
            )}
            <NotificationBell homePath={homePath} />
            <Dropdown menu={{ items: menuItems }} trigger={["click"]} placement="bottomRight">
              <button type="button" className="ws-avatar-btn" aria-label={`Account menu for ${name}`}>
                <EmployeeAvatar employeeId={user?.employeeId ?? ""} name={name || "?"} photoVersion={me?.personal?.photoVersion} size={phone ? 36 : 40} />
                {!compact && (
                  <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.2 }}>
                    <span style={{ fontWeight: fw.semibold, fontSize: fs.md }}>{firstName}</span>
                  </span>
                )}
                {!phone && <DownOutlined aria-hidden style={{ fontSize: fs.xs, color: v.textSecondary }} />}
              </button>
            </Dropdown>
          </header>
        </div>
        <main id="main" className="ws-content" tabIndex={-1}>
          {notices}
          <div key={location.pathname} className="ws-page-enter">
            <Suspense fallback={<PageSkeleton />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>
      {phone && tabBar}
      {paletteUsed && (
        <Suspense fallback={null}>
          <CommandPalette open={palette} onClose={() => setPalette(false)} nav={nav} actions={paletteActions} />
        </Suspense>
      )}
    </div>
  );
}
