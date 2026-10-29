import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "antd";
import { UserSwitchOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import * as delegationsApi from "../../../api/delegations";
import type { DelegationRow } from "../../../api/delegations";
import { DelegationsTable, NewDelegationModal, RevokeDelegationModal, type NewDelegationValues } from "../../../components/delegations/Delegations";
import { apiErrorMessage } from "../../../lib/apiError";
import { refreshAfterDelegationChange } from "../../../lib/delegationRefresh";
import { space } from "../../../theme/tokens";
import { ApprovalBanner, PageHeader, Panel, QueryState, SkeletonTable, Stack, toast, useIsPhone } from "../../../ui";

// Employee portal → Workflow Delegates (Phase 5 commit E3). A manager hands
// their leave approvals to someone who can already approve leave, for a date
// range; anyone sees whose approvals they're covering.
export function WorkflowDelegatesPage() {
  const queryClient = useQueryClient();
  const phone = useIsPhone();
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<DelegationRow | null>(null);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["delegations", "mine"], queryFn: delegationsApi.mine });

  const refresh = () => refreshAfterDelegationChange(queryClient);
  const create = useMutation({
    mutationFn: (val: NewDelegationValues) => delegationsApi.createMine(val),
    onSuccess: (d) => {
      toast.success(`${d.delegate.name} covers your approvals ${d.startDate === d.endDate ? `on ${dayjs(d.startDate).format("DD MMM")}` : `from ${dayjs(d.startDate).format("DD MMM")} to ${dayjs(d.endDate).format("DD MMM")}`}.`);
      setCreating(false);
      refresh();
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Couldn't set up the delegation.")),
  });
  const revoke = useMutation({
    mutationFn: (reason: string) => delegationsApi.revokeMine(revoking!.id, reason),
    onSuccess: () => {
      toast.success("Delegation revoked.");
      setRevoking(null);
      refresh();
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Couldn't revoke it.")),
  });

  const covering = data?.covering ?? [];
  return (
    <>
      <PageHeader
        title="Workflow Delegates"
        subtitle="Away for a while? Let someone who can already approve leave cover your team's requests. You keep your own access too."
        actions={
          data?.canDelegate && (
            <Button type="primary" icon={<UserSwitchOutlined />} onClick={() => setCreating(true)} block={phone}>
              Delegate my approvals
            </Button>
          )
        }
      />
      <QueryState
        isLoading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        skeleton={
          <Panel>
            <SkeletonTable rows={3} columns={5} />
          </Panel>
        }
      >
        <Stack>
          {covering.length > 0 && (
            <Panel title="You're covering" subtitle="Managers whose leave approvals you are handling">
              <Stack gap={space[4]}>
                {covering.some((c) => c.status === "ACTIVE") && (
                  <ApprovalBanner
                    tone="info"
                    title={
                      <>
                        Their team's pending leave is in your <Link to="/app/todo/review">Review</Link> queue, tagged “On behalf of”.
                      </>
                    }
                  />
                )}
                <DelegationsTable rows={covering} showDelegator showDelegate={false} emptyText="" />
              </Stack>
            </Panel>
          )}

          {data && !data.canDelegate && <ApprovalBanner tone="info" title={data.notAllowedReason ?? "Only managers delegate their approvals."} />}

          {data?.canDelegate && (
            <Panel title="My delegations" subtitle="People covering your team's leave approvals">
              <DelegationsTable rows={data.given} onRevoke={setRevoking} emptyText="You haven't delegated your approvals." />
            </Panel>
          )}
        </Stack>
      </QueryState>

      <NewDelegationModal open={creating} onClose={() => setCreating(false)} onSubmit={(val) => create.mutate(val)} loading={create.isPending} loadDelegates={() => delegationsApi.myDelegateOptions()} />
      <RevokeDelegationModal row={revoking} onClose={() => setRevoking(null)} onRevoke={(r) => revoke.mutate(r)} loading={revoke.isPending} />
    </>
  );
}
