import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Select, Space } from "antd";
import { OfficeGate } from "../../peeps/OfficeGate";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate } from "../../../lib/dates";
import { space, v } from "../../../theme/tokens";
import { ConfirmModal, DataTable, EmptyState, PageHeader, Panel, StatusChip, toast } from "../../../ui";
import * as req from "../requestsApi";
import type { AssetRequestStatus, AssetRequestView } from "../requestsApi";

type Outcome = "APPROVED" | "DECLINED" | "FULFILLED";
const OUTCOME_LABEL: Record<Outcome, string> = { APPROVED: "Approve", DECLINED: "Decline", FULFILLED: "Mark fulfilled" };

// Assets → Requests (Peeps Stage 3): every employee's asset requests, for the people who run the register (HR and the directors, and Wellsure Office
// members while the directors' asset audience allows). Approve or decline a waiting request, and mark an approved one fulfilled; the employee is told.
export function AssetRequestsPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AssetRequestStatus | undefined>("SUBMITTED");
  const list = useQuery({ queryKey: ["assets", "requests", "all", status], queryFn: () => req.all(status) });
  const [deciding, setDeciding] = useState<{ r: AssetRequestView; outcome: Outcome } | null>(null);
  const [note, setNote] = useState("");
  const decide = useMutation({
    mutationFn: () => req.decide(deciding!.r.id, deciding!.outcome, note.trim() || undefined),
    onSuccess: () => { setDeciding(null); setNote(""); void queryClient.invalidateQueries({ queryKey: ["assets", "requests"] }); toast.success("Done. The employee is told."); },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't update the request.")),
  });
  const state = (r: AssetRequestView) => <StatusChip tone={req.STATUS_TONE[r.status]}>{req.STATUS_LABEL[r.status]}</StatusChip>;
  const actions = (r: AssetRequestView) => {
    const can: Outcome[] = r.status === "SUBMITTED" ? ["APPROVED", "DECLINED", "FULFILLED"] : r.status === "APPROVED" ? ["FULFILLED"] : [];
    if (!can.length) return null;
    return (
      <Space wrap size={space[2]}>
        {can.map((o) => <Button key={o} size="small" danger={o === "DECLINED"} type={o === "APPROVED" ? "primary" : "default"} onClick={() => setDeciding({ r, outcome: o })}>{OUTCOME_LABEL[o]}</Button>)}
      </Space>
    );
  };
  return (
    <>
      <PageHeader title="Asset requests" subtitle="What employees have asked for" />
      <Panel
        title="Requests"
        extra={<Select aria-label="Show" style={{ minWidth: 160 }} value={status ?? "ALL"} onChange={(x: string) => setStatus(x === "ALL" ? undefined : (x as AssetRequestStatus))} options={[{ value: "ALL", label: "All" }, ...(Object.keys(req.STATUS_LABEL) as AssetRequestStatus[]).map((k) => ({ value: k, label: req.STATUS_LABEL[k] }))]} />}
      >
        <DataTable<AssetRequestView>
          rowKey="id"
          loading={list.isLoading}
          error={list.error}
          onRetry={() => void list.refetch()}
          dataSource={list.data ?? []}
          pagination={{ pageSize: 20 }}
          empty={<EmptyState title="No requests here" description={null} compact illustration={false} />}
          columns={[
            { title: "Employee", key: "e", render: (_: unknown, r) => (r.employee ? `${r.employee.name} (${r.employee.employeeCode})` : "—") },
            { title: "Asset type", dataIndex: "category" },
            { title: "Note", dataIndex: "note", render: (n: string | null) => <span style={{ color: v.textBody }}>{n ?? ""}</span> },
            { title: "Asked", dataIndex: "requestedAt", render: (d: string) => formatDate(d) },
            { title: "", key: "s", align: "right", render: (_: unknown, r) => <span style={{ display: "inline-flex", gap: space[2], alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>{state(r)}{actions(r)}</span> },
          ]}
          mobile={{ title: (r) => (r.employee ? r.employee.name : r.category), subtitle: (r) => `${r.category} · ${formatDate(r.requestedAt)}`, status: state, actions, fields: [{ label: "Note", render: (r) => r.note ?? "" }] }}
        />
      </Panel>
      <ConfirmModal
        open={deciding !== null}
        onCancel={() => setDeciding(null)}
        onConfirm={() => decide.mutate()}
        title={deciding ? `${OUTCOME_LABEL[deciding.outcome]} this request?` : ""}
        info="The employee is told their request was updated; they see your note on their My Assets page."
        confirmLabel={deciding ? OUTCOME_LABEL[deciding.outcome] : "OK"}
        danger={deciding?.outcome === "DECLINED"}
        loading={decide.isPending}
      >
        <label htmlFor="asset-request-note" style={{ display: "block", marginBottom: space[2], color: v.textBody }}>
          Note for the employee (optional)
        </label>
        <Input.TextArea id="asset-request-note" rows={2} maxLength={300} showCount value={note} onChange={(e) => setNote(e.target.value)} />
      </ConfirmModal>
    </>
  );
}

/** The Wellsure Office's view of the same page (members with "Manage the asset register", while the directors allow it). */
export function OfficeAssetRequestsPage() {
  return (
    <OfficeGate title="Asset requests" need="MANAGE_ASSETS">
      <AssetRequestsPage />
    </OfficeGate>
  );
}
