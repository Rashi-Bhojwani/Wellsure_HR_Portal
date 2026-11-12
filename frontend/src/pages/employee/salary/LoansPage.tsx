import { useState } from "react";
import dayjs from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Form, Input, InputNumber, Select } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import * as loansApi from "../../../api/loans";
import type { LoanView } from "../../../api/loans";
import { RECOVERY_LABEL } from "../../../lib/loanRecovery";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatRupees } from "../../../lib/money";
import { DataTable, EmptyState, PageHeader, Panel, SideDrawer, SkeletonCard, Stack, StatusChip, toast } from "../../../ui";

// Salary > Loans and Advances (P7-4): the person's own loans, their schedule and balance, and asking for one of a kind the directors allow. Money is paid and
// recovered only through payroll runs; the balance is read from what was paid and recovered, never stored.
const STATUS: Record<LoanView["status"], { text: string; tone: "info" | "success" | "neutral" | "danger" }> = {
  DRAFT: { text: "Asked, not yet sanctioned", tone: "info" },
  WAITING: { text: "Waiting for a director", tone: "info" },
  SANCTIONED: { text: "Sanctioned", tone: "success" },
  REJECTED: { text: "Not sanctioned", tone: "danger" },
};
const STATE_TEXT: Record<string, string> = { PENDING: "To come", CONSUMED: "Recovered", CANCELLED: "Cancelled", NOT_SANCTIONED: "—" };

export function LoansPage() {
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);
  const [form] = Form.useForm<{ typeKey: string; principal: string; instalments: number; firstMonth: dayjs.Dayjs; purpose: string }>();
  const q = useQuery({ queryKey: ["loans", "mine"], queryFn: loansApi.myLoans });
  const ask = useMutation({
    mutationFn: (v: { typeKey: string; principal: string; instalments: number; firstMonth: dayjs.Dayjs; purpose: string }) => loansApi.askForLoan({ ...v, firstMonth: v.firstMonth.startOf("month").format("YYYY-MM-DD") }),
    onSuccess: () => {
      toast.success("Asked. A director looks at it next.");
      setAsking(false);
      form.resetFields();
      void queryClient.invalidateQueries({ queryKey: ["loans", "mine"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not send it.")),
  });
  const requestable = q.data?.requestable ?? [];
  return (
    <>
      <PageHeader title="Loans and Advances" subtitle="Your loans, what is left to recover, and asking for one" actions={requestable.length > 0 ? <Button type="primary" icon={<PlusOutlined />} onClick={() => setAsking(true)}>Ask for a loan</Button> : undefined} />
      <Stack>
        {q.isLoading && <SkeletonCard lines={4} />}
        {q.data && q.data.loans.length === 0 && <EmptyState title="No loans" description={requestable.length ? "You can ask for one." : "There is no kind of loan you can ask for yet."} />}
        {(q.data?.loans ?? []).map((l) => (
          <Panel key={l.id} title={`${l.typeKey} · ${formatRupees(l.principal, 2)}`} subtitle={`${l.instalments} instalments from ${dayjs(l.firstMonth).format("MMM YYYY")} · balance ${formatRupees(l.balance, 2)}`} extra={l.recovery && RECOVERY_LABEL[l.recovery] ? <StatusChip tone={RECOVERY_LABEL[l.recovery]!.tone}>{RECOVERY_LABEL[l.recovery]!.text}</StatusChip> : <StatusChip tone={STATUS[l.status].tone}>{STATUS[l.status].text}</StatusChip>}>
            <DataTable<LoanView["schedule"][number]>
              rowKey="n"
              density="compact"
              dataSource={l.schedule}
              pagination={false}
              columns={[
                { title: "Month", dataIndex: "month", render: (x: string) => dayjs(x).format("MMM YYYY") },
                { title: "Principal part", dataIndex: "principal", align: "right", render: (x: string) => <span className="ws-num">{formatRupees(x, 2)}</span> },
                { title: "Interest part", dataIndex: "interest", align: "right", render: (x: string) => <span className="ws-num">{formatRupees(x, 2)}</span> },
                { title: "", dataIndex: "state", render: (x: string) => STATE_TEXT[x] ?? x },
              ]}
            />
          </Panel>
        ))}
      </Stack>
      <SideDrawer open={asking} title="Ask for a loan" subtitle="A director prepares it and a different director sanctions it." onClose={() => setAsking(false)} formId="loan-form" primaryLabel="Send" primaryLoading={ask.isPending}>
        <Form id="loan-form" form={form} layout="vertical" requiredMark={false} onFinish={(v) => ask.mutate(v)}>
          <Form.Item name="typeKey" label="Kind" rules={[{ required: true, message: "Choose a kind" }]}>
            <Select options={requestable.map((t) => ({ value: t.typeKey, label: `${t.name} (up to ${formatRupees(t.maxAmount, 0)}, ${t.maxInstalments} instalments, ${t.ratePercent}% a year)` }))} />
          </Form.Item>
          <Form.Item name="principal" label="Amount (₹)" rules={[{ required: true, pattern: /^\d+(\.\d{1,2})?$/, message: "Digits, up to two decimals" }]}>
            <Input inputMode="decimal" />
          </Form.Item>
          <Form.Item name="instalments" label="Instalments" rules={[{ required: true, message: "How many months" }]}>
            <InputNumber min={1} max={600} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="firstMonth" label="Recovery starts in" rules={[{ required: true, message: "Choose a month" }]}>
            <DatePicker picker="month" disabledDate={(x) => x.isBefore(dayjs(), "month")} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="purpose" label="What it is for" rules={[{ required: true, min: 3, message: "A few words" }]}>
            <Input.TextArea rows={2} maxLength={300} />
          </Form.Item>
        </Form>
      </SideDrawer>
    </>
  );
}
