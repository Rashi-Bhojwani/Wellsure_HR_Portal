import { useState } from "react";
import { Button, DatePicker, Form, Input, Radio, Select, Space, Typography } from "antd";
import type { Dayjs } from "dayjs";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { formatDateTime } from "../../lib/dates";
import { apiErrorMessage } from "../../lib/apiError";
import { ConfirmModal, DataTable, EmptyState, KeyValueGrid, Panel, QueryState, SideDrawer, Stack, StatusChip, toast } from "../../ui";
import { required } from "./helpers";
import { useRecruitmentQuery as useQuery } from "./useRecruitmentQuery";
import { useWork } from "./useWork";
import * as offersApi from "./offersApi";

// C-4B joining: HR onboarding (default ON) and the directors. Required document types, link lifetime and the exception approver
// are director settings, Not set until chosen: the actions they gate stay disabled with the reason shown.

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

function Convert({ offerId, onClose }: { offerId: string; onClose: () => void }) {
  const pre = useQuery({ queryKey: ["recruitment", "conversion", offerId], queryFn: () => offersApi.prefill(offerId) });
  const designations = useQuery({ queryKey: ["recruitment", "designations"], queryFn: () => apiClient.get<Array<{ id: string; name: string }>>("/api/org/designations").then((r) => r.data) });
  const [form] = Form.useForm();
  const [key] = useState(() => crypto.randomUUID());
  const work = useWork<{ employeeId: string; employeeCode: string; created: boolean }>((r) => { toast.success(r.created ? `Employee ${r.employeeCode} created.` : `Already converted: ${r.employeeCode}.`); onClose(); });
  const capture = Form.useWatch("attendanceCapture", form) as string | undefined;
  return (
    <SideDrawer open title="Convert to employee" size="wide" onClose={onClose} primaryLabel="Create employee" primaryLoading={work.isPending} onPrimary={() => form.submit()}>
      <QueryState isLoading={pre.isLoading} error={pre.error} onRetry={() => void pre.refetch()}>
        {pre.data && (pre.data.convertedEmployeeId ? <p>This candidate has already joined.</p> : (
          <Form key={key} form={form} layout="vertical" initialValues={{ attendanceCapture: "MANUAL", personal: { personalEmail: pre.data.email ?? "", mobile: pre.data.phone ?? "" } }}
            onFinish={(v: { employeeCode: string; designationId: string; attendanceCapture: "DEVICE" | "MANUAL"; deviceUserId?: string; officialEmail?: string; personal: Record<string, unknown> & { dateOfBirth: Dayjs } }) =>
              work.mutate(() => offersApi.convert(offerId, { employeeCode: v.employeeCode, designationId: v.designationId, attendanceCapture: v.attendanceCapture, ...(v.deviceUserId ? { deviceUserId: v.deviceUserId } : {}), officialEmail: v.officialEmail || null, personal: { ...v.personal, dateOfBirth: v.personal.dateOfBirth.format("YYYY-MM-DD") } }))}>
            <KeyValueGrid items={[{ label: "Name", value: pre.data.fullName }]} />
            <p>Role, department, location, manager, employment type and joining date come from the accepted offer. Pay is never copied. Bank and identity details are added afterwards on the employee profile.</p>
            <Form.Item name="employeeCode" label="Employee code" rules={required}><Input maxLength={30} /></Form.Item>
            <Form.Item name="designationId" label="Designation" rules={required}><Select placeholder="Choose designation" loading={designations.isLoading} options={designations.data?.map((d) => ({ value: d.id, label: d.name }))} /></Form.Item>
            <Form.Item name="attendanceCapture" label="Attendance capture" rules={required}><Radio.Group options={[{ value: "DEVICE", label: "Biometric device" }, { value: "MANUAL", label: "Marked manually" }]} /></Form.Item>
            {capture === "DEVICE" && <Form.Item name="deviceUserId" label="Device user ID" rules={required}><Input maxLength={30} /></Form.Item>}
            <Form.Item name="officialEmail" label="Official email (optional)" rules={[{ type: "email" }]}><Input maxLength={320} /></Form.Item>
            <Form.Item name={["personal", "dateOfBirth"]} label="Date of birth" rules={required}><DatePicker style={{ width: "100%" }} /></Form.Item>
            <Form.Item name={["personal", "gender"]} label="Gender" rules={required}><Select options={[{ value: "MALE", label: "Male" }, { value: "FEMALE", label: "Female" }, { value: "OTHER", label: "Other" }]} /></Form.Item>
            <Form.Item name={["personal", "personalEmail"]} label="Personal email" rules={required}><Input maxLength={320} /></Form.Item>
            <Form.Item name={["personal", "mobile"]} label="Mobile" rules={required}><Input maxLength={20} /></Form.Item>
            <Form.Item name={["personal", "currentAddress"]} label="Current address" rules={required}><Input.TextArea maxLength={300} rows={2} /></Form.Item>
            <Form.Item name={["personal", "permanentAddress"]} label="Permanent address" rules={required}><Input.TextArea maxLength={300} rows={2} /></Form.Item>
            <Form.Item name={["personal", "emergencyContactName"]} label="Emergency contact name" rules={required}><Input maxLength={150} /></Form.Item>
            <Form.Item name={["personal", "emergencyContactPhone"]} label="Emergency contact phone" rules={required}><Input maxLength={20} /></Form.Item>
            <Form.Item name={["personal", "emergencyContactRelation"]} label="Relationship" rules={required}><Input maxLength={50} /></Form.Item>
          </Form>
        ))}
      </QueryState>
    </SideDrawer>
  );
}

