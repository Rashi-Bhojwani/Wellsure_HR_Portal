import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AppstoreOutlined, CustomerServiceOutlined, IdcardOutlined, SafetyOutlined, SettingOutlined, SwapOutlined } from "@ant-design/icons";
import { useAuth } from "../hooks/useAuth";
import { MobileTabBar } from "../components/mobile/MobileTabBar";
import { InstallAppBanner } from "../components/mobile/InstallAppBanner";
import { useIsPhone } from "../ui/hooks";
import { AppShell } from "./shell/AppShell";
import { ADMIN_TIER_ROLES, employeeNav } from "./shell/nav";

const EXTRA_TITLES: Record<string, string> = {
  "/app/action": "Actions",
  "/app/explore": "Explore",
  "/app/profile": "View My Info",
  "/app/security": "Account & security",
  "/app/helpdesk": "Help Center",
};

// Employee portal (ESS): the shared AppShell with the employee menu (routes/employeeMenu.config.tsx). Phones get the four-tab bottom bar (UI_REFERENCE.md Part 4) and
// no sidebar or hamburger; tablets get the sidebar in a drawer.
export function EmployeeLayout() {
  const navigate = useNavigate();
  const phone = useIsPhone();
  const { user, hasPermission } = useAuth();
  const nav = useMemo(() => employeeNav(hasPermission), [hasPermission]);
  const isAdminTier = Boolean(user?.roleCodes.some((r) => ADMIN_TIER_ROLES.includes(r)));

  return (
    <AppShell
      nav={nav}
      homeKey="home"
      homePath="/app/home"
      pinned={[
        { key: "help", label: "Help Center", path: "/app/helpdesk", icon: <CustomerServiceOutlined /> },
        { key: "settings", label: "Settings", path: "/app/security", icon: <SettingOutlined /> },
      ]}
      topLinks={[
        { label: "Policies", to: "/app/document-center" },
        { label: "Org chart", to: "/app/people?tab=org-chart" },
        { label: "Raise a ticket", to: "/app/helpdesk?raise=1" },
      ]}
      userMenu={[
        { key: "profile", icon: <IdcardOutlined />, label: "View My Info", onClick: () => navigate("/app/profile") },
        { key: "security", icon: <SafetyOutlined />, label: "Account & security", onClick: () => navigate("/app/security") },
        ...(phone ? [{ key: "explore", icon: <AppstoreOutlined />, label: "Everything (Explore)", onClick: () => navigate("/app/explore") }] : []),
        ...(isAdminTier ? [{ key: "admin", icon: <SwapOutlined />, label: "Go to HR / Admin portal", onClick: () => navigate("/admin") }] : []),
      ]}
      tabBar={<MobileTabBar />}
      notices={phone ? <InstallAppBanner /> : undefined}
      titleFor={(p) => EXTRA_TITLES[p] ?? (p.startsWith("/app/helpdesk/") ? "Helpdesk ticket" : undefined)}
    />
  );
}
