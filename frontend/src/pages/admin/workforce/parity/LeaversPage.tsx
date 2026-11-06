import { useState } from "react";
import dayjs from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Segmented } from "antd";
import * as workforceApi from "../../../../api/workforce";
import type { LeaverRow } from "../../../../api/workforce";
import { apiErrorMessage } from "../../../../lib/apiError";
import { ConfirmModal, DataTable, PageHeader, StatusChip, toast } from "../../../../ui";
import { fs, space, v } from "../../../../theme/tokens";

// A-10 G6 (docs/plans/GREYTHR_PARITY_WORKFORCE.md item 15): people leaving (a separation that is not cancelled, last working day from 90 days ago to 60
// days ahead) and their leave recalculated to that day. Days only: what the remaining balance is worth is payroll's, not this screen's.

const fmt = (s: string) => dayjs(s).format("D MMM YYYY");
const monthOf = (s: string) => dayjs(s).format("MMM YYYY");

export function LeaversPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"PENDING" | "DONE" | "ALL">("PENDING");
  const [open, setOpen] = useState<LeaverRow | null>(null);
  const rows = useQuery({ queryKey: ["workforce", "leavers", status], queryFn: () => workforceApi.listLeavers({ status: status === "ALL" ? undefined : status }) });
  const preview = useQuery({ queryKey: ["workforce", "leaver-preview", open?.separationId], queryFn: () => workforceApi.previewLeaver(open!.separationId), enabled: !!open });
  const apply = useMutation({
    mutationFn: () => workforceApi.applyLeaver(open!.separationId),
    onSuccess: (r) => {
      toast.success(r.actions.length ? `Recalculated: ${r.actions.length} correction${r.actions.length === 1 ? "" : "s"} written.` : "Checked: nothing needed correcting.");
      setOpen(null);
      void queryClient.invalidateQueries({ queryKey: ["workforce", "leavers"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not recalculate.")),
  });
  const actions = preview.data?.actions ?? [];
  return (
    <>
      <PageHeader title="Leavers" subtitle="Recalculate each leaver's leave to their last working day. No leave accrues for a month that starts after it." />
      <div style={{ marginBottom: space[4] }}>
        <Segmented
          aria-label="Show"
          value={status}
          onChange={(x) => setStatus(x as typeof status)}
          options={[
            { value: "PENDING", label: "To do" },
            { value: "DONE", label: "Done" },
            { value: "ALL", label: "All" },
          ]}
        />
      </div>
      <DataTable<LeaverRow>
        rowKey="separationId"
        loading={rows.isLoading}
        error={rows.error}
        onRetry={() => void rows.refetch()}
        dataSource={rows.data?.leavers ?? []}
        empty={status === "PENDING" ? "Nobody is waiting for a recalculation." : "Nobody here."}
        pagination={{ pageSize: 25 }}
        columns={[
          { title: "Employee", key: "e", render: (_, r) => `${r.name} (${r.employeeCode})` },
          { title: "Last working day", dataIndex: "lastWorkingDate", render: (x: string) => fmt(x) },
          { title: "Separation", dataIndex: "separationStatus", render: (x: string) => <StatusChip status={x} /> },
          { title: "Leave", key: "s", render: (_, r) => (r.status === "DONE" ? <StatusChip tone="success">Done</StatusChip> : <StatusChip tone="warning">To do</StatusChip>) },
          { title: "", key: "act", render: (_, r) => <Button onClick={() => setOpen(r)}>{r.status === "DONE" ? "Check again" : "Recalculate"}</Button> },
        ]}
      />
      <ConfirmModal
        open={!!open}
        title={`Recalculate ${open?.name ?? ""}'s leave?`}
        description={`To the last working day, ${open ? fmt(open.lastWorkingDate) : ""}. Corrections are added to the leave ledger; nothing is deleted.`}
        confirmLabel="Write the corrections"
        loading={apply.isPending}
        confirmDisabled={preview.isLoading}
        onCancel={() => setOpen(null)}
        onConfirm={() => apply.mutate()}
      >
        <div style={{ marginTop: space[2], fontSize: fs.sm, color: v.textBody }}>
          {preview.isLoading ? "Working it out…" : actions.length === 0 ? "Nothing needs correcting." : (
            <ul style={{ paddingLeft: space[5], margin: 0 }}>
              {actions.map((a) => (
                <li key={`${a.type}-${a.leaveTypeCode}-${a.accrualMonth}`}>
                  {a.type === "REVERSE" ? "Take back" : "Add"} {a.days} day{a.days === 1 ? "" : "s"} of {a.leaveTypeCode} for {monthOf(a.accrualMonth)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </ConfirmModal>
    </>
  );
}
