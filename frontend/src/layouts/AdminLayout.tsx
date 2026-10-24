import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { DatePicker, Select } from "antd";
import { CustomerServiceOutlined, SafetyOutlined, SettingOutlined, SwapOutlined, TeamOutlined } from "@ant-design/icons";
import { AdminFiltersProvider, useAdminFilters } from "../context/AdminFiltersContext";
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

// The admin portal's global context (docs/UI_REFERENCE.md §2.0): payroll month and employee filter, in the top bar on desktop.
function AdminContextControls() {
  const { payrollMonth, setPayrollMonth, employeeFilter, setEmployeeFilter } = useAdminFilters();
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <DatePicker picker="month" aria-label="Payroll month" value={payrollMonth} onChange={(m) => m && setPayrollMonth(m)} allowClear={false} format="[Payroll] MMM YYYY" style={{ width: 168 }} />
      <Select
        aria-label="Employee filter"
        value={employeeFilter}
        onChange={setEmployeeFilter}
        suffixIcon={<TeamOutlined />}
        style={{ width: 168 }}
        options={[
          { value: "all", label: "All employees" },
          { value: "c-10-panchsheel", label: "C-10 Panchsheel" },
          { value: "ajmer", label: "Ajmer" },
          { value: "spn-panchsheel", label: "SPN-Panchsheel" },
          { value: "b-22-panchsheel", label: "B-22 Panchsheel" },
        ]}
      />
    </div>
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
      topExtras={<AdminContextControls />}
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
