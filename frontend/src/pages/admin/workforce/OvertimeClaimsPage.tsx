import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Input, Segmented } from "antd";
import dayjs from "dayjs";
import * as api from "../../../api/overtime";
import { useAuth } from "../../../hooks/useAuth";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate } from "../../../lib/dates";
import { space } from "../../../theme/tokens";
import { ConfirmModal, DataTable, EmptyState, PageHeader, Panel, QueryState, Stack, toast, useIsPhone } from "../../../ui";

// M session block 2, AT-19: overtime claims waiting for a decision (the people the server lets this person decide), and the directors' month totals
// (minutes only; paying them is payroll's).
export function OvertimeClaimsPage() {
  const phone = useIsPhone();
  const queryClient = useQueryClient();
  const { hasRole } = useAuth();
  const [status, setStatus] = useState<"PENDING" | "APPROVED" | "REJECTED">("PENDING");
  const [rejecting, setRejecting] = useState<api.OvertimeClaim | null>(null);
  const [reason, setReason] = useState("");
  const [month, setMonth] = useState(dayjs().format("YYYY-MM"));
  const q = useQuery({ queryKey: ["overtime", "claims", status], queryFn: () => api.listOvertime(status) });
  const totals = useQuery({ queryKey: ["overtime", "totals", month], queryFn: () => api.overtimeTotals(month), enabled: hasRole("SUPER_ADMIN") });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["overtime"] });
  const approve = useMutation({ mutationFn: api.approveOvertime, onSuccess: () => { toast.success("Approved."); refresh(); }, onError: (e) => toast.error(apiErrorMessage(e, "Could not approve it.")) });
  const reject = useMutation({ mutationFn: () => api.rejectOvertime(rejecting!.id, reason.trim()), onSuccess: () => { toast.success("Not approved. The employee is told why."); setRejecting(null); setReason(""); refresh(); }, onError: (e) => toast.error(apiErrorMessage(e, "Could not record it.")) });
  const actions = (c: api.OvertimeClaim) =>
    c.status === "PENDING" && (
      <div style={{ display: "flex", gap: space[2], flexWrap: "wrap", justifyContent: phone ? "stretch" : "flex-end" }}>
        <Button danger onClick={() => setRejecting(c)} block={phone} aria-label={`Do not approve ${c.fullName}'s overtime on ${c.date}`}>Reject</Button>
        <Button type="primary" loading={approve.isPending && approve.variables === c.id} onClick={() => approve.mutate(c.id)} block={phone} aria-label={`Approve ${c.fullName}'s overtime on ${c.date}`}>Approve</Button>
      </div>
    );
  return (
    <>
      <PageHeader title="Overtime" subtitle="Claims for time worked beyond the shift. The minutes are read again from attendance when approved." actions={<Segmented value={status} onChange={(x) => setStatus(x as typeof status)} options={[{ value: "PENDING", label: "Waiting" }, { value: "APPROVED", label: "Approved" }, { value: "REJECTED", label: "Not approved" }]} aria-label="Which claims" />} />
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} isEmpty={!!q.data && !q.data.active} empty={<EmptyState title="Overtime is not in use" description="The directors turn it on in Policy settings." />}>
        <Stack>
          <Panel>
            <DataTable<api.OvertimeClaim>
              rowKey="id"
              dataSource={q.data?.claims ?? []}
              pagination={(q.data?.claims.length ?? 0) > 20 ? { pageSize: 20 } : false}
              empty={<EmptyState compact title="No claims here" description={null} />}
              columns={[
                { title: "Employee", key: "e", render: (_, c) => `${c.fullName} (${c.employeeCode})` },
                { title: "Day", dataIndex: "date", render: (x: string) => formatDate(x) },
                { title: "Minutes", key: "m", render: (_, c) => api.hm(c.approvedMinutes ?? c.minutes) },
                { title: "Note", key: "n", render: (_, c) => c.decisionNote ?? c.note ?? "—" },
                { title: "", key: "a", align: "right", render: (_, c) => actions(c) },
              ]}
              mobile={{ title: (c) => c.fullName, subtitle: (c) => `${formatDate(c.date)} · ${api.hm(c.approvedMinutes ?? c.minutes)}`, actions: (c) => actions(c) || null }}
            />
          </Panel>
          {hasRole("SUPER_ADMIN") && (
            <Panel title="Approved overtime by person" subtitle="Minutes only. Paying overtime is payroll's." extra={<DatePicker picker="month" value={dayjs(`${month}-01`)} onChange={(d) => d && setMonth(d.format("YYYY-MM"))} allowClear={false} aria-label="Month" />}>
              <DataTable rowKey="employeeId" loading={totals.isLoading} error={totals.error} dataSource={totals.data ?? []} pagination={false} empty={<EmptyState compact title="No approved overtime this month" description={null} />}
                columns={[{ title: "Employee", key: "e", render: (_, r) => `${r.fullName} (${r.employeeCode})` }, { title: "Days", dataIndex: "days" }, { title: "Time", key: "t", render: (_, r) => api.hm(r.minutes) }]}
                mobile={{ title: (r) => r.fullName, subtitle: (r) => `${r.days} day(s) · ${api.hm(r.minutes)}` }} />
            </Panel>
          )}
        </Stack>
      </QueryState>
      <ConfirmModal open={!!rejecting} danger title="Do not approve this overtime" confirmLabel="Reject" description={rejecting ? `${rejecting.fullName}, ${formatDate(rejecting.date)}` : undefined} loading={reject.isPending} confirmDisabled={reason.trim().length < 3} onCancel={() => setRejecting(null)} onConfirm={() => reject.mutate()}>
        <Input.TextArea aria-label="Reason (the employee sees it)" placeholder="Reason (the employee sees it)" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      </ConfirmModal>
    </>
  );
}
