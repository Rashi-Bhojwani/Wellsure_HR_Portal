import { Alert } from "antd";
import { useAuth } from "../../hooks/useAuth";

// Shown on every screen while the demo company exists (docs/plans/PHASE_6.md §14J), so nothing on it, and no screenshot of it, can be taken for real. It cannot be dismissed.
export function DemoCompanyBanner() {
  const { user } = useAuth();
  if (!user?.demoCompany) return null;
  return (
    <Alert
      type="warning"
      showIcon
      banner
      data-testid="demo-company-banner"
      title="DEMO COMPANY. Fake people, fake salaries, a fictional bank format. Nothing here is real."
      style={{ position: "sticky", top: 0, zIndex: 1000 }}
    />
  );
}
