import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Space, Typography, message } from "antd";
import { UserSwitchOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import * as delegationsApi from "../../../api/delegations";
import type { DelegationRow } from "../../../api/delegations";
import { DelegationsTable, NewDelegationModal, RevokeDelegationModal, type NewDelegationValues } from "../../../components/delegations/Delegations";
import { apiErrorMessage } from "../../../lib/apiError";
import { refreshAfterDelegationChange } from "../../../lib/delegationRefresh";

const { Title, Text } = Typography;

// Employee portal → Workflow Delegates (Phase 5 commit E3). A manager hands
// their leave approvals to someone who can already approve leave, for a date
// range; anyone sees whose approvals they're covering.
export function WorkflowDelegatesPage() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<DelegationRow | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["delegations", "mine"], queryFn: delegationsApi.mine });

  const refresh = () => refreshAfterDelegationChange(queryClient);
  const create = useMutation({
    mutationFn: (v: NewDelegationValues) => delegationsApi.createMine(v),
    onSuccess: (d) => {
      void message.success(`${d.delegate.name} covers your approvals ${d.startDate === d.endDate ? `on ${dayjs(d.startDate).format("DD MMM")}` : `from ${dayjs(d.startDate).format("DD MMM")} to ${dayjs(d.endDate).format("DD MMM")}`}.`);
      setCreating(false);
      refresh();
    },
    onError: (e) => void message.error(apiErrorMessage(e, "Couldn't set up the delegation.")),
  });
  const revoke = useMutation({
    mutationFn: (reason: string) => delegationsApi.revokeMine(revoking!.id, reason),
    onSuccess: () => {
      void message.success("Delegation revoked.");
      setRevoking(null);
      refresh();
    },
    onError: (e) => void message.error(apiErrorMessage(e, "Couldn't revoke it.")),
  });

  const covering = data?.covering ?? [];
  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <div>
        <Title level={3} style={{ margin: 0 }}>
          Workflow Delegates
        </Title>
        <Text type="secondary">Away for a while? Let someone who can already approve leave cover your team's requests. You keep your own access too.</Text>
      </div>

      {covering.length > 0 && (
        <Card title="You're covering">
          <Space orientation="vertical" style={{ width: "100%" }}>
            {covering.some((c) => c.status === "ACTIVE") && (
              <Alert
                type="info"
                showIcon
                title={
                  <>
                    Their team's pending leave is in your <Link to="/app/todo/review">Review</Link> queue, tagged “On behalf of”.
                  </>
                }
              />
            )}
            <DelegationsTable rows={covering} showDelegator showDelegate={false} emptyText="" />
          </Space>
        </Card>
      )}

      {data && !data.canDelegate && <Alert type="info" showIcon title={data.notAllowedReason ?? "Only managers delegate their approvals."} />}

      {(data?.canDelegate || isLoading) && (
        <Card
          title="My delegations"
          extra={
            <Button type="primary" icon={<UserSwitchOutlined />} onClick={() => setCreating(true)} disabled={!data?.canDelegate}>
              Delegate my approvals
            </Button>
          }
        >
          <DelegationsTable rows={data?.given ?? []} loading={isLoading} onRevoke={setRevoking} emptyText="You haven't delegated your approvals." />
        </Card>
      )}

      <NewDelegationModal open={creating} onClose={() => setCreating(false)} onSubmit={(v) => create.mutate(v)} loading={create.isPending} loadDelegates={() => delegationsApi.myDelegateOptions()} />
      <RevokeDelegationModal row={revoking} onClose={() => setRevoking(null)} onRevoke={(r) => revoke.mutate(r)} loading={revoke.isPending} />
    </Space>
  );
}
