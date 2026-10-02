import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Flex, Result, Segmented, Space, Typography, message } from "antd";
import { UserSwitchOutlined } from "@ant-design/icons";
import * as delegationsApi from "../../../api/delegations";
import type { DelegationRow, DelegationStatus } from "../../../api/delegations";
import { DelegationsTable, NewDelegationModal, RevokeDelegationModal, type NewDelegationValues } from "../../../components/delegations/Delegations";
import { useAuth } from "../../../hooks/useAuth";
import { apiErrorMessage } from "../../../lib/apiError";
import { refreshAfterDelegationChange } from "../../../lib/delegationRefresh";

const { Title, Text } = Typography;

type Filter = "ALL" | DelegationStatus;

// Admin Tools → Workflow Delegates (Phase 5 commit E3): every manager's
// approval delegations. HR (delegation.manage) can set one up for a manager
// who couldn't, and revoke any — never for a Super Admin or HR Admin, who
// have nothing to delegate (docs/plans/PHASE_5.md §E3).
export function WorkflowDelegatesAdminPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("delegation.manage");
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("ALL");
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<DelegationRow | null>(null);
  const { data: rows = [], isLoading } = useQuery({ queryKey: ["delegations", "all"], queryFn: () => delegationsApi.listAll(), enabled: canManage });
  const { data: managers = [] } = useQuery({ queryKey: ["delegations", "managers"], queryFn: delegationsApi.managerOptions, enabled: canManage && creating });

  const refresh = () => refreshAfterDelegationChange(queryClient);
  const create = useMutation({
    mutationFn: (v: NewDelegationValues) => delegationsApi.create({ ...v, delegatorUserId: v.delegatorUserId! }),
    onSuccess: (d) => {
      void message.success(`${d.delegate.name} covers ${d.delegator.name}'s approvals. Both have been told.`);
      setCreating(false);
      refresh();
    },
    onError: (e) => void message.error(apiErrorMessage(e, "Couldn't set up the delegation.")),
  });
  const revoke = useMutation({
    mutationFn: (reason: string) => delegationsApi.revoke(revoking!.id, reason),
    onSuccess: () => {
      void message.success("Delegation revoked.");
      setRevoking(null);
      refresh();
    },
    onError: (e) => void message.error(apiErrorMessage(e, "Couldn't revoke it.")),
  });

  if (!canManage) return <Result status="403" title="You can't manage workflow delegations" />;

  const count = (s: DelegationStatus) => rows.filter((r) => r.status === s).length;
  const shown = filter === "ALL" ? rows : rows.filter((r) => r.status === filter);
  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Flex justify="space-between" align="start" wrap gap={12}>
        <div>
          <Title level={3} style={{ margin: 0 }}>
            Workflow Delegates
          </Title>
          <Text type="secondary">Managers' leave approvals covered by someone else for a date range. A delegate must already be able to approve leave; nothing they decide is ever “unowned” — the audit log records who acted on whose behalf.</Text>
        </div>
        <Button type="primary" icon={<UserSwitchOutlined />} onClick={() => setCreating(true)}>
          Set up a delegation
        </Button>
      </Flex>
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
      <DelegationsTable rows={shown} loading={isLoading} showDelegator onRevoke={setRevoking} emptyText="No delegations." />
      <NewDelegationModal
        open={creating}
        onClose={() => setCreating(false)}
        onSubmit={(v) => create.mutate(v)}
        loading={create.isPending}
        managers={managers}
        loadDelegates={(id) => delegationsApi.delegateOptionsFor(id!)}
      />
      <RevokeDelegationModal row={revoking} onClose={() => setRevoking(null)} onRevoke={(r) => revoke.mutate(r)} loading={revoke.isPending} />
    </Space>
  );
}
