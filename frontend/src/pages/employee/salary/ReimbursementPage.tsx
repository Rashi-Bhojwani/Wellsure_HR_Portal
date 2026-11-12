import { useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Form, Input, Select, Upload, type UploadFile } from "antd";
import { PlusOutlined, UploadOutlined } from "@ant-design/icons";
import * as api from "../../../api/reimbursements";
import type { ClaimView } from "../../../api/reimbursements";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatRupees } from "../../../lib/money";
import { DataTable, PageHeader, SideDrawer, StatusChip, toast } from "../../../ui";
import { WRAP_TEXT as WRAP } from "../../../ui/textStyles";

// Salary > Reimbursement (P7-5): the person's own claims. A director decides; an approved claim is paid by the next payroll run.
const STATUS: Record<ClaimView["status"], { text: string; tone: "info" | "success" | "neutral" | "danger" }> = {
  SUBMITTED: { text: "Waiting for a director", tone: "info" },
  APPROVED: { text: "Approved, paid in the next run", tone: "success" },
  PAID: { text: "Paid", tone: "success" },
  REJECTED: { text: "Not approved", tone: "danger" },
  WITHDRAWN: { text: "Withdrawn", tone: "neutral" },
};

export function ReimbursementPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [form] = Form.useForm<{ typeKey: string; spentOn: Dayjs; amount: string; description: string }>();
  const q = useQuery({ queryKey: ["claims", "mine"], queryFn: api.myClaims });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["claims", "mine"] });
  const make = useMutation({
    mutationFn: (v: { typeKey: string; spentOn: Dayjs; amount: string; description: string }) => api.makeClaim({ ...v, spentOn: v.spentOn.format("YYYY-MM-DD") }, files.map((f) => f.originFileObj as File).filter(Boolean)),
    onSuccess: () => {
      toast.success("Claim sent.");
      setOpen(false);
      setFiles([]);
      form.resetFields();
      refresh();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not send the claim.")),
  });
  const withdraw = useMutation({ mutationFn: api.withdrawClaim, onSuccess: () => { toast.success("Withdrawn."); refresh(); }, onError: (err) => toast.error(apiErrorMessage(err, "Could not withdraw it.")) });
  const claimable = q.data?.claimable ?? [];
  return (
    <>
      <PageHeader title="Reimbursement" subtitle="Your claims. An approved claim is paid with your next salary." actions={claimable.length ? <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>New claim</Button> : undefined} />
      <DataTable<ClaimView>
        rowKey="id"
        loading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        dataSource={q.data?.claims ?? []}
        empty={claimable.length ? "No claims yet." : "There is no kind of claim you can make yet."}
        pagination={{ pageSize: 20 }}
        columns={[
          { title: "Kind", dataIndex: "typeKey" },
          { title: "Spent on", dataIndex: "spentOn", render: (x: string) => dayjs(x).format("D MMM YYYY") },
          { title: "Amount", dataIndex: "amount", align: "right", render: (x: string, r) => <span className="ws-num">{formatRupees(r.approvedAmount ?? x, 2)}</span> },
          { title: "State", key: "s", render: (_, r) => <StatusChip tone={STATUS[r.status].tone}>{r.status === "PAID" && r.paidIn ? `Paid in ${r.paidIn}` : STATUS[r.status].text}</StatusChip> },
          { title: "What for", dataIndex: "description", width: 280, render: (t: string) => <span style={WRAP}>{t}</span> },
          { title: "Note", dataIndex: "reason", render: (x: string | null) => x || "—" },
          { title: "", key: "act", fixed: "right" as const, render: (_, r) => (r.status === "SUBMITTED" ? <Button loading={withdraw.isPending && withdraw.variables === r.id} onClick={() => withdraw.mutate(r.id)}>Withdraw</Button> : null) },
        ]}
      />
      <SideDrawer open={open} title="New claim" subtitle="A director decides; you see the decision here." onClose={() => setOpen(false)} formId="claim-form" primaryLabel="Send" primaryLoading={make.isPending}>
        <Form id="claim-form" form={form} layout="vertical" requiredMark={false} onFinish={(v) => make.mutate(v)}>
          <Form.Item name="typeKey" label="Kind" rules={[{ required: true, message: "Choose a kind" }]}>
            <Select options={claimable.map((t) => ({ value: t.typeKey, label: `${t.name}${t.billsRequired ? " (bill needed)" : ""}` }))} />
          </Form.Item>
          <Form.Item name="spentOn" label="Spent on" rules={[{ required: true, message: "Choose the day" }]}>
            <DatePicker format="D MMM YYYY" disabledDate={(x) => x.isAfter(dayjs(), "day")} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="amount" label="Amount (₹)" rules={[{ required: true, pattern: /^\d+(\.\d{1,2})?$/, message: "Digits, up to two decimals" }]}>
            <Input inputMode="decimal" />
          </Form.Item>
          <Form.Item name="description" label="What for" rules={[{ required: true, min: 3, message: "A few words" }]}>
            <Input.TextArea rows={2} maxLength={300} />
          </Form.Item>
          <Form.Item label="Bills">
            <Upload multiple maxCount={5} fileList={files} beforeUpload={() => false} onChange={({ fileList }) => setFiles(fileList)} accept=".pdf,.jpg,.jpeg,.png">
              <Button icon={<UploadOutlined />}>Add a bill</Button>
            </Upload>
          </Form.Item>
        </Form>
      </SideDrawer>
    </>
  );
}
