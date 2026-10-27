import { lazy, Suspense, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { CustomerServiceOutlined, SafetyOutlined, SettingOutlined, SwapOutlined } from "@ant-design/icons";
import { AdminFiltersProvider } from "../context/AdminFiltersContext";
import { Skel } from "../ui/Skeletons";
import { control, radius, space } from "../theme/tokens";
import { SecurityEventsBanner } from "../components/access/SecurityEventsBanner";
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

// Payroll month + employee filter (top bar, desktop): lazy, with control-shaped placeholders so the bar never jumps.
const AdminContextControls = lazy(() => import("./shell/AdminContextControls").then((m) => ({ default: m.AdminContextControls })));

function AdminContextControlsSlot() {
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
  const nav = useMemo(() => adminNav(), []);
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
      notices={<SecurityEventsBanner />}
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
