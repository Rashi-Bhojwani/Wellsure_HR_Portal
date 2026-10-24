import { PageHeader } from "../../ui/PageHeader";
import { Panel } from "../../ui/Panel";
import { EmptyState } from "../../ui/EmptyState";

interface PlaceholderPageProps {
  title: string;
  phase?: string;
  description?: string;
}

// Generic stand-in for every menu item that isn't built yet. Driven by the menu configs (routes/employeeMenu.config.tsx, routes/adminMenu.config.tsx) so adding or
// renaming a menu item never requires a new page file.
export function PlaceholderPage({ title, phase, description }: PlaceholderPageProps) {
  return (
    <>
      <PageHeader title={title} />
      <Panel>
        <EmptyState
          illustration="calendar"
          title={phase ? `Coming in ${phase}` : "Coming in a later phase"}
          description={description ?? "This part of the portal isn't built yet. Everything else in the menu works today."}
        />
      </Panel>
    </>
  );
}
