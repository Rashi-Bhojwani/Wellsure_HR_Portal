import { useState } from "react";
import dayjs from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Segmented } from "antd";
import * as api from "../../../api/reimbursements";
import type { ClaimView } from "../../../api/reimbursements";
import { apiErrorMessage } from "../../../lib/apiError";
import { ClaimStatement } from "../../../components/payroll/ClaimStatement";
import { formatRupees } from "../../../lib/money";
import { ConfirmModal, DataTable, PageHeader, StatusChip, toast } from "../../../ui";
import { space } from "../../../theme/tokens";
import { WRAP_TEXT as WRAP } from "../../../ui/textStyles";

// Payroll > Reimbursements (P7-5), directors only: approve the amount or a lower one (with a reason), or reject with a reason; never one's own claim. Caps are checked
// on approval. Claim types are set through the API in this release.
export function ReimbursementsAdminPage() {
  const queryClient = useQueryClient();
  const [show, setShow] = useState<"SUBMITTED" | "ALL">("SUBMITTED");
  const [deciding, setDeciding] = useState<{ c: ClaimView; decision: "APPROVE" | "REJECT" } | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const q = useQuery({ queryKey: ["claims", "queue", show], queryFn: () => api.claimQueue(show) });
  const decide = useMutation({
    mutationFn: () => api.decideClaim(deciding!.c.id, { decision: deciding!.decision, ...(amount.trim() ? { amount: amount.trim() } : {}), ...(reason.trim() ? { reason: reason.trim() } : {}) }),
    onSuccess: () => {
      toast.success("Decided.");
      setDeciding(null);
      setAmount("");
      setReason("");
      void queryClient.invalidateQueries({ queryKey: ["claims"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not decide.")),
  });
  return (
    <>
      <PageHeader title="Reimbursements" subtitle="Claims waiting for a director. An approved claim is paid by the next payroll run." />
      <div style={{ marginBottom: space[4] }}>
        <Segmented aria-label="Show" value={show} onChange={(x) => setShow(x as typeof show)} options={[{ value: "SUBMITTED", label: "Waiting" }, { value: "ALL", label: "All" }]} />
      </div>
      <DataTable<ClaimView>
        rowKey="id"
        loading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        dataSource={q.data ?? []}
        empty="Nothing waiting."
        pagination={{ pageSize: 25 }}
        columns={[
          { title: "Employee", dataIndex: "name" },
          { title: "Kind", dataIndex: "typeKey" },
          { title: "Spent on", dataIndex: "spentOn", render: (x: string) => dayjs(x).format("D MMM YYYY") },
          { title: "Amount", dataIndex: "amount", align: "right", render: (x: string) => formatRupees(x, 2) },
          { title: "What for", dataIndex: "description", width: 320, render: (t: string) => <span style={WRAP}>{t}</span> },
          { title: "Bills", dataIndex: "bills", render: (b: string[]) => (b.length ? b.join(", ") : "—") },
          { title: "State", dataIndex: "status", render: (x: string) => <StatusChip status={x} /> },
          {
            title: "",
            key: "act",
            fixed: "right" as const,
            render: (_, c) =>
              c.status === "SUBMITTED" ? (
                <div style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}>
                  <Button type="primary" onClick={() => setDeciding({ c, decision: "APPROVE" })}>Approve</Button>
                  <Button danger onClick={() => setDeciding({ c, decision: "REJECT" })}>Reject</Button>
                </div>
              ) : null,
          },
        ]}
      />
      <ConfirmModal
        open={!!deciding}
        title={deciding?.decision === "APPROVE" ? "Approve this claim?" : "Reject this claim?"}
        description={deciding?.decision === "APPROVE" ? "Leave the amount empty to approve what was claimed; a lower amount needs a reason. It is paid by the next payroll run." : "Say why; the person sees it."}
        confirmLabel={deciding?.decision === "APPROVE" ? "Approve" : "Reject"}
        confirmDisabled={deciding?.decision === "REJECT" && reason.trim().length < 3}
        loading={decide.isPending}
        onCancel={() => setDeciding(null)}
        onConfirm={() => decide.mutate()}
      >
        {deciding?.decision === "APPROVE" && <Input aria-label="Amount" inputMode="decimal" placeholder={`Amount (claimed ${deciding.c.amount})`} value={amount} onChange={(e) => setAmount(e.target.value)} style={{ marginTop: space[2] }} />}
        <Input.TextArea aria-label="Reason" placeholder="Reason" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} style={{ marginTop: space[2] }} />
      </ConfirmModal>
      <ClaimStatement scope="month" />
    </>
  );
}
