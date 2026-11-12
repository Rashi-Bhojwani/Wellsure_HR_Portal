import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Form, Input } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import * as api from "../../../api/wfhRequests";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate } from "../../../lib/dates";
import { DataTable, EmptyState, PageHeader, Panel, QueryState, SideDrawer, StatusChip, toast, useIsPhone } from "../../../ui";

// M session block 2, AT-36: ask to work from home on some days; a director decides. Approved days are remote days (check in and out in the app).
export function WfhPage() {
  const phone = useIsPhone();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<{ range: [Dayjs, Dayjs]; reason: string }>();
  const q = useQuery({ queryKey: ["wfh", "mine"], queryFn: api.myWfh });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["wfh"] });
  const ask = useMutation({ mutationFn: (v: { range: [Dayjs, Dayjs]; reason: string }) => api.askWfh({ fromDate: v.range[0].format("YYYY-MM-DD"), toDate: v.range[1].format("YYYY-MM-DD"), reason: v.reason }), onSuccess: () => { toast.success("Asked. A director decides."); setOpen(false); refresh(); }, onError: (e) => toast.error(apiErrorMessage(e, "Could not send it.")) });
  const withdraw = useMutation({ mutationFn: api.withdrawWfh, onSuccess: () => { toast.success("Withdrawn."); refresh(); }, onError: (e) => toast.error(apiErrorMessage(e, "Could not withdraw it.")) });
  const can = !!q.data?.active && q.data.eligible;
  return (
    <>
      <PageHeader title="Work from home" subtitle={q.data?.maxDaysPerRequest ? `Ask for up to ${q.data.maxDaysPerRequest} day(s) at a time, from tomorrow on.` : "Ask to work from home on some days."} actions={can ? <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setOpen(true); }}>Ask</Button> : undefined} />
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} isEmpty={!!q.data && !can} empty={<EmptyState title={q.data?.active ? "Your department does not ask to work from home here" : "Work-from-home requests are not in use"} description="Ask HR through the Helpdesk if you need to." />}>
        <Panel>
          <DataTable
            rowKey="id"
            dataSource={q.data?.requests ?? []}
            pagination={false}
            empty={<EmptyState compact title="You have not asked yet" description={null} />}
            columns={[
              { title: "Days", key: "d", render: (_, r) => `${formatDate(r.fromDate)} – ${formatDate(r.toDate)}` },
              { title: "Reason", dataIndex: "reason" },
              { title: "Status", key: "s", render: (_, r) => <span><StatusChip tone={api.WFH_TONE[r.status]}>{api.WFH_LABEL[r.status]}</StatusChip>{r.decisionNote ? ` ${r.decisionNote}` : ""}</span> },
              { title: "", key: "a", align: "right", render: (_, r) => r.status === "PENDING" && <Button onClick={() => withdraw.mutate(r.id)} aria-label={`Withdraw the request from ${r.fromDate}`}>Withdraw</Button> },
            ]}
            mobile={{ title: (r) => `${formatDate(r.fromDate)} – ${formatDate(r.toDate)}`, subtitle: (r) => r.reason, status: (r) => <StatusChip tone={api.WFH_TONE[r.status]}>{api.WFH_LABEL[r.status]}</StatusChip>, actions: (r) => (r.status === "PENDING" ? <Button block={phone} onClick={() => withdraw.mutate(r.id)}>Withdraw</Button> : null) }}
          />
        </Panel>
      </QueryState>
      <SideDrawer open={open} title="Ask to work from home" onClose={() => setOpen(false)} formId="wfh-form" primaryLabel="Ask" primaryLoading={ask.isPending}>
        <Form id="wfh-form" form={form} layout="vertical" requiredMark={false} onFinish={(v) => ask.mutate(v)}>
          <Form.Item name="range" label="Days" rules={[{ required: true, message: "Choose the days" }]}><DatePicker.RangePicker style={{ width: "100%" }} disabledDate={(d) => !d.isAfter(dayjs(), "day")} /></Form.Item>
          <Form.Item name="reason" label="Reason" rules={[{ required: true, min: 3, message: "A few words" }]}><Input.TextArea rows={3} maxLength={300} /></Form.Item>
        </Form>
      </SideDrawer>
    </>
  );
}
