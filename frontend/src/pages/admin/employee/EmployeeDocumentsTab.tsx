import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Popconfirm, Select, Switch, Tooltip, Upload } from "antd";
import { DeleteOutlined, DownloadOutlined, EyeInvisibleOutlined, EyeOutlined, FileTextOutlined, PlusOutlined, UndoOutlined, UploadOutlined } from "@ant-design/icons";
import { DOCUMENT_MIME_TYPES } from "@shared/constants/peopleDocuments";
import * as docsApi from "../../../api/documents";
import { apiErrorMessage } from "../../../lib/apiError";
import { IssuedLetters } from "../../../components/letters/IssuedLetters";
import { useAuth } from "../../../hooks/useAuth";
import { DataTable, SideDrawer, StatusChip, toast } from "../../../ui";
import { Dropzone } from "../import/Dropzone";
import { fs, fw, radius, space, v } from "../../../theme/tokens";
import { ProfileSection, SectionStack } from "./ProfileLayout";

const ACCEPT = Object.values(DOCUMENT_MIME_TYPES).flatMap((t) => t.extensions).join(",");

// Employee profile → Documents (spec §7.2): HR-held files for one employee.
// "Visible to employee" puts a document in their Document Center (and
// notifies them); anything else stays HR-only. Every download from here is
// audit-logged server-side.
export function EmployeeDocumentsTab({ employeeId, canManage }: { employeeId: string; canManage: boolean }) {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [form] = Form.useForm();
  const queryKey = ["documents", "employee", employeeId];
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey, queryFn: () => docsApi.listEmployeeDocuments(employeeId) });
  const { data: categories = [] } = useQuery({
    queryKey: ["documents", "categories", "EMPLOYEE"],
    queryFn: () => docsApi.listCategories({ appliesTo: "EMPLOYEE" }),
    enabled: canManage,
  });
  // A file dropped on the empty state opens the upload drawer with it chosen.
  const chooseFile = (f: File) => {
    setFile(f);
    if (!form.getFieldValue("title")) form.setFieldValue("title", f.name.replace(/\.[^.]+$/, ""));
  };
  const invalidate = () => void queryClient.invalidateQueries({ queryKey });

  const upload = useMutation({
    mutationFn: (values: { title: string; categoryId: string; visibleToEmployee: boolean }) => docsApi.uploadEmployeeDocument(employeeId, file!, values),
    onSuccess: (doc) => {
      toast.success(doc.visibleToEmployee ? "Uploaded — the employee has been notified." : "Uploaded (HR only).");
      invalidate();
      setUploadOpen(false);
      setFile(null);
      form.resetFields();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't upload that document.")),
  });
  const update = useMutation({
    mutationFn: ({ id, ...input }: { id: string; visibleToEmployee?: boolean }) => docsApi.updateEmployeeDocument(id, input),
    onSuccess: invalidate,
    onError: (err) => toast.error(apiErrorMessage(err, "That didn't work.")),
  });
  const archive = useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) => docsApi.setEmployeeDocumentArchived(id, archived),
    onSuccess: invalidate,
    onError: (err) => toast.error(apiErrorMessage(err, "That didn't work.")),
  });

  const download = async (d: docsApi.EmployeeDocument) => {
    try {
      docsApi.startDownload(await docsApi.downloadEmployeeDocument(d.id));
    } catch (err) {
      toast.error(apiErrorMessage(err, "Couldn't download that document."));
    }
  };
  const square = (bg: string) => ({ background: bg, color: v.textInverse, border: 0, borderRadius: radius.xs });

  return (
    <SectionStack>
      {(hasPermission("letters.generate") || hasPermission("letters.issue.nopay")) && (
        <ProfileSection title="Letters">
          <IssuedLetters employeeId={employeeId} />
        </ProfileSection>
      )}
      <ProfileSection
        title="Personal documents"
        extra={
          canManage && data.length > 0 ? (
            <Tooltip title="Upload document">
              <Button type="text" icon={<PlusOutlined />} aria-label="Upload document" onClick={() => setUploadOpen(true)} />
            </Tooltip>
          ) : undefined
        }
      >
        {canManage && !isLoading && !error && data.length === 0 ? (
          <Dropzone
            accept={ACCEPT}
            compact
            hint="or select a file from your computer. No documents on file yet."
            onFile={(f) => {
              chooseFile(f);
              setUploadOpen(true);
            }}
          />
        ) : (
          <DataTable<docsApi.EmployeeDocument>
            rowKey="id"
            loading={isLoading}
            error={error}
            onRetry={() => void refetch()}
            dataSource={data}
            pagination={false}
            empty={<div style={{ padding: space[6], textAlign: "center", color: v.textSecondary }}>No documents on file.</div>}
            columns={[
              {
                title: "Document name",
                key: "title",
                render: (_, d) => (
                  <div style={{ display: "flex", alignItems: "center", gap: space[3] }}>
                    <FileTextOutlined aria-hidden style={{ color: v.textSecondary, fontSize: fs.xl }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: fw.semibold, color: v.textPrimary, textDecoration: d.archivedAt ? "line-through" : undefined }}>{d.title}</div>
                      <div style={{ fontSize: fs.sm, color: v.textSecondary }}>
                        {d.fileName} · {docsApi.formatBytes(d.sizeBytes)}
                      </div>
                    </div>
                  </div>
                ),
              },
              { title: "Category", key: "category", render: (_, d) => d.category.name },
              {
                title: "Employee can see it",
                key: "visible",
                render: (_, d) =>
                  canManage && !d.archivedAt ? (
                    <Switch
                      checked={d.visibleToEmployee}
                      checkedChildren={<EyeOutlined />}
                      unCheckedChildren={<EyeInvisibleOutlined />}
                      onChange={(visibleToEmployee) => update.mutate({ id: d.id, visibleToEmployee })}
                      aria-label={`Visible to employee: ${d.title}`}
                    />
                  ) : d.visibleToEmployee ? (
                    "Yes"
                  ) : (
                    "No"
                  ),
              },
              { title: "Uploaded", key: "uploaded", render: (_, d) => new Date(d.uploadedAt).toLocaleDateString("en-IN") },
              { title: "Status", key: "status", render: (_, d) => (d.archivedAt ? <StatusChip tone="neutral">Archived</StatusChip> : <StatusChip tone="success">Current</StatusChip>) },
              {
                title: "Action",
                key: "actions",
                render: (_, d) => (
                  <div style={{ display: "flex", gap: space[2] }}>
                    <Tooltip title={`Download ${d.title}`}>
                      <Button icon={<DownloadOutlined />} aria-label={`Download ${d.title}`} onClick={() => void download(d)} style={square(v.edit)} />
                    </Tooltip>
                    {canManage &&
                      (d.archivedAt ? (
                        <Tooltip title="Restore">
                          <Button icon={<UndoOutlined />} aria-label={`Restore ${d.title}`} onClick={() => archive.mutate({ id: d.id, archived: false })} style={square(v.view)} />
                        </Tooltip>
                      ) : (
                        <Popconfirm title="Archive this document?" description="It's hidden, not deleted." onConfirm={() => archive.mutate({ id: d.id, archived: true })}>
                          <Tooltip title="Archive">
                            <Button icon={<DeleteOutlined />} aria-label={`Archive ${d.title}`} style={square(v.danger)} />
                          </Tooltip>
                        </Popconfirm>
                      ))}
                  </div>
                ),
              },
            ]}
            mobile={{
              title: (d) => d.title,
              subtitle: (d) => `${d.fileName} · ${docsApi.formatBytes(d.sizeBytes)}`,
              status: (d) => (d.archivedAt ? <StatusChip tone="neutral">Archived</StatusChip> : <StatusChip tone="success">Current</StatusChip>),
              fields: [
                { label: "Category", render: (d) => d.category.name },
                { label: "Employee can see it", render: (d) => (d.visibleToEmployee ? "Yes" : "No") },
              ],
              actions: (d) => (
                <>
                  <Button icon={<DownloadOutlined />} onClick={() => void download(d)}>
                    Download
                  </Button>
                  {canManage && !d.archivedAt && (
                    <Button icon={d.visibleToEmployee ? <EyeInvisibleOutlined /> : <EyeOutlined />} onClick={() => update.mutate({ id: d.id, visibleToEmployee: !d.visibleToEmployee })}>
                      {d.visibleToEmployee ? "Hide from employee" : "Show to employee"}
                    </Button>
                  )}
                  {canManage &&
                    (d.archivedAt ? (
                      <Button onClick={() => archive.mutate({ id: d.id, archived: false })}>Restore</Button>
                    ) : (
                      <Popconfirm title="Archive this document?" description="It's hidden, not deleted." onConfirm={() => archive.mutate({ id: d.id, archived: true })}>
                        <Button danger>Archive</Button>
                      </Popconfirm>
                    ))}
                </>
              ),
            }}
          />
        )}
      </ProfileSection>
      <SideDrawer
        title="Upload a document"
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        formId="employee-doc-upload"
        primaryLabel="Upload"
        primaryDisabled={!file}
        primaryLoading={upload.isPending}
      >
        <Form id="employee-doc-upload" form={form} layout="vertical" requiredMark={false} initialValues={{ visibleToEmployee: true }} onFinish={(vals) => upload.mutate(vals)}>
          <Form.Item label="File" required>
            <Upload
              accept={ACCEPT}
              maxCount={1}
              beforeUpload={(f) => {
                chooseFile(f);
                return false;
              }}
              onRemove={() => setFile(null)}
              fileList={file ? [{ uid: "1", name: file.name, status: "done" }] : []}
            >
              <Button icon={<UploadOutlined />}>Choose file</Button>
            </Upload>
          </Form.Item>
          <Form.Item name="title" label="Title" rules={[{ required: true }]}>
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item name="categoryId" label="Category" rules={[{ required: true }]}>
            {/* Only categories the uploader can read back (PAY needs pay-document access, STATUTORY statutory). */}
            <Select options={categories.filter((c) => c.readable).map((c) => ({ value: c.id, label: c.name }))} />
          </Form.Item>
          <Form.Item name="visibleToEmployee" label="Employee can see it" valuePropName="checked" extra="On: it appears in their Document Center and they're notified. Off: HR only.">
            <Switch />
          </Form.Item>
        </Form>
      </SideDrawer>
    </SectionStack>
  );
}
