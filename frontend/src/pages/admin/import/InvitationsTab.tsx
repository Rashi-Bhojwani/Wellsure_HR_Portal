import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox } from "antd";
import { MailOutlined } from "@ant-design/icons";
import { apiErrorMessage } from "../../../lib/apiError";
import * as employeeApi from "../../../api/employee";
import { fs, space, v } from "../../../theme/tokens";
import { ApprovalBanner, DataTable, EmptyState, InitialsAvatar, StatusChip, useIsPhone, type ChipTone } from "../../../ui";

const STATUS_TAG: Record<employeeApi.InvitationDelivery["status"], { tone: ChipTone; label: string }> = {
  NOT_SENT: { tone: "neutral", label: "Not invited yet" },
  SENT: { tone: "success", label: "Email sent" },
  FILE_ONLY: { tone: "warning", label: "Written to a file only — nothing sent" },
  FAILED: { tone: "danger", label: "Sending failed" },
};

/**
 * Imported employees are never invited automatically (spec §10). This is where HR sends the invitations, in batches of at most 100, and sees each person's own
 * result: a failure is shown against the name, not folded into a success count.
 */
export function InvitationsTab() {
  const queryClient = useQueryClient();
  const phone = useIsPhone();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [last, setLast] = useState<employeeApi.InvitationBatchResult | null>(null);
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["employees", "invitations", page],
    queryFn: () => employeeApi.listPendingInvitations(page, 50),
    placeholderData: keepPreviousData,
  });
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
  const toggle = (id: string, on: boolean) => setSelected((cur) => (on ? [...cur, id] : cur.filter((x) => x !== id)));

  const invitationCell = (r: employeeApi.PendingInvitation) => {
    const tag = STATUS_TAG[r.delivery.status];
    const result = last?.results.find((x) => x.employeeId === r.employeeId);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-start" }}>
        <StatusChip tone={tag.tone}>{tag.label}</StatusChip>
        {r.delivery.error && <span style={{ color: v.danger, fontSize: fs.sm }}>{r.delivery.error}</span>}
        {result?.skipped && <span style={{ color: v.textSecondary, fontSize: fs.sm }}>{result.skipped}</span>}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: phone ? space[4] : space[5], paddingTop: space[2] }}>
      <div style={{ color: v.textSecondary, fontSize: fs.md }}>
        People who have not yet set a password. Importing employees never emails them: choose who to invite here. Up to 100 at a time.
      </div>
      {send.isError && <ApprovalBanner tone="danger" title={apiErrorMessage(send.error, "Could not send the invitations.")} />}
      {last && (
        <div data-testid="invitation-batch-result">
          <ApprovalBanner
            tone={last.failed > 0 ? "danger" : last.fileOnly > 0 ? "warning" : "success"}
            title={`${last.sent} sent, ${last.failed} failed${last.fileOnly > 0 ? `, ${last.fileOnly} written to a file only (nothing was emailed)` : ""}${last.results.some((r) => r.skipped) ? `, ${last.results.filter((r) => r.skipped).length} skipped` : ""}`}
            description={last.failed > 0 ? "The people marked 'Sending failed' below have NOT been invited. Fix the cause shown against their name and try again." : undefined}
            actions={<Button onClick={() => setLast(null)}>Dismiss</Button>}
          />
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: space[2], flexDirection: phone ? "column-reverse" : "row" }}>
        <Button disabled={items.length === 0} block={phone} onClick={() => setSelected(sendable(items.filter((i) => i.delivery.status !== "SENT").map((i) => i.employeeId)))}>
          Select everyone not yet sent
        </Button>
        <Button type="primary" icon={<MailOutlined />} block={phone} disabled={selected.length === 0} loading={send.isPending} onClick={() => send.mutate(sendable(selected))} data-testid="send-invitations">
          Send invitation{selected.length === 1 ? "" : "s"} ({Math.min(selected.length, 100)})
        </Button>
      </div>
      <DataTable<employeeApi.PendingInvitation>
        rowKey="employeeId"
        density="compact"
        loading={isLoading || isFetching}
        error={error}
        onRetry={() => void refetch()}
        dataSource={items}
        rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys.map(String)) }}
        pagination={{ current: page, pageSize: 50, total: data?.total ?? 0, onChange: setPage, showSizeChanger: false }}
        empty={<EmptyState compact illustration="inbox" title="Everyone has been invited" description="People who still need to set a password will show up here." />}
        mobile={{
          avatar: (r) => <InitialsAvatar name={r.fullName} size={40} />,
          title: (r) => r.fullName,
          subtitle: (r) => `${r.employeeCode} · ${r.email}`,
          fields: [{ label: "Invitation", render: invitationCell }],
          actions: (r) => (
            <Checkbox checked={selected.includes(r.employeeId)} onChange={(e) => toggle(r.employeeId, e.target.checked)} style={{ minHeight: 44, alignItems: "center" }}>
              Select {r.fullName}
            </Checkbox>
          ),
        }}
        columns={[
          { title: "Code", dataIndex: "employeeCode" },
          { title: "Name", dataIndex: "fullName" },
          { title: "Email", dataIndex: "email" },
          { title: "Invitation", key: "status", render: (_: unknown, r) => invitationCell(r) },
        ]}
      />
    </div>
  );
}
