import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Space, Table, Tag, Typography } from "antd";
import { apiErrorMessage } from "../../../lib/apiError";
import * as employeeApi from "../../../api/employee";

const { Text } = Typography;

const STATUS_TAG: Record<employeeApi.InvitationDelivery["status"], { color: string; label: string }> = {
  NOT_SENT: { color: "default", label: "Not invited yet" },
  SENT: { color: "green", label: "Email sent" },
  FILE_ONLY: { color: "orange", label: "Written to a file only — nothing sent" },
  FAILED: { color: "red", label: "Sending failed" },
};

/**
 * Imported employees are never invited automatically (spec §10). This is where HR sends the invitations, in batches of at most 100, and sees each person's own
 * result: a failure is shown against the name, not folded into a success count.
 */
export function InvitationsTab() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [last, setLast] = useState<employeeApi.InvitationBatchResult | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["employees", "invitations", page], queryFn: () => employeeApi.listPendingInvitations(page, 50) });
  const send = useMutation({
    mutationFn: (ids: string[]) => employeeApi.sendInvitations(ids),
    onSuccess: (result) => {
      setLast(result);
      setSelected([]);
      void queryClient.invalidateQueries({ queryKey: ["employees", "invitations"] });
    },
  });
  const items = data?.items ?? [];
  const sendable = (ids: string[]) => ids.slice(0, 100);

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Text type="secondary">
        People who have not yet set a password. Importing employees never emails them: choose who to invite here. Up to 100 at a time.
      </Text>
      {send.isError && <Alert type="error" showIcon title={apiErrorMessage(send.error, "Could not send the invitations.")} />}
      {last && (
        <Alert
          type={last.failed > 0 ? "error" : last.fileOnly > 0 ? "warning" : "success"}
          showIcon
          data-testid="invitation-batch-result"
          title={`${last.sent} sent, ${last.failed} failed${last.fileOnly > 0 ? `, ${last.fileOnly} written to a file only (nothing was emailed)` : ""}${last.results.some((r) => r.skipped) ? `, ${last.results.filter((r) => r.skipped).length} skipped` : ""}`}
          description={last.failed > 0 ? "The people marked 'Sending failed' below have NOT been invited. Fix the cause shown against their name and try again." : undefined}
          closable
          onClose={() => setLast(null)}
        />
      )}
      <Space wrap>
        <Button type="primary" disabled={selected.length === 0} loading={send.isPending} onClick={() => send.mutate(sendable(selected))} data-testid="send-invitations">
          Send invitation{selected.length === 1 ? "" : "s"} ({Math.min(selected.length, 100)})
        </Button>
        <Button disabled={items.length === 0} onClick={() => setSelected(sendable(items.filter((i) => i.delivery.status !== "SENT").map((i) => i.employeeId)))}>
          Select everyone not yet sent
        </Button>
      </Space>
      <Table<employeeApi.PendingInvitation>
        rowKey="employeeId"
        size="small"
        loading={isLoading}
        dataSource={items}
        scroll={{ x: "max-content" }}
        rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys.map(String)) }}
        pagination={{ current: page, pageSize: 50, total: data?.total ?? 0, onChange: setPage, showSizeChanger: false }}
        columns={[
          { title: "Code", dataIndex: "employeeCode" },
          { title: "Name", dataIndex: "fullName" },
          { title: "Email", dataIndex: "email" },
          {
            title: "Invitation",
            key: "status",
            render: (_: unknown, r) => {
              const tag = STATUS_TAG[r.delivery.status];
              const result = last?.results.find((x) => x.employeeId === r.employeeId);
              return (
                <Space orientation="vertical" size={0}>
                  <Tag color={tag.color}>{tag.label}</Tag>
                  {r.delivery.error && <Text type="danger">{r.delivery.error}</Text>}
                  {result?.skipped && <Text type="secondary">{result.skipped}</Text>}
                </Space>
              );
            },
          },
        ]}
      />
    </Space>
  );
}
