import { useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker } from "antd";
import { Link } from "react-router-dom";
import * as api from "../../../api/payPolicies";
import type { EncashmentList, OvertimePreview } from "../../../api/payPolicies";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatRupees } from "../../../lib/money";
import { ApprovalBanner, DataTable, PageHeader, Panel, Stack, StatusChip, toast } from "../../../ui";
import { space } from "../../../theme/tokens";

// Payroll > Overtime and encashment pay (part 3 A2/A3, docs/plans/A_PART3.md), directors only. Approved overtime and approved in-year encashment are paid as pending
// adjustments for the next run — only once the pay setting is confirmed by two directors (Default behaviours) and the switch is on (Policy settings). Nothing is preset.
type OtRow = OvertimePreview["people"][number];
type EncRow = EncashmentList["requests"][number];

function NotSet({ items }: { items: string[] }) {
  if (!items.length) return null;
  return <ApprovalBanner tone="warning" title="Not set" description={<>{items.join(" ")} <Link to="/admin/settings/behaviours">Default behaviours</Link></>} style={{ marginBottom: space[3] }} />;
}

export function OvertimeEncashmentPage() {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState<Dayjs>(() => dayjs().subtract(1, "month"));
  const m = month.format("YYYY-MM");
  const ot = useQuery({ queryKey: ["pay-policies", "overtime", m], queryFn: () => api.overtimePreview(m) });
  const enc = useQuery({ queryKey: ["pay-policies", "encashment"], queryFn: api.encashmentList });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["pay-policies"] });
  const fail = (what: string) => (err: unknown) => toast.error(apiErrorMessage(err, what));
  const post = useMutation({ mutationFn: () => api.postOvertime(m), onSuccess: (r) => { toast.success(`${r.created} adjustment(s) added for the next run.`); refresh(); }, onError: fail("Could not pay overtime.") });
  const pay = useMutation({ mutationFn: (id: string) => api.payEncashment(id), onSuccess: () => { toast.success("Added for the next run; the leave ledger records the days."); refresh(); }, onError: fail("Could not pay it.") });
  return (
    <>
      <PageHeader title="Overtime and encashment pay" subtitle="Paid through the next run once the settings are confirmed. Nothing is preset." />
      <Stack>
        <Panel title="Overtime" extra={<DatePicker picker="month" aria-label="Month" allowClear={false} format="MMM YYYY" value={month} onChange={(d) => d && setMonth(d)} />}>
          <NotSet items={ot.data?.notSet ?? []} />
          <DataTable<OtRow>
            rowKey="employeeId"
            loading={ot.isLoading}
            error={ot.error}
            onRetry={() => void ot.refetch()}
            dataSource={ot.data?.people ?? []}
            empty="No approved overtime in this month."
            pagination={{ pageSize: 25 }}
            mobile={{ title: (r) => r.name, subtitle: (r) => `${r.minutes} min · ${r.amount ? formatRupees(r.amount, 2) : "Not set"}` }}
            columns={[
              { title: "Employee", key: "e", render: (_, r) => `${r.name} (${r.employeeCode})` },
              { title: "Approved minutes", dataIndex: "minutes", align: "right" },
              { title: "Amount", dataIndex: "amount", align: "right", render: (x: string | null, r) => (r.noSalary ? "No salary" : x ? formatRupees(x, 2) : "Not set") },
              { title: "State", key: "s", render: (_, r) => (r.posted ? <StatusChip tone="success">Added for the next run</StatusChip> : <StatusChip tone="neutral">Not paid</StatusChip>) },
            ]}
          />
          <div style={{ marginTop: space[3] }}>
            <Button type="primary" disabled={!ot.data || ot.data.notSet.length > 0 || ot.data.people.every((p) => p.posted || p.noSalary)} loading={post.isPending} onClick={() => post.mutate()}>Pay this month's overtime</Button>
          </div>
        </Panel>
        <Panel title="Leave encashment during the year" subtitle="Approved requests. Paying adds an adjustment and the leave-ledger entry together, once.">
          <NotSet items={enc.data?.notSet ?? []} />
          <DataTable<EncRow>
            rowKey="id"
            loading={enc.isLoading}
            error={enc.error}
            onRetry={() => void enc.refetch()}
            dataSource={enc.data?.requests ?? []}
            empty="No approved encashment requests."
            pagination={{ pageSize: 25 }}
            mobile={{ title: (r) => `${r.name} · ${r.leaveType}`, subtitle: (r) => `${r.days} days · ${r.amount ? formatRupees(r.amount, 2) : "Not set"}`, actions: (r) => (r.paid ? null : <Button disabled={(enc.data?.notSet.length ?? 1) > 0 || !r.amount} loading={pay.isPending && pay.variables === r.id} onClick={() => pay.mutate(r.id)}>Pay</Button>) }}
            columns={[
              { title: "Employee", key: "e", render: (_, r) => `${r.name} (${r.employeeCode})` },
              { title: "Leave", key: "l", render: (_, r) => `${r.leaveType} ${r.leaveYear}` },
              { title: "Days", dataIndex: "days", align: "right" },
              { title: "Amount", dataIndex: "amount", align: "right", render: (x: string | null, r) => (r.noSalary ? "No salary" : x ? formatRupees(x, 2) : "Not set") },
              { title: "", key: "a", render: (_, r) => (r.paid ? <StatusChip tone="success">Added for the next run</StatusChip> : <Button disabled={(enc.data?.notSet.length ?? 1) > 0 || !r.amount} loading={pay.isPending && pay.variables === r.id} onClick={() => pay.mutate(r.id)}>Pay</Button>) },
            ]}
          />
        </Panel>
      </Stack>
    </>
  );
}

export default OvertimeEncashmentPage;
