import { useState } from "react";
import dayjs from "dayjs";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Select } from "antd";
import * as loansApi from "../../../api/loans";
import type { LoanChangeKind, LoanView } from "../../../api/loans";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatRupees } from "../../../lib/money";
import { DataTable, SideDrawer, StatusChip, toast } from "../../../ui";
import { fs, space, v } from "../../../theme/tokens";

// LC-07 (docs/plans/A_PARITY_ROWS.md): a sanctioned loan's changes on a screen. One director prepares a change (prepaid, waived, or stop the instalments still to come)
// with a reference; a different director approves or rejects it; nobody acts on their own loan (the API refuses). Rescheduling is not offered: it is not built.
const KIND: Record<LoanChangeKind, string> = { PREPAID: "Prepaid (paid back outside payroll)", WAIVED: "Waived", CANCEL_PENDING: "Stop the instalments still to come" };
const STATE: Record<string, { text: string; tone: "info" | "success" | "danger" | "neutral" }> = {
  PENDING: { text: "Waiting for the other director", tone: "info" },
  APPROVED: { text: "Approved", tone: "success" },
  CONSUMED: { text: "Approved", tone: "success" },
  REJECTED: { text: "Rejected", tone: "danger" },
  VOIDED: { text: "Voided", tone: "neutral" },
  NOT_ASKED: { text: "Not asked", tone: "neutral" },
};
type Change = LoanView["changes"][number];
interface ChangeForm { kind: LoanChangeKind; amount?: string; reference: string }

export function LoanChangesDrawer({ loan, onClose }: { loan: LoanView | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form] = Form.useForm<ChangeForm>();
  const kind = Form.useWatch("kind", form);
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["loans"] });
  const prepare = useMutation({
    mutationFn: (val: ChangeForm) => loansApi.requestLoanChange(loan!.id, { kind: val.kind, reference: val.reference, ...(val.kind !== "CANCEL_PENDING" ? { amount: val.amount } : {}) }),
    onSuccess: () => { toast.success("Prepared. A different director decides it."); form.resetFields(); refresh(); },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not prepare the change.")),
  });
  const decide = useMutation({
    mutationFn: ({ c, d }: { c: Change; d: "APPROVE" | "REJECT" }) => loansApi.decideLoanChange(loan!.id, c.id, d),
    onMutate: ({ c }) => setBusy(c.id),
    onSettled: () => setBusy(null),
    onSuccess: () => { toast.success("Decided."); refresh(); },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not decide.")),
  });
  return (
    <SideDrawer open={!!loan} onClose={onClose} title="Loan changes" subtitle={loan ? `${loan.name ?? ""} · ${loan.typeKey} · balance ${formatRupees(loan.balance, 2)}` : undefined} formId="loan-change-form" primaryLabel="Prepare the change" primaryLoading={prepare.isPending} size="wide">
      <DataTable<Change>
        rowKey="id"
        dataSource={loan?.changes ?? []}
        empty="No changes to this loan."
        pagination={false}
        mobile={{ title: (c) => KIND[c.kind as LoanChangeKind] ?? c.kind, subtitle: (c) => `${c.reference} · ${dayjs(c.createdAt).format("D MMM YYYY")}`, fields: [{ label: "State", render: (c: Change) => STATE[c.state ?? "NOT_ASKED"]?.text ?? c.state }] }}
        columns={[
          { title: "Change", key: "k", render: (_, c) => KIND[c.kind as LoanChangeKind] ?? c.kind },
          { title: "Amount", dataIndex: "amount", align: "right", render: (x: string | null) => (x ? formatRupees(x, 2) : "—") },
          { title: "Reference", dataIndex: "reference" },
          { title: "Prepared", dataIndex: "createdAt", render: (x: string) => dayjs(x).format("D MMM YYYY") },
          { title: "State", key: "s", render: (_, c) => { const s = STATE[c.state ?? "NOT_ASKED"] ?? STATE.NOT_ASKED!; return <StatusChip tone={s.tone}>{s.text}</StatusChip>; } },
          {
            title: "",
            key: "a",
            render: (_, c) =>
              c.state === "PENDING" && !c.preparedByMe ? (
                <div style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}>
                  <Button type="primary" loading={busy === c.id} onClick={() => decide.mutate({ c, d: "APPROVE" })}>Approve</Button>
                  <Button danger loading={busy === c.id} onClick={() => decide.mutate({ c, d: "REJECT" })}>Reject</Button>
                </div>
              ) : c.state === "PENDING" ? (
                <span style={{ color: v.textSecondary, fontSize: fs.sm }}>You prepared this</span>
              ) : null,
          },
        ]}
      />
      <h3 style={{ fontSize: fs.lg, margin: `${space[5]}px 0 ${space[3]}px` }}>Prepare a change</h3>
      <Form id="loan-change-form" form={form} layout="vertical" requiredMark={false} onFinish={(val) => prepare.mutate(val)}>
        <Form.Item name="kind" label="What changes" rules={[{ required: true, message: "Choose the change" }]}>
          <Select options={(Object.keys(KIND) as LoanChangeKind[]).map((k) => ({ value: k, label: KIND[k] }))} />
        </Form.Item>
        {kind && kind !== "CANCEL_PENDING" && (
          <Form.Item name="amount" label="Amount (₹)" rules={[{ required: true, pattern: /^\d+(\.\d{1,2})?$/, message: "Digits, up to two decimals" }]}>
            <Input inputMode="decimal" />
          </Form.Item>
        )}
        <Form.Item name="reference" label="Reference" extra="Where it comes from: a receipt, an approval note." rules={[{ required: true, min: 3, max: 300, message: "At least three characters" }]}>
          <Input />
        </Form.Item>
      </Form>
    </SideDrawer>
  );
}
