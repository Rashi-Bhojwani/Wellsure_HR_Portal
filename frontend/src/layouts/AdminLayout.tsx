import { lazy, Suspense, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { CustomerServiceOutlined, SafetyOutlined, SettingOutlined, SwapOutlined } from "@ant-design/icons";
import { AdminFiltersProvider } from "../context/AdminFiltersContext";
import { useAuth } from "../hooks/useAuth";
import { Skel } from "../ui/Skeletons";
import { control, radius, space } from "../theme/tokens";
import { useIsPhone } from "../ui/hooks";
import { AppShell } from "./shell/AppShell";
import { AdminPhoneTabBar } from "./shell/AdminPhoneTabBar";
import { adminNav } from "./shell/nav";

const EXTRA_TITLES: [RegExp, string][] = [
  [/^\/admin\/security$/, "Account & security"],
  [/^\/admin\/employee\/profile\//, "Employee profile"],
  [/^\/admin\/employee\/helpdesk\/.+/, "Helpdesk ticket"],
  [/^\/admin\/admin-tools\/templates\/.+/, "Template editor"],
  [/^\/admin\/payroll\/run\/[^/]+\/step\//, "Payroll run step"],
  [/^\/admin\/payroll\/run\/[^/]+$/, "Payroll run"],
];

// Break-glass security notices (Super Admins only, rare): loaded after the shell paints.
const SecurityEventsBanner = lazy(() => import("../components/access/SecurityEventsBanner").then((m) => ({ default: m.SecurityEventsBanner })));

// Payroll month + employee filter (top bar, desktop): lazy, with control-shaped placeholders so the bar never jumps.
const AdminContextControls = lazy(() => import("./shell/AdminContextControls").then((m) => ({ default: m.AdminContextControls })));

function AdminContextControlsSlot() {
  const { user, hasPermission } = useAuth();
  // The payroll month belongs to payroll: people who hold no payroll permission (HR) are not shown it, so a page about attendance never looks like it is about pay.
  const forPayroll = Boolean(user?.roleCodes.includes("SUPER_ADMIN")) || hasPermission("payroll.salary.view") || hasPermission("payroll.run");
  if (!forPayroll) return null;
  return (
    <Suspense
      fallback={
        <div aria-hidden style={{ display: "flex", gap: space[2] }}>
          <Skel w={168} h={control.md} r={radius.sm} />
          <Skel w={168} h={control.md} r={radius.sm} />
        </div>
      }
    >
      <AdminContextControls />
    </Suspense>
  );
}

function AdminLayoutInner() {
  const navigate = useNavigate();
  const phone = useIsPhone();
  const { user, hasPermission } = useAuth();
  const isDirector = Boolean(user?.roleCodes.includes("SUPER_ADMIN"));
  // Follows the person's permissions: when a director switches a duty off for them, /me is refetched (permissions.changed) and the item leaves the menu, the search and the phone menu.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const nav = useMemo(() => adminNav(hasPermission, isDirector), [user?.permissions, isDirector]);
  return (
    <AppShell
      nav={nav}
      homeKey="homepage"
      homePath="/admin"
      pinned={[
        { key: "help", label: "Help Center", path: "/admin/employee/helpdesk", icon: <CustomerServiceOutlined /> },
        { key: "settings", label: "Settings", path: "/admin/security", icon: <SettingOutlined /> },
      ]}
      topExtras={<AdminContextControlsSlot />}
      userMenu={[
        { key: "security", icon: <SafetyOutlined />, label: "Account & security", onClick: () => navigate("/admin/security") },
        { key: "ess", icon: <SwapOutlined />, label: "Go to my employee portal", onClick: () => navigate("/app/home") },
      ]}
      tabBar={<AdminPhoneTabBar />}
      phoneMenu={phone}
      notices={
        <Suspense fallback={null}>
          <SecurityEventsBanner />
        </Suspense>
      }
      titleFor={(p) => EXTRA_TITLES.find(([re]) => re.test(p))?.[1]}
    />
  );
}

export function AdminLayout() {
  return (
    <AdminFiltersProvider>
      <AdminLayoutInner />
    </AdminFiltersProvider>
  );
}
