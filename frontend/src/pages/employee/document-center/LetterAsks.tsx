import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Select } from "antd";
import { PlusOutlined, RollbackOutlined } from "@ant-design/icons";
import * as asksApi from "../../../api/letterAsks";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate } from "../../../lib/dates";
import { fs, space, v } from "../../../theme/tokens";
import { ConfirmModal, DataTable, EmptyState, SideDrawer, StatusChip, toast, useIsPhone } from "../../../ui";

// LT-08 (M session): ask for a letter (for example an address proof) from the ones the directors made available; see what happened to each ask.
const STATUS_LABEL: Record<asksApi.AskStatus, string> = { ASKED: "Waiting", DONE: "Being prepared", DECLINED: "Declined", WITHDRAWN: "Withdrawn" };
const STATUS_TONE: Record<asksApi.AskStatus, "info" | "success" | "danger" | "neutral"> = { ASKED: "info", DONE: "success", DECLINED: "danger", WITHDRAWN: "neutral" };

export function LetterAsks() {
  const phone = useIsPhone();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [withdrawing, setWithdrawing] = useState<asksApi.MyAsk | null>(null);
  const [form] = Form.useForm<{ templateCode: string; purpose: string }>();
  const options = useQuery({ queryKey: ["letter-asks", "options"], queryFn: asksApi.askOptions });
  const mine = useQuery({ queryKey: ["letter-asks", "mine"], queryFn: asksApi.myAsks });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["letter-asks"] });
  const ask = useMutation({
    mutationFn: (v: { templateCode: string; purpose: string }) => asksApi.askForLetter(v.templateCode, v.purpose),
    onSuccess: () => { toast.success("Asked. You are told when it is being prepared or if it is declined."); setOpen(false); refresh(); },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not send it.")),
  });
  const withdraw = useMutation({
    mutationFn: (id: string) => asksApi.withdrawAsk(id),
    onSuccess: () => { toast.success("Withdrawn."); setWithdrawing(null); refresh(); },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not withdraw it.")),
  });
  const none = (options.data?.length ?? 0) === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[3] }}>
      <div style={{ display: "flex", gap: space[3], alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
        <p style={{ margin: 0, color: v.textSecondary, fontSize: fs.sm }}>
          {none ? "There is no letter you can ask for here yet. Ask HR through the Helpdesk." : "Ask for a letter, say what it is for, and it is prepared for you. Issued letters appear under My Documents."}
        </p>
        <Button type="primary" icon={<PlusOutlined />} disabled={none} loading={options.isLoading} onClick={() => { form.resetFields(); setOpen(true); }} block={phone}>
          Ask for a letter
        </Button>
      </div>
      <DataTable<asksApi.MyAsk>
        rowKey="id"
        loading={mine.isLoading}
        error={mine.error}
        onRetry={() => void mine.refetch()}
        dataSource={mine.data ?? []}
        pagination={(mine.data?.length ?? 0) > 10 ? { pageSize: 10 } : false}
        empty={<EmptyState compact illustration="documents" title="You have not asked for a letter" description="What you ask for shows here with what happened to it." />}
        columns={[
          { title: "Letter", dataIndex: "template" },
          { title: "For", dataIndex: "purpose" },
          { title: "Asked on", dataIndex: "createdAt", render: (d: string) => formatDate(d) },
          { title: "Status", key: "status", render: (_, r) => <span><StatusChip tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusChip>{r.note && <span style={{ display: "block", fontSize: fs.sm, color: v.textSecondary }}>{r.note}</span>}</span> },
          { title: "", key: "a", align: "right", render: (_, r) => r.status === "ASKED" && <Button icon={<RollbackOutlined />} onClick={() => setWithdrawing(r)}>Withdraw</Button> },
        ]}
        mobile={{
          title: (r) => r.template,
          subtitle: (r) => r.purpose,
          status: (r) => <StatusChip tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusChip>,
          fields: [{ label: "Asked on", render: (r) => formatDate(r.createdAt) }, { label: "Note", render: (r) => r.note ?? "—" }],
          actions: (r) => (r.status === "ASKED" ? <Button block icon={<RollbackOutlined />} onClick={() => setWithdrawing(r)}>Withdraw</Button> : null),
        }}
      />
      <SideDrawer open={open} title="Ask for a letter" subtitle="Whoever prepares this letter is told. You hear back either way." onClose={() => setOpen(false)} formId="letter-ask-form" primaryLabel="Ask" primaryLoading={ask.isPending}>
        <Form id="letter-ask-form" form={form} layout="vertical" requiredMark={false} onFinish={(vals) => ask.mutate(vals)}>
          <Form.Item name="templateCode" label="Letter" rules={[{ required: true, message: "Choose a letter" }]}>
            <Select options={(options.data ?? []).map((o) => ({ value: o.code, label: o.name }))} />
          </Form.Item>
          <Form.Item name="purpose" label="What is it for?" rules={[{ required: true, min: 3, message: "A few words" }]}>
            <Input.TextArea rows={3} maxLength={300} />
          </Form.Item>
        </Form>
      </SideDrawer>
      <ConfirmModal open={!!withdrawing} onCancel={() => setWithdrawing(null)} onConfirm={() => withdrawing && withdraw.mutate(withdrawing.id)} loading={withdraw.isPending} title="Withdraw this ask?" description={withdrawing ? `${withdrawing.template}: ${withdrawing.purpose}` : undefined} confirmLabel="Withdraw" />
    </div>
  );
}
