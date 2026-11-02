import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input } from "antd";
import * as payrollApi from "../../api/payroll";
import type { BankRejectionRow, RepaymentPlanView } from "../../api/payroll";
import { apiErrorMessage } from "../../lib/apiError";
import { formatDate } from "../../lib/dates";
import { ApprovalBanner, ConfirmModal, DataTable, EmptyState, Panel, Stack, StatusChip, toast } from "../../ui";
import { Caption, Num, PersonCell } from "./payrollUi";
import { CheckersNote } from "./CheckersNote";
import { space } from "../../theme/tokens";

// Bank rejections and paying them again (Stage 5b). Directors only. A rejected row stays unpaid until a repayment file, approved like the bank file, is made for it.
export function BankRepaymentCard({ batchId }: { batchId: string }) {
  const queryClient = useQueryClient();
  const [recording, setRecording] = useState(false);
  const [planDate, setPlanDate] = useState("");
  const [planId, setPlanId] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["payroll", "bank-rejections", batchId], queryFn: () => payrollApi.bankRejections(batchId) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["payroll", "bank-rejections", batchId] });
  const plan = useMutation({
    mutationFn: () => payrollApi.planRepayment(batchId, planDate),
    onSuccess: (p) => { setPlanId(p.id); refresh(); },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not plan it.")),
  });
  const rows = q.data?.rows ?? [];
  const waiting = rows.filter((r) => r.repaidInBatch === null);
  return (
    <>
      <Panel title="Rows the bank rejected" subtitle="They stay unpaid until a repayment file is made. Directors only.">
        <Stack>
          <div style={{ display: "flex", flexWrap: "wrap", gap: space[3] }}>
            <Button onClick={() => setRecording(true)}>Enter a rejection</Button>
          </div>
          <DataTable<BankRejectionRow>
            rowKey="rowId"
            density="compact"
            loading={q.isLoading}
            error={q.error}
            onRetry={() => void q.refetch()}
            dataSource={rows}
            pagination={false}
            empty={<EmptyState compact title="No rejected rows" description="When the bank rejects a payment, enter it here, one row per payment, with the reason." />}
            mobile={{ title: (r) => r.name, subtitle: (r) => `${r.employeeCode} · …${r.accountLast4}`, status: (r) => <StatusChip tone={r.repaidInBatch ? "success" : "warning"}>{r.repaidInBatch ? "Paid again" : "Unpaid"}</StatusChip>, fields: [{ label: "Amount", render: (r) => r.amount }, { label: "Why", render: (r) => r.reason }] }}
            columns={[
              { title: "Employee", key: "who", render: (_, r) => <PersonCell name={r.name} code={`${r.employeeCode} · …${r.accountLast4}`} /> },
              { title: "Amount", key: "amount", align: "right", render: (_, r) => <Num>{r.amount}</Num> },
              { title: "Why", key: "why", render: (_, r) => <div>{r.reason}<Caption>Entered {formatDate(r.at)}</Caption></div> },
              { title: "Status", key: "status", render: (_, r) => <StatusChip tone={r.repaidInBatch ? "success" : "warning"}>{r.repaidInBatch ? "Paid again" : "Unpaid"}</StatusChip> },
            ]}
          />
          {waiting.length > 0 && (
            <Form layout="inline" component="div" style={{ gap: space[3], flexWrap: "wrap" }}>
              <Form.Item label="Pay again on" htmlFor="rp-date"><Input id="rp-date" inputMode="numeric" maxLength={10} placeholder="YYYY-MM-DD" value={planDate} onChange={(e) => setPlanDate(e.target.value)} style={{ width: 160 }} /></Form.Item>
              <Button type="primary" disabled={!/^\d{4}-\d{2}-\d{2}$/.test(planDate)} loading={plan.isPending} onClick={() => plan.mutate()}>Plan a repayment of {waiting.length}</Button>
            </Form>
          )}
        </Stack>
      </Panel>
      {recording && <RecordDialog batchId={batchId} onClose={() => setRecording(false)} onDone={refresh} />}
      {planId && <PlanDialog planId={planId} onClose={() => setPlanId(null)} onChanged={refresh} />}
    </>
  );
}

