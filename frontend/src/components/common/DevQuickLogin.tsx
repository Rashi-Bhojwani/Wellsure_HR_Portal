import { useNavigate } from "react-router-dom";
import { Button, Dropdown, Grid, Space, message, type MenuProps } from "antd";
import { BulbOutlined, LoginOutlined, LogoutOutlined } from "@ant-design/icons";
import { useThemeMode } from "../../theme/ThemeProvider";
import { useAuth } from "../../hooks/useAuth";
import { isLoginChallenge } from "../../api/auth";
import { quickLoginFailure } from "../../lib/loginErrors";
import { MOBILE_TAB_BAR_HEIGHT } from "../../lib/mobileNav";
import { fs, shadow, v } from "../../theme/tokens";

// Mirrors prisma/seed.ts's DEV_PASSWORD — dev/demo-only, printed to the
// console by the seed script itself, never a real secret.
const DEV_PASSWORD = "Wellsure@123";

const ADMIN_TIER_ROLES = ["HR_ADMIN", "HR_EXECUTIVE", "PAYROLL_ADMIN", "SUPER_ADMIN"];

const QUICK_ACCOUNTS = [
  { employeeCode: "1000", label: "1000 · Aditi Sharma (Super Admin)" },
  { employeeCode: "1001", label: "1001 · Rohan Mehta (HR Admin)" },
  { employeeCode: "1002", label: "1002 · Karan Kapoor (Manager)" },
  { employeeCode: "1006", label: "1006 · Arjun Singh (Employee)" },
];

// Dev-only convenience for seeded test accounts (Phase 1 scope: "keep a
// dev-only quick login for seeded test users") — goes through the real
// login flow, it just fills in known demo credentials rather than
// bypassing auth. Rendered only when import.meta.env.DEV.
export function DevQuickLogin() {
  // On phones it sits above the bottom tab bar (Phase 5 commit G), never over it.
  const isPhone = !Grid.useBreakpoint().md;
  const navigate = useNavigate();
  const { mode, toggleMode } = useThemeMode();
  const { login, logout, isAuthenticated } = useAuth();

  async function loginAs(employeeCode: string): Promise<void> {
    try {
      const result = await login(employeeCode, DEV_PASSWORD);
      if (isLoginChallenge(result)) {
        const path = result.status === "requires_totp_setup" ? "/totp-setup" : "/totp-challenge";
        navigate(path, { state: { challengeToken: result.challengeToken } });
        return;
      }
      const isAdminTier = result.user.roleCodes.some((role) => ADMIN_TIER_ROLES.includes(role));
      navigate(isAdminTier ? "/admin" : "/app/home");
    } catch (err) {
      void message.error(quickLoginFailure(employeeCode, err));
    }
  }

  const menuItems: MenuProps["items"] = QUICK_ACCOUNTS.map((account) => ({
    key: account.employeeCode,
    label: account.label,
    onClick: () => void loginAs(account.employeeCode),
  }));

  return (
    <div
      style={{
        position: "fixed",
        bottom: isPhone ? MOBILE_TAB_BAR_HEIGHT + 12 : 16,
        right: isPhone ? 8 : 16,
        zIndex: 1000,
        background: v.bgSurface,
        border: `1px solid ${v.borderDefault}`,
        borderRadius: 12,
        padding: 8,
        boxShadow: shadow.popover,
      }}
    >
      <Space size={8}>
        <span style={{ fontSize: fs.xs, color: v.textSecondary }}>DEV</span>
        <Dropdown menu={{ items: menuItems }} trigger={["click"]}>
          <Button size="small" icon={<LoginOutlined />}>
            Quick login
          </Button>
        </Dropdown>
        {isAuthenticated && (
          <Button size="small" icon={<LogoutOutlined />} onClick={() => void logout().then(() => navigate("/login"))}>
            Logout
          </Button>
        )}
        <Button size="small" icon={<BulbOutlined />} onClick={toggleMode}>
          {mode === "light" ? "Dark" : "Light"}
        </Button>
      </Space>
    </div>
  );
}
