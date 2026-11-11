import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { Button, Upload } from "antd";
import type { UploadFile } from "antd";
import { DOCUMENT_MIME_TYPES } from "@shared/constants/peopleDocuments";
import { AuthShell } from "../../pages/auth/AuthShell";
import { EmptyState, Panel, SkeletonCard, Stack, StatusChip, toast } from "../../ui";
import type { PublicJoining } from "./offersApi";

// Public joiner upload page (no sign-in). It shows only the documents to upload and the link's expiry: no name, offer, job
// or company detail. Plain fetch, never the signed-in API client: no cookie, token or refresh is involved.

const base = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:4000";

async function call(path: string, init?: RequestInit) {
  const r = await fetch(`${base}/api/joining/${path}`, { credentials: "omit", ...init });
  const body = (await r.json().catch(() => ({}))) as { message?: string; error?: { message?: string } } & Partial<PublicJoining>;
  if (!r.ok) throw Object.assign(new Error(body.error?.message ?? body.message ?? "Request failed"), { status: r.status });
  return body as PublicJoining;
}

function DocumentRow({ token, doc, onDone }: { token: string; doc: PublicJoining["documents"][number]; onDone: (d: PublicJoining) => void }) {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const types = doc.allowedMimeTypes.map((m) => DOCUMENT_MIME_TYPES[m as keyof typeof DOCUMENT_MIME_TYPES]?.label ?? m).join(", ");
  const send = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      onDone(await call(`${encodeURIComponent(token)}/documents/${encodeURIComponent(doc.code)}`, { method: "POST", body: form }));
      toast.success(`${doc.label} uploaded.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title={doc.label} extra={<StatusChip>{doc.uploaded ? "Uploaded" : "Needed"}</StatusChip>}>
      {doc.uploaded ? <p>Received. Thank you.</p> : (
        <Stack>
          <Upload.Dragger beforeUpload={(f) => { setFile(f); return false; }} maxCount={1} fileList={files} onChange={({ fileList }) => setFiles(fileList)} onRemove={() => { setFile(undefined); return true; }}>
            <p>Choose or drop the file</p>
            <p>{types}; up to {doc.maxMb} MB.</p>
          </Upload.Dragger>
          <Button type="primary" disabled={!file} loading={busy} onClick={() => void send()}>Upload {doc.label}</Button>
        </Stack>
      )}
    </Panel>
  );
}

export function JoinerUploadPage() {
  const { token = "" } = useParams();
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["joining-public", token], queryFn: () => call(encodeURIComponent(token)), retry: false, gcTime: 0 });
  const status = (q.error as (Error & { status?: number }) | null)?.status;
  const gone = status === 404 || status === 410;
  const done = Boolean(q.data?.documents.every((d) => d.uploaded));
  return (
    <AuthShell title="Joining documents" subtitle="Upload the documents requested for your joining." width={560}>
      {q.isLoading && <SkeletonCard />}
      {gone && <EmptyState kind="forbidden" title="Link not available" description="This link is no longer valid. Ask the company for a new one." />}
      {q.error && !gone && <EmptyState kind="error" title="Could not open this page" onRetry={() => void q.refetch()} />}
      {q.data && (done ? <EmptyState title="All documents received" description="You can close this page." /> : (
        <Stack>
          <p>This page is only for uploading the documents below. It closes once everything is received.</p>
          {q.data.documents.map((d) => <DocumentRow key={d.code} token={token} doc={d} onDone={(data) => client.setQueryData(["joining-public", token], data)} />)}
        </Stack>
      ))}
    </AuthShell>
  );
}
