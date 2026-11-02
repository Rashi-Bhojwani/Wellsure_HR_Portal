import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Radio } from "antd";
import { financialYearOf } from "@shared/utils/financialYear";
import * as taxApi from "../../../api/tax";
import type { QueueProof, WindowView } from "../../../api/tax";
import { Caption, PersonCell } from "../../../components/payroll/payrollUi";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate } from "../../../lib/dates";
import { formatRupees } from "../../../lib/money";
import { space } from "../../../theme/tokens";
import { ApprovalBanner, DataTable, EmptyState, PageHeader, Panel, SideDrawer, Stack, StatusChip, toast } from "../../../ui";

// Payroll > Tax declarations. Directors only (HR sees none of it). The windows when people may declare and send proofs, who has declared, and the proofs to verify. Nobody verifies their own proof.
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const stateText = (w: WindowView) => (w.state === "NOT_SET" ? "Not set: closed" : w.state === "NOT_OPEN_YET" ? "Opens later" : w.state === "OPEN" ? "Open" : "Closed");

export function TaxDeclarationsPage() {
  const [year, setYear] = useState(financialYearOf(new Date().toISOString().slice(0, 10)).label);
  const [deciding, setDeciding] = useState<QueueProof | null>(null);
  const queryClient = useQueryClient();
  const windows = useQuery({ queryKey: ["tax", "windows", year], queryFn: () => taxApi.windows(year), retry: false });
  const list = useQuery({ queryKey: ["tax", "declarations", year], queryFn: () => taxApi.declarations(year), retry: false });
  const proofs = useQuery({ queryKey: ["tax", "proofs", year], queryFn: () => taxApi.proofQueue(year), retry: false });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["tax"] });
  return (
    <>
      <PageHeader title="Tax declarations" subtitle="Windows, declarations and the proofs to verify" />
      <Stack>
        <ApprovalBanner tone="info" title="Only directors see this" description="HR, managers and the Developer role do not. Employees see only their own declaration and proofs." />
        <Panel title="Financial year">
          <Form layout="inline" component="div"><Form.Item label="Year" htmlFor="td-year"><Input id="td-year" value={year} maxLength={7} onChange={(e) => setYear(e.target.value)} style={{ width: 120 }} placeholder="2026-27" /></Form.Item></Form>
          {windows.error && <ApprovalBanner tone="warning" title="That is not a financial year" description={apiErrorMessage(windows.error, "Write it like 2026-27.")} />}
        </Panel>
        {windows.data && (
          <Panel title="Windows" subtitle="Nobody can declare or send a proof outside its window. Not set means closed.">
            <WindowRow year={year} w={windows.data.declaration} label="Declarations" onDone={refresh} />
            <WindowRow year={year} w={windows.data.proof} label="Proofs (the cut-off after which only verified amounts count)" onDone={refresh} />
          </Panel>
        )}
        <Panel title="Declarations" subtitle="The latest version of each person's">
          <DataTable<taxApi.DeclarationRow>
            rowKey="employeeCode"
            density="compact"
            loading={list.isLoading}
            error={list.error}
            onRetry={() => void list.refetch()}
            dataSource={list.data?.declarations ?? []}
            pagination={false}
            empty={<EmptyState compact title="Nobody has declared" description="Declarations appear here once people send them." />}
            mobile={{ title: (r) => r.name, subtitle: (r) => r.employeeCode, fields: [{ label: "Regime", render: (r) => (r.regime === "NEW" ? "New" : "Old") }, { label: "Total", render: (r) => formatRupees(r.total, 2) }] }}
            columns={[
              { title: "Employee", key: "p", render: (_, r) => <PersonCell name={r.name} code={r.employeeCode} /> },
              { title: "Regime", key: "r", render: (_, r) => (r.regime === "NEW" ? "New" : "Old") },
              { title: "Declared in total", key: "t", align: "right", render: (_, r) => <span className="ws-num">{formatRupees(r.total, 2)}</span> },
              { title: "Version", key: "v", render: (_, r) => `${r.version} · ${formatDate(r.submittedAt)}` },
            ]}
          />
        </Panel>
        <Panel title="Proofs" subtitle="Accept with the amount the proof verifies, or reject with a reason">
          <DataTable<QueueProof>
            rowKey="id"
            density="compact"
            loading={proofs.isLoading}
            error={proofs.error}
            onRetry={() => void proofs.refetch()}
            dataSource={proofs.data?.proofs ?? []}
            pagination={false}
            empty={<EmptyState compact title="No proofs" description="Proofs appear here once people upload them." />}
            mobile={{ title: (p) => p.name, subtitle: (p) => `${p.employeeCode} · ${p.section}`, status: (p) => <StatusChip tone={p.decision ? (p.decision.decision === "ACCEPTED" ? "success" : "danger") : "warning"}>{p.decision ? (p.decision.decision === "ACCEPTED" ? "Verified" : "Rejected") : "Waiting"}</StatusChip>, fields: [{ label: "Declared", render: (p) => formatRupees(p.declared, 2) }, { label: "File", render: (p) => <Button type="link" size="small" onClick={() => void taxApi.proofLink(p.id).then((r) => window.open(r.url))}>{p.fileName}</Button> }], actions: (p) => <Button size="large" block onClick={() => setDeciding(p)}>{p.decision ? "Decide again" : "Decide"}</Button> }}
            columns={[
              { title: "Employee", key: "p", render: (_, p) => <PersonCell name={p.name} code={p.employeeCode} /> },
              { title: "Section", key: "s", render: (_, p) => p.section },
              { title: "Declared", key: "d", align: "right", render: (_, p) => <span className="ws-num">{formatRupees(p.declared, 2)}</span> },
              { title: "File", key: "f", render: (_, p) => <Button type="link" size="small" onClick={() => void taxApi.proofLink(p.id).then((r) => window.open(r.url))}>{p.fileName}</Button> },
              { title: "Decision", key: "x", render: (_, p) => (p.decision ? <div><StatusChip tone={p.decision.decision === "ACCEPTED" ? "success" : "danger"}>{p.decision.decision === "ACCEPTED" ? `Verified ${formatRupees(p.decision.amountVerified ?? "0", 2)}` : "Rejected"}</StatusChip>{p.decision.reason && <Caption>{p.decision.reason}</Caption>}</div> : <StatusChip tone="warning">Waiting</StatusChip>) },
              { title: "", key: "a", align: "right", render: (_, p) => <Button size="small" onClick={() => setDeciding(p)}>{p.decision ? "Decide again" : "Decide"}</Button> },
            ]}
          />
        </Panel>
      </Stack>
      {deciding && <DecideDrawer proof={deciding} onClose={() => setDeciding(null)} onDone={refresh} />}
    </>
  );
}

