import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "antd";
import { HomeOutlined } from "@ant-design/icons";
import { PageHeader } from "../../ui/PageHeader";
import { Panel } from "../../ui/Panel";
import { EmptyState } from "../../ui/EmptyState";
import { StatusChip } from "../../ui/StatusChip";

interface PlaceholderPageProps {
  title: string;
  phase?: string;
  description?: string;
}

// Generic stand-in for every menu item that isn't built yet. Driven by the menu configs (routes/employeeMenu.config.tsx, routes/adminMenu.config.tsx) so adding or
// renaming a menu item never requires a new page file. Says plainly what is coming and when, and offers the way back home.
export function PlaceholderPage({ title, phase, description }: PlaceholderPageProps) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const home = pathname.startsWith("/admin") ? "/admin" : "/app/home";
  return (
    <>
      <PageHeader title={title} subtitle={phase ? <StatusChip tone="info">Planned · {phase}</StatusChip> : undefined} />
      <Panel>
        <EmptyState
          illustration="calendar"
          title={phase ? `Coming in ${phase}` : "Coming in a later phase"}
          description={description ?? "This part of the portal isn't built yet. Everything else in the menu works today."}
          action={
            <Button icon={<HomeOutlined />} onClick={() => navigate(home)}>
              Back to home
            </Button>
          }
        />
      </Panel>
    </>
  );
}
