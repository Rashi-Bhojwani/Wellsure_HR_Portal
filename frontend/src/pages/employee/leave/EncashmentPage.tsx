import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, InputNumber, Select } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import * as api from "../../../api/encashmentRequests";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate } from "../../../lib/dates";
import { DataTable, EmptyState, KeyValueGrid, PageHeader, Panel, QueryState, SideDrawer, Stack, StatusChip, toast, useIsPhone } from "../../../ui";

// M session block 2, LV-23: ask to encash leave during the year. A director decides; approved days are paid with payroll.
export function EncashmentPage() {
  const phone = useIsPhone();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<{ leaveTypeCode: string; days: number; reason: string }>();
  const q = useQuery({ queryKey: ["encashment", "mine"], queryFn: api.myEncashment });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["encashment"] });
  const ask = useMutation({ mutationFn: api.askEncashment, onSuccess: () => { toast.success("Asked. A director decides."); setOpen(false); refresh(); }, onError: (e) => toast.error(apiErrorMessage(e, "Could not send it.")) });
  const withdraw = useMutation({ mutationFn: api.withdrawEncashment, onSuccess: () => { toast.success("Withdrawn."); refresh(); }, onError: (e) => toast.error(apiErrorMessage(e, "Could not withdraw it.")) });
  const canAsk = (q.data?.types ?? []).some((t) => t.mayAsk > 0);
  return (
    <>
      <PageHeader title="Leave encashment" subtitle={q.data?.active ? `Keep at least ${q.data.keepAtLeast} day(s); at most ${q.data.maxDaysPerYear} day(s) a year.` : "Encash leave during the year."} actions={canAsk ? <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setOpen(true); }}>Ask</Button> : undefined} />
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} isEmpty={!!q.data && !q.data.active} empty={<EmptyState title="Encashment during the year is not in use" description="Leave is settled at the year end as usual." />}>
        <Stack>
          <Panel title="What you may encash">
            <KeyValueGrid columns={phone ? 1 : 3} items={(q.data?.types ?? []).map((t) => ({ label: `${t.name} (${t.code})`, value: `Balance ${t.balance} · asked this year ${t.askedThisYear} · may ask ${t.mayAsk}` }))} />
          </Panel>
          <Panel title="My requests">
            <DataTable rowKey="id" dataSource={q.data?.requests ?? []} pagination={false} empty={<EmptyState compact title="No requests yet" description={null} />}
              columns={[
                { title: "Asked", dataIndex: "createdAt", render: (x: string) => formatDate(x) },
                { title: "Leave", dataIndex: "leaveTypeCode" },
                { title: "Days", dataIndex: "days" },
                { title: "Status", key: "s", render: (_, r) => <span><StatusChip tone={api.ENC_TONE[r.status]}>{api.ENC_LABEL[r.status]}</StatusChip>{r.decisionNote ? ` ${r.decisionNote}` : ""}</span> },
                { title: "", key: "a", align: "right", render: (_, r) => r.status === "PENDING" && <Button onClick={() => withdraw.mutate(r.id)} aria-label={`Withdraw the request for ${r.days} day(s)`}>Withdraw</Button> },
              ]}
              mobile={{ title: (r) => `${r.days} day(s) of ${r.leaveTypeCode}`, subtitle: (r) => formatDate(r.createdAt), status: (r) => <StatusChip tone={api.ENC_TONE[r.status]}>{api.ENC_LABEL[r.status]}</StatusChip>, actions: (r) => (r.status === "PENDING" ? <Button block onClick={() => withdraw.mutate(r.id)}>Withdraw</Button> : null) }} />
          </Panel>
        </Stack>
      </QueryState>
      <SideDrawer open={open} title="Ask to encash leave" onClose={() => setOpen(false)} formId="enc-form" primaryLabel="Ask" primaryLoading={ask.isPending}>
        <Form id="enc-form" form={form} layout="vertical" requiredMark={false} onFinish={(v) => ask.mutate({ ...v, reason: v.reason ?? "" })}>
          <Form.Item name="leaveTypeCode" label="Leave" rules={[{ required: true }]}><Select options={(q.data?.types ?? []).filter((t) => t.mayAsk > 0).map((t) => ({ value: t.code, label: `${t.name} (up to ${t.mayAsk})` }))} /></Form.Item>
          <Form.Item name="days" label="Days (whole or half)" rules={[{ required: true }]}><InputNumber min={0.5} step={0.5} style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="reason" label="Note (optional)"><Input.TextArea rows={2} maxLength={300} /></Form.Item>
        </Form>
      </SideDrawer>
    </>
  );
}