function WindowRow({ year, w, label, onDone }: { year: string; w: WindowView; label: string; onDone: () => void }) {
  const [opens, setOpens] = useState(w.opensOn ?? "");
  const [closes, setCloses] = useState(w.closesOn ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation({ mutationFn: () => taxApi.setWindow({ fy: year, kind: w.kind, opensOn: opens, closesOn: closes }), onSuccess: () => { toast.success("Window saved."); setProblem(null); onDone(); }, onError: (e) => setProblem(apiErrorMessage(e, "Could not save.")) });
  return (
    <div style={{ marginBottom: space[4] }}>
      <div style={{ marginBottom: space[2] }}>{label} <StatusChip tone={w.state === "OPEN" ? "success" : "warning"}>{stateText(w)}</StatusChip></div>
      <div style={{ display: "flex", gap: space[3], flexWrap: "wrap", alignItems: "center" }}>
        <Input aria-label={`${label}: opens`} addonBefore="Opens" value={opens} maxLength={10} placeholder="YYYY-MM-DD" onChange={(e) => setOpens(e.target.value)} style={{ width: 240, maxWidth: "100%" }} />
        <Input aria-label={`${label}: closes`} addonBefore="Closes" value={closes} maxLength={10} placeholder="YYYY-MM-DD" onChange={(e) => setCloses(e.target.value)} style={{ width: 240, maxWidth: "100%" }} />
        <Button disabled={!ISO.test(opens) || !ISO.test(closes)} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
      </div>
      {problem && <Caption>{problem}</Caption>}
    </div>
  );
}

function DecideDrawer({ proof, onClose, onDone }: { proof: QueueProof; onClose: () => void; onDone: () => void }) {
  const [decision, setDecision] = useState<"ACCEPTED" | "REJECTED" | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const ready = decision === "ACCEPTED" ? /^\d{1,12}(\.\d{1,6})?$/.test(amount) : decision === "REJECTED" ? reason.trim().length >= 3 : false;
  const save = useMutation({
    mutationFn: () => taxApi.decideProof(proof.id, decision === "ACCEPTED" ? { decision, amountVerified: amount, reason: reason.trim() } : { decision: "REJECTED", reason: reason.trim() }),
    onSuccess: () => { toast.success("Recorded."); onDone(); onClose(); },
    onError: (e) => setProblem(apiErrorMessage(e, "Could not record it.")),
  });
  return (
    <SideDrawer open title={`${proof.name}: ${proof.section}`} subtitle={`Declared ${formatRupees(proof.declared, 2)}`} onClose={onClose}
      footer={<div style={{ display: "flex", gap: space[3], width: "100%" }}><Button size="large" style={{ flex: 1 }} onClick={onClose}>Cancel</Button><Button size="large" type="primary" style={{ flex: 1 }} disabled={!ready} loading={save.isPending} onClick={() => save.mutate()}>Save decision</Button></div>}>
      <Form layout="vertical" component="div" requiredMark={false}>
        <Form.Item label="Decision" htmlFor="pd-decision"><Radio.Group id="pd-decision" value={decision} onChange={(e) => setDecision(e.target.value as "ACCEPTED" | "REJECTED")} options={[{ value: "ACCEPTED", label: "Accept" }, { value: "REJECTED", label: "Reject" }]} /></Form.Item>
        {decision === "ACCEPTED" && <Form.Item label="Amount the proof verifies (₹)" htmlFor="pd-amount" help="It may be less than was declared, never more."><Input id="pd-amount" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setProblem(null); }} /></Form.Item>}
        {decision !== null && <Form.Item label={decision === "REJECTED" ? "Why" : "Note (optional)"} htmlFor="pd-reason" validateStatus={problem ? "error" : undefined} help={problem ?? undefined}><Input.TextArea id="pd-reason" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></Form.Item>}
      </Form>
    </SideDrawer>
  );
}
