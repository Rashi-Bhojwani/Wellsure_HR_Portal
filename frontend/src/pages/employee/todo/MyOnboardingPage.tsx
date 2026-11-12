import { useQuery } from "@tanstack/react-query";
import * as api from "../../../api/onboarding";
import { StepList } from "../../../components/onboarding/StepList";
import { EmptyState, PageHeader, Panel, QueryState, Stack } from "../../../ui";

// M session block 2, OE-04: my onboarding steps, and the steps that are mine as the manager of a new joiner.
export function MyOnboardingPage() {
  const q = useQuery({ queryKey: ["onboarding", "mine"], queryFn: api.myOnboarding });
  const nothing = q.data && q.data.own.length === 0 && q.data.team.length === 0;
  return (
    <>
      <PageHeader title="Onboarding" subtitle="Your first steps, and the steps you own for a new joiner in your team." />
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} isEmpty={!!nothing} empty={<EmptyState title="No onboarding steps" description="When HR starts onboarding for you or for a new joiner you manage, the steps appear here." />}>
        <Stack>
          {!!q.data?.own.length && (
            <Panel title="My steps" subtitle="Tick the ones that are yours when done. HR and your manager tick theirs.">
              <StepList tasks={q.data.own} canTick={(t) => t.owner === "EMPLOYEE"} queryKey={["onboarding"]} />
            </Panel>
          )}
          {q.data?.team.map((m) => (
            <Panel key={m.employeeId} title={m.fullName} subtitle="Steps you own as their manager">
              <StepList tasks={m.tasks} canTick={() => true} queryKey={["onboarding"]} />
            </Panel>
          ))}
        </Stack>
      </QueryState>
    </>
  );
}
