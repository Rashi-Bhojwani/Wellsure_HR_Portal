import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Switch } from "antd";
import * as acksApi from "../../../api/documentAcks";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate } from "../../../lib/dates";
import { fs, space, v } from "../../../theme/tokens";
import { DataTable, EmptyState, SideDrawer, StatusChip, toast } from "../../../ui";

// M session block 2, ER-18: ask the document's audience to acknowledge it, and see who has (within your data scope).
export function AckDrawer({ doc, onClose }: { doc: { id: string; title: string } | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["document-acks", "status", doc?.id], queryFn: () => acksApi.ackStatus(doc!.id), enabled: !!doc });
  const toggle = useMutation({
    mutationFn: (required: boolean) => acksApi.setRequired(doc!.id, required),
    onSuccess: (_, required) => { toast.success(required ? "Asked. Everyone it is published to is told." : "No longer asked."); void queryClient.invalidateQueries({ queryKey: ["document-acks"] }); },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not change it.")),
  });
  return (
    <SideDrawer open={!!doc} title="Acknowledgement" subtitle={doc?.title} onClose={onClose} footer={null} size="wide">
      <label style={{ display: "flex", alignItems: "center", gap: space[2], marginBottom: space[3] }}>
        <Switch checked={q.data?.required ?? false} loading={toggle.isPending || q.isLoading} onChange={(on) => toggle.mutate(on)} aria-label="Ask people to acknowledge this document" />
        <span>Ask everyone it is published to to read and acknowledge it</span>
      </label>
      {q.data && <p style={{ color: v.textSecondary, fontSize: fs.sm }}>{q.data.acknowledged} acknowledged, {q.data.waiting} not yet.</p>}
      <DataTable
        rowKey="employeeId"
        loading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        dataSource={q.data?.people ?? []}
        pagination={(q.data?.people.length ?? 0) > 20 ? { pageSize: 20 } : false}
        empty={<EmptyState compact title="Nobody in the audience" description={null} />}
        columns={[
          { title: "Employee", key: "e", render: (_, r) => `${r.fullName} (${r.employeeCode})` },
          { title: "Acknowledged", key: "a", render: (_, r) => (r.acknowledgedAt ? <StatusChip tone="success">{formatDate(r.acknowledgedAt)}</StatusChip> : <StatusChip tone="neutral">Not yet</StatusChip>) },
        ]}
        mobile={{ title: (r) => r.fullName, subtitle: (r) => r.employeeCode, status: (r) => (r.acknowledgedAt ? <StatusChip tone="success">{formatDate(r.acknowledgedAt)}</StatusChip> : <StatusChip tone="neutral">Not yet</StatusChip>) }}
      />
    </SideDrawer>
  );
}
