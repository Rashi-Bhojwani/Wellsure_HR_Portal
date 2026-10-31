import type { ReactNode } from "react";
import type { OfficeCapabilityId } from "@shared/constants/peeps";
import { EmptyState, PageHeader, PageSkeleton, Panel } from "../../ui";
import { usePeepsMe } from "./usePeepsMe";

/**
 * The front door of every Wellsure Office screen (D-30): only the directors, and members (with the capability, when one is named), see the page at all;
 * anyone else who opens the address gets "no access" and nothing else. The API refuses them regardless; this keeps the page from showing its frame.
 */
export function OfficeGate({ title, need, children }: { title: string; need: "director" | "member" | OfficeCapabilityId; children: ReactNode }) {
  const { data, isLoading } = usePeepsMe();
  if (isLoading) return <PageSkeleton />;
  const allowed = Boolean(data?.isDirector || (need !== "director" && data?.isMember && (need === "member" || data.capabilities.includes(need))));
  if (allowed) return <>{children}</>;
  return (
    <>
      <PageHeader title={title} />
      <Panel>
        <EmptyState kind="forbidden" title="You don't have access" description="Only the directors and the Wellsure Office members they choose can open this." />
      </Panel>
    </>
  );
}
