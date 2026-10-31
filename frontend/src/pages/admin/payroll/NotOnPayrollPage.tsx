import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Radio, Select } from "antd";
import * as payrollApi from "../../../api/payroll";
import type { ExclusionRow, PersonHit } from "../../../api/payroll";
import { useAuth } from "../../../hooks/useAuth";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate } from "../../../lib/dates";
import { ApprovalBanner, DataTable, EmptyState, PageHeader, Panel, SideDrawer, Stack, StatusChip, toast } from "../../../ui";
import { Caption, PersonCell } from "../../../components/payroll/payrollUi";
import { space } from "../../../theme/tokens";

// Payroll → Not on payroll. A director marks a person as not on payroll from a date (to a date, or until further notice), with a reason. A different director confirms it. A run skips the
// person and names them in its skipped list. Ending it is another entry (put back on payroll from a date). Directors only; HR sees nothing.
export function NotOnPayrollPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("payroll.salary.edit");
  const canConfirm = hasPermission("payroll.approve");
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: ["payroll", "exclusions"], queryFn: payrollApi.listExclusions });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["payroll", "exclusions"] });
  const confirm = useMutation({ mutationFn: (id: string) => payrollApi.confirmExclusion(id), onSuccess: () => { toast.success("Confirmed."); refresh(); }, onError: (e) => toast.error(apiErrorMessage(e, "Could not confirm it.")) });
  const label = (r: ExclusionRow) => (r.kind === "EXCLUDE" ? "Not on payroll" : "Back on payroll");
  const buttons = (r: ExclusionRow, block?: boolean) => (!r.confirmed && canConfirm ? <div><Button type="primary" size={block ? "large" : "small"} block={block} loading={confirm.isPending} onClick={() => confirm.mutate(r.id)}>Confirm</Button><Caption>A different director from {r.madeBy} confirms it.</Caption></div> : null);
  return (
    <>
      <PageHeader title="Not on payroll" subtitle="People a payroll run leaves out for a period" actions={canEdit ? <Button type="primary" onClick={() => setAdding(true)}>Mark a person</Button> : undefined} />
      <Stack>
        <ApprovalBanner tone="info" title="A run skips them and says so" description="An entry takes effect only when a different director confirms it. The run for a month names every person it skipped. HR does not see this page." />
        <Panel>
          <DataTable<ExclusionRow>
            rowKey="id"
            density="compact"
            loading={q.isLoading}
            error={q.error}
            onRetry={() => void q.refetch()}
            dataSource={q.data ?? []}
            pagination={false}
            empty={<EmptyState compact title="Nobody is marked" description="Everybody employed in a month is on payroll unless a director says otherwise." />}
            mobile={{ title: (r) => r.name, subtitle: (r) => `${r.employeeCode} · ${label(r)}`, status: (r) => <StatusChip tone={r.confirmed ? "success" : "warning"}>{r.confirmed ? "Confirmed" : "Waiting"}</StatusChip>, fields: [{ label: "From", render: (r) => `${formatDate(r.fromDate)}${r.toDate ? ` to ${formatDate(r.toDate)}` : " until further notice"}` }, { label: "Why", render: (r) => r.reason }], actions: (r) => buttons(r, true) }}
            columns={[
              { title: "Employee", key: "who", render: (_, r) => <PersonCell name={r.name} code={r.employeeCode} /> },
              { title: "What", key: "what", render: (_, r) => label(r) },
              { title: "Period", key: "period", render: (_, r) => `${formatDate(r.fromDate)}${r.toDate ? ` to ${formatDate(r.toDate)}` : " until further notice"}` },
              { title: "Why", key: "why", render: (_, r) => <div>{r.reason}<Caption>Made by {r.madeBy}</Caption></div> },
              { title: "Status", key: "status", render: (_, r) => <StatusChip tone={r.confirmed ? "success" : "warning"}>{r.confirmed ? "Confirmed" : "Waiting for a different director"}</StatusChip> },
              { title: "", key: "actions", align: "right", render: (_, r) => buttons(r) },
            ]}
          />
        </Panel>
      </Stack>
      {adding && <AddDrawer onClose={() => setAdding(false)} onDone={refresh} />}
    </>
  );
}

function AddDrawer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [hits, setHits] = useState<PersonHit[]>([]);
  const [employeeId, setEmployeeId] = useState<string>();
  const [kind, setKind] = useState<"EXCLUDE" | "INCLUDE" | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const ready = !!employeeId && kind !== null && /^\d{4}-\d{2}-\d{2}$/.test(from) && (to === "" || /^\d{4}-\d{2}-\d{2}$/.test(to)) && reason.trim().length >= 3;
  const save = useMutation({
    mutationFn: () => payrollApi.addExclusion({ employeeId: employeeId!, kind: kind!, fromDate: from, ...(to ? { toDate: to } : {}), reason: reason.trim() }),
    onSuccess: () => { toast.success("Saved. A different director has to confirm it."); onDone(); onClose(); },
    onError: (e) => setProblem(apiErrorMessage(e, "Could not save.")),
  });
  return (
    <SideDrawer open title="Mark a person" subtitle="Effective from a date, confirmed by a different director" onClose={onClose}
      footer={<div style={{ display: "flex", gap: space[3], width: "100%" }}><Button size="large" style={{ flex: 1 }} onClick={onClose}>Cancel</Button><Button size="large" type="primary" style={{ flex: 1 }} disabled={!ready} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></div>}>
      <Form layout="vertical" component="div" requiredMark={false}>
        <Form.Item label="Who" htmlFor="np-who"><Select id="np-who" showSearch filterOption={false} style={{ width: "100%" }} placeholder="Type a name or employee code" notFoundContent={null} value={employeeId} options={hits.map((h) => ({ value: h.employeeId, label: `${h.name} (${h.employeeCode})` }))} onSearch={(t) => { if (t.trim().length >= 2) void payrollApi.searchPeople(t.trim()).then(setHits); }} onChange={setEmployeeId} /></Form.Item>
        <Form.Item label="What"><Radio.Group value={kind} onChange={(e) => setKind(e.target.value)}><Radio value="EXCLUDE">Not on payroll</Radio><Radio value="INCLUDE">Put back on payroll</Radio></Radio.Group></Form.Item>
        <Form.Item label="From" htmlFor="np-from" extra="For example 2026-10-01. A month whose run is already final cannot be reached."><Input id="np-from" inputMode="numeric" maxLength={10} placeholder="YYYY-MM-DD" value={from} onChange={(e) => setFrom(e.target.value)} style={{ maxWidth: 220 }} /></Form.Item>
        <Form.Item label="Until (optional)" htmlFor="np-to" extra="Leave empty for until further notice."><Input id="np-to" inputMode="numeric" maxLength={10} placeholder="YYYY-MM-DD" value={to} onChange={(e) => setTo(e.target.value)} style={{ maxWidth: 220 }} /></Form.Item>
        <Form.Item label="Why" htmlFor="np-why" validateStatus={problem ? "error" : undefined} help={problem ?? "Required."}><Input.TextArea id="np-why" rows={2} maxLength={200} showCount value={reason} onChange={(e) => { setReason(e.target.value); setProblem(null); }} /></Form.Item>
      </Form>
    </SideDrawer>
  );
}
