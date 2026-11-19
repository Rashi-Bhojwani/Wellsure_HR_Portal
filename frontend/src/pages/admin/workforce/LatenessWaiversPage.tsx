import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Segmented } from "antd";
import * as api from "../../../api/lateness";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate } from "../../../lib/dates";
import { space } from "../../../theme/tokens";
import { ConfirmModal, DataTable, EmptyState, PageHeader, Panel, StatusChip, toast, useIsPhone } from "../../../ui";

// Lateness rule (docs/plans/LATE_CHECKLIST.md §5): HR decides the waivers managers ask for (never one they asked for, never their own arrival). No pay figures here.
export function LatenessWaiversPage() {
  const phone = useIsPhone();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"PENDING" | "APPROVED" | "REJECTED">("PENDING");
  const [rejecting, setRejecting] = useState<api.WaiverRow | null>(null);
  const [note, setNote] = useState("");
  const q = useQuery({ queryKey: ["lateness", "waivers", status], queryFn: () => api.listWaivers(status) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["lateness"] });
  const approve = useMutation({ mutationFn: api.approveWaiver, onSuccess: () => { toast.success("Waived. The arrival has no consequence and its allowance is back."); refresh(); }, onError: (e) => toast.error(apiErrorMessage(e, "Could not approve it.")) });
  const reject = useMutation({ mutationFn: () => api.rejectWaiver(rejecting!.id, note.trim()), onSuccess: () => { toast.success("Not waived. The manager and the employee are told why."); setRejecting(null); setNote(""); refresh(); }, onError: (e) => toast.error(apiErrorMessage(e, "Could not record it.")) });
  const actions = (r: api.WaiverRow) =>
    r.status === "PENDING" &&
    (r.mine ? (
      <StatusChip tone="neutral">Someone else in HR decides</StatusChip>
    ) : (
      <div style={{ display: "flex", gap: space[2], flexWrap: "wrap", justifyContent: phone ? "stretch" : "flex-end" }}>
        <Button danger block={phone} onClick={() => setRejecting(r)} aria-label={`Do not waive ${r.fullName}'s arrival on ${r.date}`}>Reject</Button>
        <Button type="primary" block={phone} loading={approve.isPending && approve.variables === r.id} onClick={() => approve.mutate(r.id)} aria-label={`Waive ${r.fullName}'s arrival on ${r.date}`}>Waive</Button>
      </div>
    ));
  return (
    <>
      <PageHeader title="Lateness waivers" subtitle="Managers ask to waive one late arrival with a reason. A waived arrival has no consequence and gives back any allowance it used." actions={<Segmented value={status} onChange={(x) => setStatus(x as typeof status)} options={[{ value: "PENDING", label: "Waiting" }, { value: "APPROVED", label: "Waived" }, { value: "REJECTED", label: "Not waived" }]} aria-label="Which requests" />} />
      <Panel>
        <DataTable<api.WaiverRow>
          rowKey="id"
          loading={q.isLoading}
          error={q.error}
          onRetry={() => void q.refetch()}
          dataSource={q.data ?? []}
          pagination={(q.data?.length ?? 0) > 20 ? { pageSize: 20 } : false}
          empty={<EmptyState compact title="No requests here" description={null} />}
          columns={[
            { title: "Employee", key: "e", render: (_, r) => `${r.fullName} (${r.employeeCode})` },
            { title: "Day", key: "d", render: (_, r) => formatDate(r.date) },
            { title: "In at", key: "t", render: (_, r) => (r.time ? `${r.time} (${r.bandLabel})` : "—") },
            { title: "Asked by", dataIndex: "requestedBy" },
            { title: "Reason", dataIndex: "reason" },
            { title: "Status", key: "s", render: (_, r) => <span><StatusChip tone={api.WAIVER_TONE[r.status]}>{api.WAIVER_LABEL[r.status]}</StatusChip>{r.decisionNote ? ` ${r.decisionNote}` : ""}</span> },
            { title: "", key: "a", align: "right", render: (_, r) => actions(r) },
          ]}
          mobile={{ title: (r) => r.fullName, subtitle: (r) => `${formatDate(r.date)}${r.time ? ` at ${r.time}` : ""} · ${r.reason}`, status: (r) => <StatusChip tone={api.WAIVER_TONE[r.status]}>{api.WAIVER_LABEL[r.status]}</StatusChip>, actions: (r) => actions(r) || null }}
        />
      </Panel>
      <ConfirmModal open={!!rejecting} danger title="Do not waive this arrival" confirmLabel="Reject" description={rejecting ? `${rejecting.fullName}, ${formatDate(rejecting.date)}: ${rejecting.reason}` : undefined} loading={reject.isPending} confirmDisabled={note.trim().length < 3} onCancel={() => setRejecting(null)} onConfirm={() => reject.mutate()}>
        <Input.TextArea aria-label="Reason (the manager and the employee see it)" placeholder="Reason (the manager and the employee see it)" rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </ConfirmModal>
    </>
  );
}
