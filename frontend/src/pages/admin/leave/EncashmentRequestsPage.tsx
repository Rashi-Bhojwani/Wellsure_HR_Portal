import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Segmented } from "antd";
import * as api from "../../../api/encashmentRequests";
import { apiErrorMessage } from "../../../lib/apiError";
import { space } from "../../../theme/tokens";
import { ConfirmModal, DataTable, EmptyState, PageHeader, Panel, StatusChip, toast, useIsPhone } from "../../../ui";

// M session block 2, LV-23: directors decide encashment requests (never their own). Approved days are paid with payroll, which records them in the
// leave ledger; no amount is shown here.
export function EncashmentRequestsPage() {
  const phone = useIsPhone();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"PENDING" | "APPROVED" | "REJECTED">("PENDING");
  const [rejecting, setRejecting] = useState<api.EncRow | null>(null);
  const [note, setNote] = useState("");
  const q = useQuery({ queryKey: ["encashment", "list", status], queryFn: () => api.listEncashment(status) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["encashment"] });
  const approve = useMutation({ mutationFn: api.approveEncashment, onSuccess: () => { toast.success("Approved. It is paid with payroll."); refresh(); }, onError: (e) => toast.error(apiErrorMessage(e, "Could not approve it.")) });
  const reject = useMutation({ mutationFn: () => api.rejectEncashment(rejecting!.id, note.trim()), onSuccess: () => { toast.success("Not approved. The employee is told why."); setRejecting(null); setNote(""); refresh(); }, onError: (e) => toast.error(apiErrorMessage(e, "Could not record it.")) });
  const actions = (r: api.EncRow) => r.status === "PENDING" && (
    <div style={{ display: "flex", gap: space[2], flexWrap: "wrap", justifyContent: phone ? "stretch" : "flex-end" }}>
      <Button danger onClick={() => setRejecting(r)} block={phone} aria-label={`Do not approve ${r.fullName}'s request`}>Reject</Button>
      <Button type="primary" loading={approve.isPending && approve.variables === r.id} onClick={() => approve.mutate(r.id)} block={phone} aria-label={`Approve ${r.fullName}'s request`}>Approve</Button>
    </div>
  );
  return (
    <>
      <PageHeader title="Encashment requests" subtitle="Leave employees ask to encash during the year. Approved days are paid with payroll." actions={<Segmented value={status} onChange={(x) => setStatus(x as typeof status)} options={[{ value: "PENDING", label: "Waiting" }, { value: "APPROVED", label: "Approved" }, { value: "REJECTED", label: "Not approved" }]} aria-label="Which requests" />} />
      <Panel>
        <DataTable<api.EncRow> rowKey="id" loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} dataSource={q.data ?? []} pagination={(q.data?.length ?? 0) > 20 ? { pageSize: 20 } : false}
          empty={<EmptyState compact title="No requests here" description={null} />}
          columns={[
            { title: "Employee", key: "e", render: (_, r) => `${r.fullName} (${r.employeeCode})` },
            { title: "Leave", key: "l", render: (_, r) => `${r.leaveTypeCode} · ${r.leaveYear}` },
            { title: "Days", dataIndex: "days" },
            { title: "Note", key: "n", render: (_, r) => r.decisionNote ?? (r.reason || "—") },
            { title: "Status", key: "s", render: (_, r) => <StatusChip tone={api.ENC_TONE[r.status]}>{api.ENC_LABEL[r.status]}</StatusChip> },
            { title: "", key: "a", align: "right", render: (_, r) => actions(r) },
          ]}
          mobile={{ title: (r) => r.fullName, subtitle: (r) => `${r.days} day(s) of ${r.leaveTypeCode}`, actions: (r) => actions(r) || null }} />
      </Panel>
      <ConfirmModal open={!!rejecting} danger title="Do not approve this request" confirmLabel="Reject" description={rejecting ? `${rejecting.fullName}: ${rejecting.days} day(s) of ${rejecting.leaveTypeCode}` : undefined} loading={reject.isPending} confirmDisabled={note.trim().length < 3} onCancel={() => setRejecting(null)} onConfirm={() => reject.mutate()}>
        <Input.TextArea aria-label="Reason (the employee sees it)" placeholder="Reason (the employee sees it)" rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </ConfirmModal>
    </>
  );
}
