import { useState } from "react";
import dayjs from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Segmented } from "antd";
import * as workforceApi from "../../../../api/workforce";
import type { WorkflowItem, WorkflowType } from "../../../../api/workforce";
import { useAuth } from "../../../../hooks/useAuth";
import { apiErrorMessage } from "../../../../lib/apiError";
import { ConfirmModal, DataTable, FilterBar, PageHeader, StatusChip, toast } from "../../../../ui";
import { space } from "../../../../theme/tokens";

// A-10 G7 (docs/plans/GREYTHR_PARITY_WORKFORCE.md item 16): one place for leave and attendance corrections. Review = waiting on me (pending) and what I
// decided (completed), with bulk approve / reject; Monitor = waiting on someone else (company-wide viewers only). Who may decide what is the existing rule.

type Tab = "PENDING" | "COMPLETED" | "MONITOR";

export function WorkflowPage() {
  const { hasPermission, user } = useAuth();
  const queryClient = useQueryClient();
  const types: Array<{ value: WorkflowType; label: string }> = [
    ...(hasPermission("leave.approve") || hasPermission("leave.view") ? [{ value: "LEAVE" as const, label: "Leave" }] : []),
    ...(hasPermission("attendance.regularization.approve") || hasPermission("attendance.regularization.view") ? [{ value: "REGULARIZATION" as const, label: "Attendance corrections" }] : []),
  ];
  const [type, setType] = useState<WorkflowType>(types[0]?.value ?? "LEAVE");
  const canMonitor = user?.dataScope === "ALL";
  const [tab, setTab] = useState<Tab>("PENDING");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [deciding, setDeciding] = useState<"APPROVE" | "REJECT" | null>(null);
  const [note, setNote] = useState("");
  const list = useQuery({
    queryKey: ["workflow", type, tab, search],
    queryFn: () => (tab === "MONITOR" ? workforceApi.workflowMonitor({ type, search: search || undefined }) : workforceApi.workflowReview({ type, state: tab, search: search || undefined })),
    enabled: types.length > 0,
  });
  const decide = useMutation({
    mutationFn: () => workforceApi.workflowDecide({ type, ids: selected, approve: deciding === "APPROVE", note: note.trim() || null }),
    onSuccess: (r) => {
      if (r.failed) toast.error(`${r.decided} decided, ${r.failed} not: ${r.results.find((x) => !x.ok)?.error ?? ""}`);
      else toast.success(`${r.decided} decided.`);
      setDeciding(null);
      setNote("");
      setSelected([]);
      void queryClient.invalidateQueries({ queryKey: ["workflow"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not save the decisions.")),
  });
  const tabs = [
    { value: "PENDING", label: "Waiting on me" },
    { value: "COMPLETED", label: "Decided by me" },
    ...(canMonitor ? [{ value: "MONITOR", label: "Waiting on others" }] : []),
  ];
  return (
    <>
      <PageHeader title="Workflow" subtitle="Leave and attendance corrections: what waits on you, what you decided, and what waits on others." />
      <FilterBar
        onSearch={setSearch}
        searchPlaceholder="Search name, number or type"
        filters={
          <>
            <Segmented aria-label="Kind" value={type} onChange={(x) => { setType(x as WorkflowType); setSelected([]); }} options={types} />
            <Segmented aria-label="Show" value={tab} onChange={(x) => { setTab(x as Tab); setSelected([]); }} options={tabs} />
          </>
        }
      />
      {tab === "PENDING" && selected.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: space[2], margin: `${space[3]}px 0` }}>
          <Button type="primary" onClick={() => setDeciding("APPROVE")}>Approve {selected.length}</Button>
          <Button danger onClick={() => setDeciding("REJECT")}>Reject {selected.length}</Button>
          <Button type="link" onClick={() => setSelected([])}>Clear</Button>
        </div>
      )}
      <DataTable<WorkflowItem>
        rowKey="id"
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        dataSource={list.data ?? []}
        empty={tab === "PENDING" ? "Nothing is waiting on you." : tab === "COMPLETED" ? "You have not decided any yet." : "Nothing is waiting on anyone else."}
        pagination={{ pageSize: 25 }}
        rowSelection={tab === "PENDING" ? { selectedRowKeys: selected, onChange: (keys) => setSelected(keys as string[]) } : undefined}
        columns={[
          { title: "Employee", key: "e", render: (_, r) => `${r.name} (${r.employeeCode})` },
          { title: "What", dataIndex: "what" },
          { title: "When", dataIndex: "when" },
          { title: "Reason given", dataIndex: "reason", render: (x: string | null) => x || "—" },
          ...(tab === "MONITOR" ? [{ title: "Waiting on", dataIndex: "waitingOn" }] : []),
          { title: tab === "COMPLETED" ? "Decided" : "Asked", key: "t", render: (_: unknown, r: WorkflowItem) => dayjs(tab === "COMPLETED" ? (r.decidedAt ?? r.createdAt) : r.createdAt).format("D MMM, HH:mm") },
          { title: "Status", dataIndex: "status", render: (x: string) => <StatusChip status={x} /> },
        ]}
      />
      <ConfirmModal
        open={!!deciding}
        title={`${deciding === "APPROVE" ? "Approve" : "Reject"} ${selected.length} request${selected.length === 1 ? "" : "s"}?`}
        description="Each is decided on its own; any that can't be (decided meanwhile, out of your reach) is left as it is and named."
        confirmLabel={deciding === "APPROVE" ? "Approve" : "Reject"}
        confirmDisabled={deciding === "REJECT" && note.trim().length < 3}
        loading={decide.isPending}
        onCancel={() => setDeciding(null)}
        onConfirm={() => decide.mutate()}
      >
        <Input.TextArea aria-label="Note" placeholder={deciding === "REJECT" ? "Why (shown to them)" : "A note (optional)"} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} style={{ marginTop: space[2] }} />
      </ConfirmModal>
    </>
  );
}
