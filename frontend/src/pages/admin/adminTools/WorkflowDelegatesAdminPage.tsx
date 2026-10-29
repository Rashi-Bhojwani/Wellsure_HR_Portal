import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Segmented } from "antd";
import { UserSwitchOutlined } from "@ant-design/icons";
import * as delegationsApi from "../../../api/delegations";
import type { DelegationRow, DelegationStatus } from "../../../api/delegations";
import { DelegationsTable, NewDelegationModal, RevokeDelegationModal, type NewDelegationValues } from "../../../components/delegations/Delegations";
import { useAuth } from "../../../hooks/useAuth";
import { apiErrorMessage } from "../../../lib/apiError";
import { refreshAfterDelegationChange } from "../../../lib/delegationRefresh";
import { space } from "../../../theme/tokens";
import { EmptyState, PageHeader, Panel, QueryState, toast, useIsPhone } from "../../../ui";

type Filter = "ALL" | DelegationStatus;

// Admin Tools → Workflow Delegates (Phase 5 commit E3): every manager's
// approval delegations. HR (delegation.manage) can set one up for a manager
// who couldn't, and revoke any — never for a Super Admin or HR Admin, who
// have nothing to delegate (docs/plans/PHASE_5.md §E3).
export function WorkflowDelegatesAdminPage() {
  const { hasPermission } = useAuth();
  const phone = useIsPhone();
  const canManage = hasPermission("delegation.manage");
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("ALL");
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<DelegationRow | null>(null);
  const { data: rows = [], isLoading, error, refetch } = useQuery({ queryKey: ["delegations", "all"], queryFn: () => delegationsApi.listAll(), enabled: canManage });
  const { data: managers = [] } = useQuery({ queryKey: ["delegations", "managers"], queryFn: delegationsApi.managerOptions, enabled: canManage && creating });

  const refresh = () => refreshAfterDelegationChange(queryClient);
  const create = useMutation({
    mutationFn: (val: NewDelegationValues) => delegationsApi.create({ ...val, delegatorUserId: val.delegatorUserId! }),
    onSuccess: (d) => {
      toast.success(`${d.delegate.name} covers ${d.delegator.name}'s approvals. Both have been told.`);
      setCreating(false);
      refresh();
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Couldn't set up the delegation.")),
  });
  const revoke = useMutation({
    mutationFn: (reason: string) => delegationsApi.revoke(revoking!.id, reason),
    onSuccess: () => {
      toast.success("Delegation revoked.");
      setRevoking(null);
      refresh();
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Couldn't revoke it.")),
  });

  if (!canManage) return <EmptyState kind="forbidden" title="You can't manage workflow delegations" />;

  const count = (s: DelegationStatus) => rows.filter((r) => r.status === s).length;
  const shown = filter === "ALL" ? rows : rows.filter((r) => r.status === filter);
  return (
    <>
      <PageHeader
        title="Workflow Delegates"
        subtitle="Managers' leave approvals covered by someone else for a date range. A delegate must already be able to approve leave; nothing they decide is ever “unowned” — the audit log records who acted on whose behalf."
        actions={
          <Button type="primary" icon={<UserSwitchOutlined />} onClick={() => setCreating(true)} block={phone}>
            Set up a delegation
          </Button>
        }
      />
      <Panel>
        <div style={{ overflowX: "auto", marginBottom: space[4] }}>
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: "ALL", label: `All (${rows.length})` },
              { value: "ACTIVE", label: `Active (${count("ACTIVE")})` },
              { value: "SCHEDULED", label: `Scheduled (${count("SCHEDULED")})` },
              { value: "ENDED", label: `Ended (${count("ENDED")})` },
              { value: "REVOKED", label: `Revoked (${count("REVOKED")})` },
            ]}
          />
        </div>
        <QueryState isLoading={false} error={rows.length === 0 ? error : undefined} onRetry={() => void refetch()}>
          <DelegationsTable rows={shown} loading={isLoading} showDelegator onRevoke={setRevoking} emptyText="No delegations." />
        </QueryState>
      </Panel>
      <NewDelegationModal
        open={creating}
        onClose={() => setCreating(false)}
        onSubmit={(val) => create.mutate(val)}
        loading={create.isPending}
        managers={managers}
        loadDelegates={(id) => delegationsApi.delegateOptionsFor(id!)}
      />
      <RevokeDelegationModal row={revoking} onClose={() => setRevoking(null)} onRevoke={(r) => revoke.mutate(r)} loading={revoke.isPending} />
    </>
  );
}
