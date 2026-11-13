import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Segmented } from "antd";
import * as api from "../../../api/wfhRequests";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate } from "../../../lib/dates";
import { space } from "../../../theme/tokens";
import { ConfirmModal, DataTable, EmptyState, PageHeader, Panel, StatusChip, toast, useIsPhone } from "../../../ui";

// M session block 2, AT-36: directors decide work-from-home requests (never their own). Approving makes the days remote days.
export function WfhRequestsPage() {
  const phone = useIsPhone();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"PENDING" | "APPROVED" | "REJECTED">("PENDING");
  const [rejecting, setRejecting] = useState<api.WfhRow | null>(null);
  const [note, setNote] = useState("");
  const q = useQuery({ queryKey: ["wfh", "list", status], queryFn: () => api.listWfh(status) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["wfh"] });
  const approve = useMutation({ mutationFn: api.approveWfh, onSuccess: () => { toast.success("Approved. Those days are remote days."); refresh(); }, onError: (e) => toast.error(apiErrorMessage(e, "Could not approve it.")) });
  const reject = useMutation({ mutationFn: () => api.rejectWfh(rejecting!.id, note.trim()), onSuccess: () => { toast.success("Not approved. The employee is told why."); setRejecting(null); setNote(""); refresh(); }, onError: (e) => toast.error(apiErrorMessage(e, "Could not record it.")) });
  const actions = (r: api.WfhRow) => r.status === "PENDING" && (
    <div style={{ display: "flex", gap: space[2], flexWrap: "wrap", justifyContent: phone ? "stretch" : "flex-end" }}>
      <Button danger onClick={() => setRejecting(r)} block={phone} aria-label={`Do not approve ${r.fullName}'s request`}>Reject</Button>
      <Button type="primary" loading={approve.isPending && approve.variables === r.id} onClick={() => approve.mutate(r.id)} block={phone} aria-label={`Approve ${r.fullName}'s request`}>Approve</Button>
    </div>
  );
  return (
    <>
      <PageHeader title="Work-from-home requests" subtitle="Approved days become remote days: the person checks in and out in the app, as with any remote day." actions={<Segmented value={status} onChange={(x) => setStatus(x as typeof status)} options={[{ value: "PENDING", label: "Waiting" }, { value: "APPROVED", label: "Approved" }, { value: "REJECTED", label: "Not approved" }]} aria-label="Which requests" />} />
      <Panel>
        <DataTable<api.WfhRow>
          rowKey="id"
          loading={q.isLoading}
          error={q.error}
          onRetry={() => void q.refetch()}
          dataSource={q.data ?? []}
          pagination={(q.data?.length ?? 0) > 20 ? { pageSize: 20 } : false}
          empty={<EmptyState compact title="No requests here" description={null} />}
          columns={[
            { title: "Employee", key: "e", render: (_, r) => `${r.fullName} (${r.employeeCode})` },
            { title: "Days", key: "d", render: (_, r) => `${formatDate(r.fromDate)} – ${formatDate(r.toDate)}` },
            { title: "Reason", dataIndex: "reason" },
            { title: "Status", key: "s", render: (_, r) => <StatusChip tone={api.WFH_TONE[r.status]}>{api.WFH_LABEL[r.status]}</StatusChip> },
            { title: "", key: "a", align: "right", render: (_, r) => actions(r) },
          ]}
          mobile={{ title: (r) => r.fullName, subtitle: (r) => `${formatDate(r.fromDate)} – ${formatDate(r.toDate)}`, actions: (r) => actions(r) || null }}
        />
      </Panel>
      <ConfirmModal open={!!rejecting} danger title="Do not approve this request" confirmLabel="Reject" description={rejecting ? `${rejecting.fullName}: ${rejecting.reason}` : undefined} loading={reject.isPending} confirmDisabled={note.trim().length < 3} onCancel={() => setRejecting(null)} onConfirm={() => reject.mutate()}>
        <Input.TextArea aria-label="Reason (the employee sees it)" placeholder="Reason (the employee sees it)" rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </ConfirmModal>
    </>
  );
}
