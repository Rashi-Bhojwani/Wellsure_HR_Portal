import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Form, Input, InputNumber, Select, Upload } from "antd";
import type { UploadFile } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DOCUMENT_MIME_TYPES } from "@shared/constants/peopleDocuments";
import { apiErrorMessage } from "../../lib/apiError";
import { formatDateTime } from "../../lib/dates";
import { listEmployees } from "../../api/employee";
import { apiClient } from "../../api/client";
import { DataTable, EmptyState, PageHeader, Panel, QueryState, Stack, StatusChip, toast } from "../../ui";
import { space } from "../../theme/tokens";
import * as api from "./api";

// Document autofill (Peeps stage 2): upload a resume, identity or bank document privately; the local reader suggests values; an
// authorised reviewer confirms or corrects each field on the review page. Nothing is saved from a document automatically.

const KIND_LABEL: Record<api.DocKind, string> = { RESUME: "Resume (candidate)", IDENTITY: "Identity document (employee)", BANK: "Bank document (employee)" };
const STATUS_LABEL: Record<string, string> = { QUEUED: "Waiting", RUNNING: "Reading", DONE: "Ready to review", FAILED: "Enter by hand" };
const required = [{ required: true, message: "This field is required." }];

function SubjectPicker({ kind, value, onChange }: { kind: api.DocKind; value?: string; onChange?: (v: string) => void }) {
  const [q, setQ] = useState("");
  const employees = useQuery({ queryKey: ["autofill", "employees", q], queryFn: () => listEmployees({ search: q || undefined, pageSize: 20 }), enabled: kind !== "RESUME" });
  const candidates = useQuery({ queryKey: ["autofill", "candidates", q], queryFn: () => apiClient.get<{ items: Array<{ id: string; name: string }> }>("/api/recruitment/candidates", { params: { q } }).then((r) => r.data), enabled: kind === "RESUME" });
  const options = kind === "RESUME" ? (candidates.data?.items ?? []).map((c) => ({ value: c.id, label: c.name })) : (employees.data?.rows ?? []).map((e) => ({ value: e.id, label: `${e.fullName} (${e.employeeCode})` }));
  return <Select showSearch filterOption={false} onSearch={setQ} value={value} onChange={onChange} placeholder={kind === "RESUME" ? "Search candidates by name" : "Search employees"} loading={employees.isLoading || candidates.isLoading} options={options} />;
}

function UploadPanel({ status }: { status: api.Status }) {
  const [form] = Form.useForm();
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [file, setFile] = useState<File>();
  const navigate = useNavigate();
  const kinds = (["RESUME", "IDENTITY", "BANK"] as api.DocKind[]).filter((k) => (k === "RESUME" ? status.canResume : k === "IDENTITY" ? status.canIdentity : status.canBank));
  const kind = Form.useWatch("docKind", form) as api.DocKind | undefined;
  const work = useMutation({ mutationFn: (v: { docKind: api.DocKind; subjectId: string }) => api.upload(v.docKind === "RESUME" ? "CANDIDATE" : "EMPLOYEE", v.subjectId, v.docKind, file!), onSuccess: (r) => { toast.success("Uploaded. Reading the document…"); navigate(`/admin/autofill/${r.id}`); }, onError: (e) => toast.error(apiErrorMessage(e, "Could not upload this document.")) });
  if (!status.retentionSet) return <Panel title="Upload a document"><EmptyState title="Retention is Not set" description="A director must choose how long uploaded documents are kept before anyone can upload." compact /></Panel>;
  if (!kinds.length) return null;
  const types = (status.uploads?.allowedMimeTypes ?? []).map((m) => DOCUMENT_MIME_TYPES[m as keyof typeof DOCUMENT_MIME_TYPES]?.label ?? m).join(", ");
  return (
    <Panel title="Upload a document">
      <Form form={form} layout="vertical" onFinish={(v: { docKind: api.DocKind; subjectId: string }) => work.mutate(v)}>
        <Form.Item name="docKind" label="Kind of document" rules={required}><Select placeholder="Choose" options={kinds.map((k) => ({ value: k, label: KIND_LABEL[k] }))} onChange={() => form.setFieldValue("subjectId", undefined)} /></Form.Item>
        {kind && <Form.Item name="subjectId" label={kind === "RESUME" ? "Candidate" : "Employee"} rules={required}><SubjectPicker kind={kind} /></Form.Item>}
        <Upload.Dragger beforeUpload={(f) => { setFile(f); return false; }} maxCount={1} fileList={files} onChange={({ fileList }) => setFiles(fileList)} onRemove={() => { setFile(undefined); return true; }}>
          <p>Choose or drop the file</p>
          <p>{types}; up to {status.uploads?.maxMb} MB. Password-protected or unclear files can still be entered by hand.</p>
        </Upload.Dragger>
        <Button type="primary" htmlType="submit" disabled={!file} loading={work.isPending} style={{ marginTop: space[3] }}>Upload and read</Button>
      </Form>
    </Panel>
  );
}

