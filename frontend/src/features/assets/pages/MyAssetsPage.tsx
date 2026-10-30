import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "antd";
import { CheckOutlined } from "@ant-design/icons";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate } from "../../../lib/dates";
import { fs, fw, space, v } from "../../../theme/tokens";
import { DataTable, EmptyState, PageHeader, Panel, Stack, StatusChip, toast } from "../../../ui";
import * as assetsApi from "../api";
import type { MyAsset } from "../api";
import { useAssetsRealtime } from "../useAssetsRealtime";

const END_LABEL: Record<NonNullable<MyAsset["endReason"]>, string> = { RETURNED: "Returned", REASSIGNED: "Transferred", LOST: "Reported lost" };

// Employee portal → My Assets (Peeps module 1). What the company has issued to me, and acknowledging that I received it. Only my own rows ever reach
// this page (GET /api/assets/mine); nobody else's assets, and no money.
export function MyAssetsPage() {
  const queryClient = useQueryClient();
  useAssetsRealtime();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["assets", "mine"], queryFn: assetsApi.listMine });
  const ack = useMutation({
    mutationFn: assetsApi.acknowledge,
    onSuccess: (next) => {
      queryClient.setQueryData(["assets", "mine"], next);
      toast.success("Thanks — receipt acknowledged.");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't record your acknowledgement.")),
  });

  const ackCell = (a: MyAsset) =>
    a.acknowledgedAt ? (
      <StatusChip tone="success">Acknowledged {formatDate(a.acknowledgedAt)}</StatusChip>
    ) : (
      <Button type="primary" size="middle" icon={<CheckOutlined />} loading={ack.isPending && ack.variables === a.assignmentId} onClick={() => ack.mutate(a.assignmentId)} aria-label={`Acknowledge receipt of ${a.name}`}>
        Acknowledge receipt
      </Button>
    );
  const nameCell = (a: MyAsset) => (
    <div>
      <div style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{a.name}</div>
      <div style={{ color: v.textSecondary, fontSize: fs.sm }}>
        {a.assetId}
        {a.serialNumber ? ` · ${a.serialNumber}` : ""}
      </div>
    </div>
  );
  const pending = data?.current.filter((a) => !a.acknowledgedAt).length ?? 0;

  return (
    <>
      <PageHeader title="My Assets" subtitle="Equipment the company has issued to you" />
      <Stack>
        {pending > 0 && (
          <div role="status" style={{ color: v.textSecondary, fontSize: fs.sm, marginBottom: space[1] }}>
            {pending === 1 ? "One asset is waiting for you to acknowledge receipt." : `${pending} assets are waiting for you to acknowledge receipt.`}
          </div>
        )}
        <Panel title="With you now">
          <DataTable<MyAsset>
            rowKey="assignmentId"
            loading={isLoading}
            error={error}
            onRetry={() => void refetch()}
            dataSource={data?.current ?? []}
            pagination={false}
            empty={<EmptyState illustration="inbox" title="No assets with you" description="When HR issues you a laptop, phone or anything else, it appears here for you to acknowledge." compact />}
            columns={[
              { title: "Asset", key: "name", render: (_: unknown, a) => nameCell(a) },
              { title: "Category", dataIndex: "category" },
              { title: "Issued", dataIndex: "issuedAt", render: (d: string) => formatDate(d) },
              { title: "Condition at issue", dataIndex: "issueCondition" },
              { title: "Receipt", key: "ack", render: (_: unknown, a) => ackCell(a) },
            ]}
            mobile={{
              title: (a) => a.name,
              subtitle: (a) => `${a.assetId} · ${a.category}`,
              fields: [
                { label: "Issued", render: (a) => formatDate(a.issuedAt) },
                { label: "Condition at issue", render: (a) => a.issueCondition },
              ],
              actions: ackCell,
            }}
          />
        </Panel>
        <Panel title="History" subtitle="Assets you held before">
          <DataTable<MyAsset>
            rowKey="assignmentId"
            loading={isLoading}
            error={error}
            onRetry={() => void refetch()}
            dataSource={data?.past ?? []}
            pagination={false}
            empty={<EmptyState title="No earlier assets" description={null} compact illustration={false} />}
            columns={[
              { title: "Asset", key: "name", render: (_: unknown, a) => nameCell(a) },
              { title: "Category", dataIndex: "category" },
              { title: "Issued", dataIndex: "issuedAt", render: (d: string) => formatDate(d) },
              { title: "Ended", dataIndex: "endedAt", render: (d: string | null) => (d ? formatDate(d) : "—") },
              { title: "How it ended", dataIndex: "endReason", render: (r: MyAsset["endReason"]) => (r ? <StatusChip tone={r === "LOST" ? "danger" : "neutral"}>{END_LABEL[r]}</StatusChip> : "—") },
            ]}
            mobile={{
              title: (a) => a.name,
              subtitle: (a) => `${a.assetId} · ${a.category}`,
              status: (a) => (a.endReason ? <StatusChip tone={a.endReason === "LOST" ? "danger" : "neutral"}>{END_LABEL[a.endReason]}</StatusChip> : undefined),
              fields: [
                { label: "Issued", render: (a) => formatDate(a.issuedAt) },
                { label: "Ended", render: (a) => (a.endedAt ? formatDate(a.endedAt) : "—") },
              ],
            }}
          />
        </Panel>
      </Stack>
    </>
  );
}
