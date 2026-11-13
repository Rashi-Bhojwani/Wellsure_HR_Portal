import { useState } from "react";
import dayjs from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, InputNumber } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import * as api from "../../../api/compliance";
import type { DueDateView } from "../../../api/compliance";
import { apiErrorMessage } from "../../../lib/apiError";
import { ApprovalBanner, ConfirmModal, DataTable, PageHeader, Panel, SideDrawer, StatusChip, toast } from "../../../ui";
import { space } from "../../../theme/tokens";

// Payroll > Compliance calendar (ST-30, docs/plans/A_PARITY_ROWS.md part 2), directors only. Every due date is entered by a director with its source — none is preset,
// the dates are statutory facts the owners give. Each month a date reads due soon, overdue or done; the directors are reminded once inside its window.
const STATE: Record<DueDateView["state"], { text: string; tone: "success" | "danger" | "warning" | "neutral" }> = {
  DONE: { text: "Done this month", tone: "success" },
  OVERDUE: { text: "Overdue", tone: "danger" },
  DUE_SOON: { text: "Due soon", tone: "warning" },
  UPCOMING: { text: "Upcoming", tone: "neutral" },
};
interface AddForm { statute: string; item: string; dueDay: number; remindDaysBefore: number; source: string }

export function CompliancePage() {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [retiring, setRetiring] = useState<DueDateView | null>(null);
  const [reason, setReason] = useState("");
  const [form] = Form.useForm<AddForm>();
  const q = useQuery({ queryKey: ["payroll-compliance"], queryFn: api.listDueDates });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["payroll-compliance"] });
  const fail = (what: string) => (err: unknown) => toast.error(apiErrorMessage(err, what));
  const add = useMutation({ mutationFn: (val: AddForm) => api.addDueDate(val), onSuccess: () => { toast.success("Added."); setAdding(false); form.resetFields(); refresh(); }, onError: fail("Could not add it.") });
  const done = useMutation({ mutationFn: (d: DueDateView) => api.markDueDateDone(d.id, q.data!.month), onSuccess: () => { toast.success("Marked done for this month."); refresh(); }, onError: fail("Could not mark it.") });
  const retire = useMutation({ mutationFn: () => api.retireDueDate(retiring!.id, reason.trim()), onSuccess: () => { toast.success("Retired."); setRetiring(null); setReason(""); refresh(); }, onError: fail("Could not retire it.") });
  return (
    <>
      <PageHeader title="Compliance calendar" subtitle="Due dates you enter, each with its source. You are reminded before each one." actions={<Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>Add a due date</Button>} />
      <ApprovalBanner tone="info" title="No due date is preset" description="Statutory due dates are your own facts to give (spec §14). Enter each with where it comes from; to change one, retire it and add the new one." style={{ marginBottom: space[4] }} />
      <Panel title={q.data ? `This month (${dayjs(`${q.data.month}-01`).format("MMMM YYYY")})` : "This month"}>
        <DataTable<DueDateView>
          rowKey="id"
          loading={q.isLoading}
          error={q.error}
          onRetry={() => void q.refetch()}
          dataSource={q.data?.dates ?? []}
          empty="No due dates yet. Add the first one."
          pagination={false}
          mobile={{ title: (d) => `${d.statute}: ${d.item}`, subtitle: (d) => `Due ${dayjs(d.dueThisMonth).format("D MMM")} · ${STATE[d.state].text}`, actions: (d) => (<>{d.state !== "DONE" && <Button loading={done.isPending} onClick={() => done.mutate(d)}>Mark done</Button>}<Button onClick={() => setRetiring(d)}>Retire</Button></>) }}
          columns={[
            { title: "Statute", dataIndex: "statute" },
            { title: "What is due", dataIndex: "item" },
            { title: "Due this month", dataIndex: "dueThisMonth", render: (x: string) => dayjs(x).format("D MMM YYYY") },
            { title: "Remind", dataIndex: "remindDaysBefore", render: (n: number) => (n === 0 ? "On the day" : `${n} days before`) },
            { title: "Source", dataIndex: "source" },
            { title: "State", key: "s", render: (_, d) => <StatusChip tone={STATE[d.state].tone}>{STATE[d.state].text}</StatusChip> },
            {
              title: "",
              key: "a",
              render: (_, d) => (
                <div style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}>
                  {d.state !== "DONE" && <Button loading={done.isPending} onClick={() => done.mutate(d)}>Mark done</Button>}
                  <Button onClick={() => setRetiring(d)}>Retire</Button>
                </div>
              ),
            },
          ]}
        />
      </Panel>
      <SideDrawer open={adding} title="Add a due date" subtitle="It repeats every month on that day (the last day of a shorter month)." onClose={() => setAdding(false)} formId="due-date-form" primaryLabel="Add" primaryLoading={add.isPending}>
        <Form id="due-date-form" form={form} layout="vertical" requiredMark={false} initialValues={{ remindDaysBefore: 3 }} onFinish={(val) => add.mutate(val)}>
          <Form.Item name="statute" label="Statute" rules={[{ required: true, min: 2, max: 40, message: "e.g. PF, ESI, PT, TDS" }]}><Input /></Form.Item>
          <Form.Item name="item" label="What is due" rules={[{ required: true, min: 3, max: 200, message: "At least three characters" }]}><Input /></Form.Item>
          <Form.Item name="dueDay" label="Day of the month" rules={[{ required: true, message: "1 to 31" }]}><InputNumber min={1} max={31} style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="remindDaysBefore" label="Remind this many days before" rules={[{ required: true }]}><InputNumber min={0} max={30} style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="source" label="Where the date comes from" rules={[{ required: true, min: 3, message: "Say where it comes from" }]}><Input /></Form.Item>
        </Form>
      </SideDrawer>
      <ConfirmModal open={!!retiring} title="Retire this due date" description="It stops being shown and reminded. Its history is kept." confirmLabel="Retire" confirmDisabled={reason.trim().length < 3} loading={retire.isPending} onCancel={() => setRetiring(null)} onConfirm={() => retire.mutate()}>
        <Input aria-label="Reason" placeholder="Why" value={reason} onChange={(e) => setReason(e.target.value)} style={{ marginTop: space[2] }} />
      </ConfirmModal>
    </>
  );
}

export default CompliancePage;
