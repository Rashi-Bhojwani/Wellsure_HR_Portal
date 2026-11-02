import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMutation } from "@tanstack/react-query";
import { Button, Upload } from "antd";
import * as taxApi from "../../../api/tax";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate } from "../../../lib/dates";
import { formatRupees } from "../../../lib/money";
import { ApprovalBanner, DataTable, EmptyState, PageHeader, Panel, SkeletonCard, Stack, StatusChip, toast } from "../../../ui";
import { Caption } from "../../../components/payroll/payrollUi";

// Salary > Proof Of Investment. For each line the person declared: upload the proof while the window is open and see what the director decided (accepted with the amount verified, or rejected
// with the reason). Only the person's own; the file is opened through a short-lived link.
export function ProofOfInvestmentPage() {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["tax", "me"], queryFn: () => taxApi.myTax() });
  const d = q.data;
  const open = d?.windows.proof.state === "OPEN";
  const upload = useMutation({
    mutationFn: ({ section, file }: { section: string; file: File }) => taxApi.uploadMyProof(d!.year, section, file),
    onSuccess: () => { toast.success("Uploaded. A director will look at it."); void queryClient.invalidateQueries({ queryKey: ["tax", "me"] }); },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not upload that file.")),
  });
  const lines = (d?.declaration?.lines ?? []).filter((l) => Number(l.amount) > 0); // allow-number: only to hide a zero line on screen
  const label = (code: string) => d?.sections.find((s) => s.code === code)?.label ?? code;
  const needsProof = (code: string) => d?.sections.find((s) => s.code === code)?.proofRequired ?? true;
  return (
    <>
      <PageHeader title="Proof Of Investment" subtitle={d ? `Financial year ${d.year}` : "Your proofs for the year"} />
      <Stack>
        {q.isLoading && <SkeletonCard lines={4} />}
        {q.error && <ApprovalBanner tone="danger" title="Could not load your proofs" description={apiErrorMessage(q.error, "Try again in a moment.")} />}
        {d && (
          <>
            <ApprovalBanner tone={open ? "info" : "warning"} title={d.windows.proof.state === "OPEN" ? `The proof window is open until ${formatDate(d.windows.proof.closesOn!)}` : d.windows.proof.state === "NOT_SET" ? "The directors have not opened the proof window yet" : d.windows.proof.state === "NOT_OPEN_YET" ? `The proof window opens on ${formatDate(d.windows.proof.opensOn!)}` : `The proof window closed on ${formatDate(d.windows.proof.closesOn!)}`} description="After the window closes, only the amounts a director has verified count towards your tax." />
            <Panel title="Your declared lines" subtitle="Upload a proof for each line that needs one">
              <DataTable<{ section: string; amount: string }>
                rowKey="section"
                density="compact"
                dataSource={lines}
                pagination={false}
                empty={<EmptyState compact title="Nothing declared yet" description="Declare an amount under IT Declaration first; a proof belongs to a declared line." />}
                mobile={{ title: (l) => label(l.section), subtitle: (l) => formatRupees(l.amount, 2), fields: [{ label: "Proof", render: (l) => (needsProof(l.section) ? "Needed" : "Not needed") }, { label: "Your proofs", render: (l) => <ProofList proofs={d.proofs.filter((p) => p.section === l.section)} /> }], actions: (l) => (needsProof(l.section) ? <Upload showUploadList={false} disabled={!open} beforeUpload={(file) => { upload.mutate({ section: l.section, file }); return false; }}><Button size="large" block disabled={!open} loading={upload.isPending}>Upload a proof</Button></Upload> : null) }}
                columns={[
                  { title: "Section", key: "s", render: (_, l) => label(l.section) },
                  { title: "Declared", key: "a", align: "right", render: (_, l) => <span className="ws-num">{formatRupees(l.amount, 2)}</span> },
                  { title: "Proofs", key: "p", render: (_, l) => <ProofList proofs={d.proofs.filter((p) => p.section === l.section)} /> },
                  { title: "", key: "u", align: "right", render: (_, l) => (needsProof(l.section) ? <Upload showUploadList={false} disabled={!open} beforeUpload={(file) => { upload.mutate({ section: l.section, file }); return false; }}><Button disabled={!open} loading={upload.isPending}>Upload a proof</Button></Upload> : <Caption>Not needed</Caption>) },
                ]}
              />
            </Panel>
          </>
        )}
      </Stack>
    </>
  );
}

function ProofList({ proofs }: { proofs: taxApi.ProofView[] }) {
  if (proofs.length === 0) return <Caption>None yet</Caption>;
  return (
    <div>
      {proofs.map((p) => (
        <div key={p.id}>
          <Button type="link" size="small" onClick={() => void taxApi.myProofLink(p.id).then((r) => window.open(r.url))}>{p.fileName}</Button>{" "}
          {p.decision === null ? <StatusChip tone="warning">Waiting</StatusChip> : p.decision.decision === "ACCEPTED" ? <StatusChip tone="success">{`Verified ${formatRupees(p.decision.amountVerified ?? "0", 2)}`}</StatusChip> : <StatusChip tone="danger">Rejected</StatusChip>}
          {p.decision?.decision === "REJECTED" && <Caption>{p.decision.reason}</Caption>}
        </div>
      ))}
    </div>
  );
}
