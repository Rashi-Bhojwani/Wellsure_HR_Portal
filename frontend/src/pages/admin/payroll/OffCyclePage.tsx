import { useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Form } from "antd";
import * as api from "../../../api/offcycle";
import type { OffCycleCandidate, OffCycleRun } from "../../../api/offcycle";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatRupees } from "../../../lib/money";
import { DataTable, PageHeader, Panel, SideDrawer, StatusChip, toast } from "../../../ui";
import { space } from "../../../theme/tokens";
import { WRAP_TEXT as WRAP } from "../../../ui/textStyles";

const KIND_LABEL: Record<api.OffCycleKind, string> = { SETTLEMENT: "Final settlement", HELD_PAY: "Held pay" };

// Payroll > Off-cycle runs (P7-6b), directors only: pays a confirmed settlement or held pay outside the monthly run, on the same road (one director prepares, the
// owners' run-approval choice decides, somebody other than the approver finalises; the bank file under the bank-file choice). Nothing is paid twice.
export function OffCyclePage() {
  const queryClient = useQueryClient();
  const [preparing, setPreparing] = useState<OffCycleCandidate | null>(null);
  const [date, setDate] = useState<Dayjs | null>(null);
  const cands = useQuery({ queryKey: ["offcycle", "candidates"], queryFn: api.listCandidates });
  const runs = useQuery({ queryKey: ["offcycle", "runs"], queryFn: api.listOffCycle });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["offcycle"] });
  const act = useMutation({
    mutationFn: async ({ r, what }: { r: OffCycleRun; what: "ask" | "approve" | "reject" | "finalise" | "askBank" | "approveBank" | "rejectBank" | "file" | "download" | "sent" }) => {
      if (what === "ask") return api.askApproval(r.id, r.fingerprint);
      if (what === "approve" || what === "reject") return api.decide(r.id, r.fingerprint, what === "approve" ? "APPROVE" : "REJECT");
      if (what === "finalise") return api.finalise(r.id);
      if (what === "askBank") return api.askBank(r.id, r.bankFingerprint);
      if (what === "approveBank" || what === "rejectBank") return api.decideBank(r.id, r.bankFingerprint, what === "approveBank" ? "APPROVE" : "REJECT");
      if (what === "file") return api.writeBankFile(r.id);
      if (what === "download") return api.downloadBankFile(r.file!.id).then((d) => window.open(d.url));
      return api.markSent(r.file!.id);
    },
    onSuccess: () => { toast.success("Done."); refresh(); },
    onError: (err) => toast.error(apiErrorMessage(err, "That did not work.")),
  });
  const prepare = useMutation({
    mutationFn: () => api.prepareOffCycle({ kind: preparing!.kind, sourceRef: preparing!.sourceRef, paymentDate: date!.format("YYYY-MM-DD") }),
    onSuccess: () => { toast.success("Prepared."); setPreparing(null); setDate(null); refresh(); },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not prepare it.")),
  });
  const actions = (r: OffCycleRun) => {
    const b = (label: string, what: Parameters<typeof act.mutate>[0]["what"], primary = false) => <Button key={what} type={primary ? "primary" : "default"} loading={act.isPending} onClick={() => act.mutate({ r, what })}>{label}</Button>;
    const out = [];
    if (r.state === "PREPARED" || r.state === "REJECTED") out.push(b("Ask for approval", "ask"));
    if (r.state === "WAITING" && !r.approval?.mine) out.push(b("Approve", "approve", true), b("Reject", "reject"));
    if (r.state === "APPROVED" && !r.approval?.checkerIsMe) out.push(b("Finalise", "finalise", true));
    if (r.state === "FINALISED") {
      if (!r.bankApproval || r.bankApproval.status === "REJECTED") out.push(b("Ask for the bank file", "askBank"));
      if (r.bankApproval?.status === "PENDING" && !r.bankApproval.mine) out.push(b("Approve the bank file", "approveBank", true), b("Reject", "rejectBank"));
      if (r.bankApproval?.status === "APPROVED" && !r.bankApproval.checkerIsMe) out.push(b("Write the bank file", "file", true));
    }
    if (r.file) {
      out.push(b("Download", "download"));
      if (!r.file.sentToBank) out.push(b("Mark sent to the bank", "sent"));
    }
    return <div style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}>{out}</div>;
  };
  return (
    <>
      <PageHeader title="Off-cycle runs" subtitle="Pay a confirmed settlement or held pay outside the monthly run. Same approvals and bank file rules as a regular run; nothing is paid twice." />
      <Panel title="Ready to pay" style={{ marginBottom: space[4] }}>
        <DataTable<OffCycleCandidate>
          rowKey={(c) => `${c.kind}-${c.sourceRef}`}
          loading={cands.isLoading}
          error={cands.error}
          onRetry={() => void cands.refetch()}
          dataSource={cands.data ?? []}
          empty="Nothing is waiting to be paid off-cycle."
          pagination={false}
          mobile={{ title: (c) => c.employeeCode, subtitle: (c) => KIND_LABEL[c.kind], fields: [{ label: "Amount", render: (c) => formatRupees(c.amount, 2) }], actions: (c) => <Button size="large" block onClick={() => setPreparing(c)}>Prepare</Button> }}
          columns={[
            { title: "Employee", dataIndex: "employeeCode" },
            { title: "What", key: "k", render: (_, c) => `${KIND_LABEL[c.kind]}: ${c.label}` },
            { title: "Amount", key: "a", align: "right", render: (_, c) => formatRupees(c.amount, 2) },
            { title: "", key: "act", fixed: "right" as const, render: (_, c) => <Button onClick={() => setPreparing(c)}>Prepare</Button> },
          ]}
        />
      </Panel>
      <Panel title="Off-cycle runs">
        <DataTable<OffCycleRun>
          rowKey="id"
          loading={runs.isLoading}
          error={runs.error}
          onRetry={() => void runs.refetch()}
          dataSource={runs.data ?? []}
          empty="No off-cycle runs yet."
          pagination={{ pageSize: 20 }}
          mobile={{ title: (r) => r.name, subtitle: (r) => `${KIND_LABEL[r.kind]} · ${dayjs(r.paymentDate).format("D MMM YYYY")}`, status: (r) => <StatusChip status={r.state} />, fields: [{ label: "Net", render: (r) => formatRupees(r.net, 2) }], actions: (r) => actions(r) }}
          expandable={{
            expandedRowRender: (r) => (
              <DataTable<OffCycleRun["lines"][number]>
                rowKey={(l) => `${l.source}-${l.label}`}
                density="compact"
                dataSource={r.lines}
                pagination={false}
                columns={[
                  { title: "Line", dataIndex: "label" },
                  { title: "Amount", key: "a", align: "right", render: (_, l) => formatRupees(l.amount, 2) },
                  { title: "Source", dataIndex: "source", width: 280, render: (t: string) => <span style={WRAP}>{t}</span> },
                ]}
              />
            ),
          }}
          columns={[
            { title: "Employee", dataIndex: "name" },
            { title: "What", key: "k", render: (_, r) => KIND_LABEL[r.kind] },
            { title: "Payment date", dataIndex: "paymentDate", render: (x: string) => dayjs(x).format("D MMM YYYY") },
            { title: "Net", key: "n", align: "right", render: (_, r) => formatRupees(r.net, 2) },
            { title: "State", key: "s", render: (_, r) => <StatusChip status={r.state} /> },
            { title: "", key: "act", fixed: "right" as const, render: (_, r) => actions(r) },
          ]}
        />
      </Panel>
      <SideDrawer open={!!preparing} title={preparing ? `${KIND_LABEL[preparing.kind]} for ${preparing.employeeCode}` : ""} subtitle="The lines are copied from the confirmed source. Choose the date the bank should pay it." onClose={() => setPreparing(null)} formId="offcycle-form" primaryLabel="Prepare" primaryLoading={prepare.isPending}>
        <Form id="offcycle-form" layout="vertical" requiredMark={false} onFinish={() => prepare.mutate()}>
          <Form.Item label="Payment date" required validateStatus={date ? undefined : "error"} help={date ? undefined : "Choose a date (today or later)"}>
            <DatePicker aria-label="Payment date" value={date} onChange={setDate} format="D MMM YYYY" disabledDate={(d) => d.isBefore(dayjs(), "day")} style={{ width: "100%" }} />
          </Form.Item>
          <p>Amount: {preparing ? formatRupees(preparing.amount, 2) : ""}</p>
        </Form>
      </SideDrawer>
    </>
  );
}
