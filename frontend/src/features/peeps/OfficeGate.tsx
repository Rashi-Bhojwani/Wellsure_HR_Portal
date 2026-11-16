import type { ReactNode } from "react";
import type { OfficeCapabilityId } from "@shared/constants/peeps";
import { EmptyState, PageHeader, PageSkeleton, Panel, isForbidden } from "../../ui";
import { usePeepsMe } from "./usePeepsMe";

/**
 * The front door of every Wellsure Office screen (D-30): only the directors, and members (with the capability, when one is named), see the page at all;
 * anyone else who opens the address gets "no access" and nothing else. The API refuses them regardless; this keeps the page from showing its frame.
 */
export function OfficeGate({ title, need, children }: { title: string; need: "director" | "member" | OfficeCapabilityId; children: ReactNode }) {
  const { data, isLoading, error, refetch } = usePeepsMe();
  if (isLoading) return <PageSkeleton />;
  // A failed check is not a refusal: say it could not load (with Try again) instead of "no access" (found by the Stage 4 browser walk).
  if (error && !isForbidden(error)) {
    return (
      <>
        <PageHeader title={title} />
        <Panel>
          <EmptyState kind="error" onRetry={() => void refetch()} />
        </Panel>
      </>
    );
  }
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