function RecordDialog({ batchId, onClose, onDone }: { batchId: string; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [code, ...rest] = l.split(","); return { employeeCode: (code ?? "").trim(), reason: rest.join(",").trim() }; });
  const ok = lines.length > 0 && lines.every((l) => l.employeeCode && l.reason.length >= 3);
  const save = useMutation({ mutationFn: () => payrollApi.recordBankRejections(batchId, lines), onSuccess: (r) => { toast.success(`Recorded ${r.recorded}.`); onDone(); onClose(); }, onError: (e) => setProblem(apiErrorMessage(e, "Could not save.")) });
  return (
    <ConfirmModal open title="Enter rejected payments" description="One per line: the employee code, a comma, and the bank's reason." confirmLabel="Record" cancelLabel="Cancel" confirmDisabled={!ok} loading={save.isPending} onCancel={onClose} onConfirm={() => save.mutate()}>
      <Form layout="vertical" component="div" requiredMark={false}>
        <Form.Item htmlFor="rr-text" validateStatus={problem ? "error" : undefined} help={problem ?? undefined} style={{ marginBottom: 0 }}><Input.TextArea id="rr-text" rows={5} value={text} onChange={(e) => { setText(e.target.value); setProblem(null); }} /></Form.Item>
      </Form>
    </ConfirmModal>
  );
}

function PlanDialog({ planId, onClose, onChanged }: { planId: string; onClose: () => void; onChanged: () => void }) {
  const q = useQuery({ queryKey: ["payroll", "repayment-plan", planId], queryFn: () => payrollApi.getRepaymentPlan(planId) });
  const [problem, setProblem] = useState<string | null>(null);
  const done = () => { void q.refetch(); onChanged(); };
  const fail = (e: unknown) => setProblem(apiErrorMessage(e, "Could not do that."));
  const p: RepaymentPlanView | undefined = q.data;
  const request = useMutation({ mutationFn: () => payrollApi.requestRepayment(planId, p!.hash), onSuccess: done, onError: fail });
  const decide = useMutation({ mutationFn: (d: "APPROVE" | "REJECT") => payrollApi.decideRepayment(planId, d, p!.hash, d === "REJECT" ? "Not approved" : undefined), onSuccess: done, onError: fail });
  const generate = useMutation({ mutationFn: () => payrollApi.generateRepayment(planId), onSuccess: (r) => { toast.success(`Repayment file made: ${r.rows} rows.`); done(); }, onError: fail });
  return (
    <ConfirmModal open title="Repayment plan" description={p ? `Pay again on ${formatDate(p.paymentDate)}, to each person's account in force that day.` : "Loading…"} confirmLabel="Close" cancelLabel="" onCancel={onClose} onConfirm={onClose} width={640}>
      <Stack>
        {problem && <ApprovalBanner tone="danger" title={problem} />}
        {p && (
          <>
            <div>{p.rows.length} {p.rows.length === 1 ? "row" : "rows"}, total <Num strong>{p.total}</Num></div>
            {p.rows.map((r) => <div key={r.serial}>{r.name} ({r.employeeCode}) …{r.accountLast4} · {r.ifsc} · <Num>{r.amount}</Num></div>)}
            {p.excluded.length > 0 && <ApprovalBanner tone="warning" title="Left out" description={p.excluded.map((e) => `${e.employeeCode}: ${e.reason}`).join("; ")} />}
            {!p.layoutReady && <ApprovalBanner tone="warning" title="The bank file layout is not confirmed" />}
            <CheckersNote checkers={p.checkers} what="this repayment" />
            <div style={{ display: "flex", flexWrap: "wrap", gap: space[3] }}>
              {!p.approval && !p.generated && <Button type="primary" disabled={p.rows.length === 0} loading={request.isPending} onClick={() => request.mutate()}>Ask for approval</Button>}
              {p.approval?.status === "PENDING" && <><Button type="primary" loading={decide.isPending} onClick={() => decide.mutate("APPROVE")}>Approve</Button><Button danger onClick={() => decide.mutate("REJECT")}>Reject</Button></>}
              {p.approval?.status === "APPROVED" && !p.generated && <Button type="primary" loading={generate.isPending} onClick={() => generate.mutate()}>Make the repayment file</Button>}
              {p.generated && <Button onClick={() => void payrollApi.repaymentFileLink(p.generated!).then((r) => window.open(r.url))}>Download the file</Button>}
            </div>
          </>
        )}
      </Stack>
    </ConfirmModal>
  );
}