function SettingsPanel() {
  const q = useQuery({ queryKey: ["autofill", "settings"], queryFn: api.settings });
  const client = useQueryClient();
  const [form] = Form.useForm();
  const [editing, setEditing] = useState<string | null>(null);
  const row = q.data?.settings.find((s) => s.key === editing);
  const work = useMutation({ mutationFn: (v: { value: unknown; reason: string }) => api.saveSetting(row!, v.value, v.reason), onSuccess: () => { void client.invalidateQueries({ queryKey: ["autofill"] }); setEditing(null); toast.success("Setting confirmed."); }, onError: (e) => toast.error(apiErrorMessage(e, "Could not save.")) });
  const label = (s: api.Setting) => (s.state === "DEFAULT" ? "Default, change in settings" : s.state === "NOT_SET" ? "Not set" : "Confirmed");
  return (
    <Panel title="Autofill settings">
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
        {q.data && (
          <Stack>
            <DataTable<api.Setting> rowKey="key" dataSource={q.data.settings} pagination={false}
              columns={[{ title: "Setting", dataIndex: "key", render: (k: string) => (k === "uploads" ? "File types and size" : "Retention") }, { title: "State", key: "s", render: (_: unknown, s: api.Setting) => <StatusChip>{label(s)}</StatusChip> }, ...(q.data.canEdit ? [{ title: "", key: "e", render: (_: unknown, s: api.Setting) => <Button onClick={() => { setEditing(s.key); form.setFieldsValue({ value: s.value }); }}>Choose</Button> }] : [])]}
              mobile={{ title: (s) => (s.key === "uploads" ? "File types and size" : "Retention"), status: (s) => <StatusChip>{label(s)}</StatusChip>, ...(q.data.canEdit ? { actions: (s: api.Setting) => <Button onClick={() => { setEditing(s.key); form.setFieldsValue({ value: s.value }); }}>Choose</Button> } : {}) }} />
            {row && (
              <Form form={form} layout="vertical" onFinish={(v: { value: unknown; reason: string }) => work.mutate(v)}>
                {row.key === "retention" ? <Form.Item name={["value", "days"]} label="Keep uploaded documents for (days)" rules={required}><InputNumber min={1} max={3650} precision={0} /></Form.Item> : <>
                  <Form.Item name={["value", "allowedMimeTypes"]} label="Allowed file types" rules={required}><Select mode="multiple" options={Object.entries(DOCUMENT_MIME_TYPES).map(([value, t]) => ({ value, label: t.label }))} /></Form.Item>
                  <Form.Item name={["value", "maxMb"]} label="Maximum size (MB)" rules={required}><InputNumber min={0.1} max={25} /></Form.Item>
                </>}
                <Form.Item name="reason" label="Reason for this setting change" rules={required}><Input.TextArea rows={2} maxLength={2000} /></Form.Item>
                <Button type="primary" htmlType="submit" loading={work.isPending}>Confirm setting</Button>
              </Form>
            )}
          </Stack>
        )}
      </QueryState>
    </Panel>
  );
}

export function AutofillPage() {
  const s = useQuery({ queryKey: ["autofill", "status"], queryFn: api.status });
  const list = useQuery({ queryKey: ["autofill", "list"], queryFn: api.list, enabled: Boolean(s.data && (s.data.canResume || s.data.canIdentity || s.data.canBank)), refetchInterval: 5000 });
  const allowed = s.data && (s.data.canResume || s.data.canIdentity || s.data.canBank || s.data.isDirector);
  return (
    <>
      <PageHeader title="Document autofill" subtitle="Suggestions from a document, confirmed field by field. Nothing is saved automatically." />
      <QueryState isLoading={s.isLoading} error={s.error} onRetry={() => void s.refetch()}>
        {s.data && (allowed ? (
          <Stack>
            <UploadPanel status={s.data} />
            {(s.data.canResume || s.data.canIdentity || s.data.canBank) && (
              <Panel title="Documents">
                <DataTable<api.Row> rowKey="id" dataSource={list.data?.items ?? []} loading={list.isLoading} error={list.error} onRetry={() => void list.refetch()} empty={<EmptyState title="No documents yet" compact />}
                  columns={[{ title: "Kind", dataIndex: "docKind", render: (k: api.DocKind) => KIND_LABEL[k] }, { title: "Uploaded", dataIndex: "createdAt", render: (v: string) => formatDateTime(v) }, { title: "State", key: "s", render: (_: unknown, r: api.Row) => <StatusChip>{r.applied ? "Saved" : STATUS_LABEL[r.status] ?? r.status}</StatusChip> }, { title: "", key: "o", render: (_: unknown, r: api.Row) => <Link to={`/admin/autofill/${r.id}`}>Review</Link> }]}
                  mobile={{ title: (r) => KIND_LABEL[r.docKind], subtitle: (r) => formatDateTime(r.createdAt), status: (r) => <StatusChip>{r.applied ? "Saved" : STATUS_LABEL[r.status] ?? r.status}</StatusChip>, actions: (r) => <Link to={`/admin/autofill/${r.id}`}>Review</Link> }} />
              </Panel>
            )}
            <SettingsPanel />
          </Stack>
        ) : <EmptyState kind="forbidden" title="No access" description="Autofill is for people who may review these documents' fields." />)}
      </QueryState>
    </>
  );
}
