import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Alert, Button, Input, Space } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiErrorMessage } from "../../lib/apiError";
import { CardGrid, ConfirmModal, DataTable, EmptyState, KeyValueGrid, PageHeader, Panel, QueryState, Skel, Stack, StatusChip, toast } from "../../ui";
import * as api from "./api";

// Review a document's suggestions beside the source document. Each field shows its suggestion, confidence, missing values and
// validation errors; only fields the reviewer is authorised for carry a value (the server decides). Saving goes through the
// existing change workflow (bank and statutory entries wait for a director while that setting is on).

const FAILURE: Record<string, string> = { PASSWORD_PROTECTED: "The document is password-protected.", POOR_QUALITY: "The document is too unclear to read.", UNSUPPORTED: "This file cannot be read automatically.", TIMEOUT: "Reading took too long.", EMPTY: "Nothing usable was found." };

function Source({ id, mimeType }: { id: string; mimeType: string }) {
  const q = useQuery({ queryKey: ["autofill", "source", id], queryFn: () => api.sourceFile(id), gcTime: 0, staleTime: Infinity });
  const url = useMemo(() => (q.data ? URL.createObjectURL(q.data) : null), [q.data]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return (
    <Panel title="Source document">
      {q.isLoading || !url ? <Skel h={420} /> : mimeType === "application/pdf" ? <iframe title="Source document" src={url} style={{ width: "100%", height: 560, border: 0 }} /> : <img alt="Source document" src={url} style={{ maxWidth: "100%" }} />}
    </Panel>
  );
}

function FieldRow({ docId, f, locked }: { docId: string; f: api.Field; locked: boolean }) {
  const client = useQueryClient();
  const [value, setValue] = useState(f.review?.value ?? f.suggestion?.value ?? "");
  const work = useMutation({ mutationFn: (d: { decision: "ACCEPTED" | "CORRECTED" | "REJECTED"; value?: string }) => api.review(docId, f.field, d.decision, d.value), onSuccess: (doc) => { client.setQueryData(["autofill", "doc", docId], doc); toast.success("Field reviewed."); }, onError: (e) => toast.error(apiErrorMessage(e, "Could not review this field.")) });
  if (!f.authorized) return <Panel title={f.label} extra={<StatusChip>Not yours to review</StatusChip>}><p>Another reviewer with this field's permission confirms it.</p></Panel>;
  const s = f.suggestion;
  return (
    <Panel title={f.label} extra={<StatusChip>{f.review ? (f.review.decision === "REJECTED" ? "Rejected" : f.review.decision === "CORRECTED" ? "Corrected" : "Confirmed") : s?.missing || !s ? "Missing" : "To review"}</StatusChip>}>
      <Stack>
        <KeyValueGrid items={[{ label: "Suggested", value: s?.value ?? "Not found" }, { label: "Confidence", value: s && !s.missing ? `${s.confidence}%` : "—" }, ...(s?.error ? [{ label: "Check", value: s.error }] : [])]} />
        {!locked && (
          <>
            <Input value={value} onChange={(e) => setValue(e.target.value)} maxLength={400} aria-label={`${f.label} value`} autoComplete="off" />
            <Space wrap>
              <Button disabled={!s?.value || Boolean(s.error)} loading={work.isPending} onClick={() => work.mutate({ decision: "ACCEPTED" })}>Confirm suggestion</Button>
              <Button loading={work.isPending} onClick={() => work.mutate({ decision: "CORRECTED", value })}>Save my correction</Button>
              <Button danger loading={work.isPending} onClick={() => work.mutate({ decision: "REJECTED" })}>Reject</Button>
            </Space>
          </>
        )}
      </Stack>
    </Panel>
  );
}

export function AutofillReviewPage() {
  const { id = "" } = useParams();
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["autofill", "doc", id], queryFn: () => api.document(id), refetchInterval: (query) => (["QUEUED", "RUNNING"].includes(query.state.data?.extraction.status ?? "") ? 2000 : false) });
  const [key] = useState(() => crypto.randomUUID());
  const [confirm, setConfirm] = useState(false);
  const rerun = useMutation({ mutationFn: () => api.rerun(id, key), onSuccess: () => void client.invalidateQueries({ queryKey: ["autofill", "doc", id] }), onError: (e) => toast.error(apiErrorMessage(e, "Could not read again.")) });
  const apply = useMutation({ mutationFn: () => api.apply(id), onSuccess: (r) => { setConfirm(false); void client.invalidateQueries({ queryKey: ["autofill"] }); toast.success(r.appliedVia === "HELD_FOR_DIRECTOR" ? "Sent for a director to confirm." : "Saved."); }, onError: (e) => toast.error(apiErrorMessage(e, "Could not save.")) });
  const d = q.data;
  return (
    <>
      <PageHeader title="Review document" back="/admin/autofill" actions={<Link to="/admin/autofill">All documents</Link>} />
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
        {d && (
          <Stack>
            <Alert type="info" showIcon message={d.notice} />
            {d.extraction.status === "FAILED" && <Alert type="warning" showIcon message={`${FAILURE[d.extraction.failureCode ?? ""] ?? "The document could not be read."} Enter the values by hand below.`} />}
            {["QUEUED", "RUNNING"].includes(d.extraction.status) && <Alert type="info" showIcon message="Reading the document…" />}
            {d.appliedAt && <Alert type="success" showIcon message={d.appliedVia === "HELD_FOR_DIRECTOR" ? "Values were sent for a director to confirm." : "Values were saved."} />}
            <CardGrid min={360}>
              <Source id={d.id} mimeType={d.mimeType} />
              <Stack>
                {d.fields.length ? d.fields.map((f) => <FieldRow key={`${f.field}-${f.review?.at ?? "none"}`} docId={d.id} f={f} locked={Boolean(d.appliedAt)} />) : <EmptyState title="No fields" compact />}
                {!d.appliedAt && (
                  <Space wrap>
                    <Button type="primary" onClick={() => setConfirm(true)}>Save reviewed values</Button>
                    <Button loading={rerun.isPending} disabled={["QUEUED", "RUNNING"].includes(d.extraction.status)} onClick={() => rerun.mutate()}>Read again</Button>
                  </Space>
                )}
              </Stack>
            </CardGrid>
            <Panel title="Provenance">
              <DataTable rowKey="k" pagination={false} dataSource={[{ k: "p", label: "Reader", value: `${d.provenance.provider ?? "—"} (${d.provenance.engine ?? "—"})` }, { k: "r", label: "Reads", value: String(d.provenance.runs) }, { k: "h", label: "File fingerprint", value: d.provenance.sha256.slice(0, 16) }]} columns={[{ title: "Item", dataIndex: "label" }, { title: "Value", dataIndex: "value" }]} mobile={{ title: (r: { label: string }) => r.label, subtitle: (r: { value: string }) => r.value }} />
            </Panel>
            <ConfirmModal open={confirm} title="Save the reviewed values?" description="Only confirmed or corrected fields are used. Bank and identity changes wait for a director while that setting is on." confirmLabel="Save" loading={apply.isPending} onCancel={() => setConfirm(false)} onConfirm={() => apply.mutate()} />
          </Stack>
        )}
      </QueryState>
    </>
  );
}