export function JoiningSection({ candidateId }: { candidateId: string }) {
  const q = useQuery({ queryKey: ["recruitment", "joining", candidateId], queryFn: () => offersApi.joining(candidateId) });
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [revoke, setRevoke] = useState<string | null>(null);
  const [exceptionFor, setExceptionFor] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [form] = Form.useForm();
  const work = useWork(() => { setRevoke(null); setExceptionFor(null); form.resetFields(); toast.success("Joining updated."); });
  const create = useWork<{ url: string; expiresAt: string }>((r) => setLink(r));
  const download = useMutation({ mutationFn: (doc: { id: string; code: string }) => offersApi.downloadJoiningDocument(doc.id).then((blob) => save(blob, `joining-${doc.code.toLowerCase()}`)), onError: (e) => toast.error(apiErrorMessage(e, "Could not open this document.")) });
  return (
    <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
      {q.data && (
        <Stack>
          <Panel title="Joining documents" extra={<StatusChip>{q.data.offer.convertedEmployeeId ? "Joined" : q.data.complete ? "Complete" : "Pending"}</StatusChip>}>
            {!q.data.settings.typesSet ? <p>Required joining documents are Not set. A director must list them in Recruitment settings.</p> : (
              <DataTable rowKey="code" dataSource={q.data.required} pagination={false}
                columns={[
                  { title: "Document", dataIndex: "label" },
                  { title: "State", key: "state", render: (_: unknown, r: offersApi.Joining["required"][number]) => <StatusChip>{r.uploaded ? "Uploaded" : r.exception ? "Exception granted" : "Missing"}</StatusChip> },
                  { title: "Action", key: "action", render: (_: unknown, r: offersApi.Joining["required"][number]) => <Space wrap>{r.uploaded && q.data!.canManage && <Button loading={download.isPending} onClick={() => download.mutate({ id: r.uploaded!.id, code: r.code })}>Download</Button>}{!r.uploaded && !r.exception && q.data!.isApprover && <Button onClick={() => setExceptionFor(r.code)}>Grant exception</Button>}</Space> },
                ]}
                mobile={{ title: (r) => r.label, status: (r) => <StatusChip>{r.uploaded ? "Uploaded" : r.exception ? "Exception granted" : "Missing"}</StatusChip>, actions: (r) => <Space wrap>{r.uploaded && q.data!.canManage && <Button onClick={() => download.mutate({ id: r.uploaded!.id, code: r.code })}>Download</Button>}{!r.uploaded && !r.exception && q.data!.isApprover && <Button onClick={() => setExceptionFor(r.code)}>Grant exception</Button>}</Space> }} />
            )}
            {!q.data.settings.approverSet && <p>The exception approver is Not set. Missing documents cannot be excused until a director chooses one.</p>}
            {downloadNote}
          </Panel>
          {q.data.canManage && !q.data.offer.convertedEmployeeId && (
            <Panel title="Joining link">
              {!q.data.settings.lifetimeSet || !q.data.settings.typesSet ? <p>Link lifetime and required documents must both be chosen by a director before a link can be created.</p> : (
                <Stack>
                  <p>The link opens an upload page for the listed documents only. It needs no sign-in, expires, and can be revoked. Creating a new link revokes the previous one.</p>
                  <Button type="primary" loading={create.isPending} onClick={() => create.mutate(() => offersApi.createLink(candidateId))}>Create joining link</Button>
                  {link && <Panel title="Copy this link now"><Typography.Paragraph copyable={{ text: link.url }} style={{ wordBreak: "break-all" }}>{link.url}</Typography.Paragraph><p>It is shown only once. Expires {formatDateTime(link.expiresAt)}.</p></Panel>}
                </Stack>
              )}
              {q.data.links.length > 0 && (
                <DataTable rowKey="id" dataSource={q.data.links} pagination={false}
                  columns={[
                    { title: "Created", dataIndex: "createdAt", render: (v: string) => formatDateTime(v) },
                    { title: "Expires", dataIndex: "expiresAt", render: (v: string) => formatDateTime(v) },
                    { title: "State", key: "s", render: (_: unknown, l: offersApi.Joining["links"][number]) => <StatusChip>{l.active ? "Active" : l.revokedAt ? "Revoked" : l.completedAt ? "Used" : "Expired"}</StatusChip> },
                    { title: "Action", key: "a", render: (_: unknown, l: offersApi.Joining["links"][number]) => (l.active ? <Button danger onClick={() => setRevoke(l.id)}>Revoke</Button> : null) },
                  ]}
                  mobile={{ title: (l) => formatDateTime(l.createdAt), status: (l) => <StatusChip>{l.active ? "Active" : l.revokedAt ? "Revoked" : l.completedAt ? "Used" : "Expired"}</StatusChip>, actions: (l) => (l.active ? <Button danger onClick={() => setRevoke(l.id)}>Revoke</Button> : null) }} />
              )}
            </Panel>
          )}
          {q.data.canManage && (
            <Panel title="Conversion">
              {q.data.offer.convertedEmployeeId ? <p>Converted to an employee.</p> : q.data.complete ? <Button type="primary" onClick={() => setConverting(true)}>Convert to employee</Button> : <EmptyState title="Joining checks pending" description="Every required document must be uploaded or excused first." compact />}
            </Panel>
          )}
          <ConfirmModal open={Boolean(revoke)} title="Revoke this link?" description="The candidate will no longer be able to upload through it." confirmLabel="Revoke link" danger loading={work.isPending} onCancel={() => setRevoke(null)} onConfirm={() => work.mutate(() => offersApi.revokeLink(revoke!))} />
          <ConfirmModal open={Boolean(exceptionFor)} title="Grant an exception?" confirmLabel="Grant exception" loading={work.isPending} onCancel={() => setExceptionFor(null)} onConfirm={() => form.submit()}>
            <Form form={form} layout="vertical" onFinish={(v: { reason: string }) => work.mutate(() => offersApi.grantException(candidateId, exceptionFor!, v.reason))}>
              <Form.Item name="reason" label="Reason (no pay figures)" rules={required}><Input.TextArea maxLength={500} rows={2} /></Form.Item>
            </Form>
          </ConfirmModal>
          {converting && <Convert offerId={q.data.offer.id} onClose={() => setConverting(false)} />}
        </Stack>
      )}
    </QueryState>
  );
}
const downloadNote = <p>Identity and bank documents are restricted: HR onboarding and the directors may open them, and every opening is recorded.</p>;
