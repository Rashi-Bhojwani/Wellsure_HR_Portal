import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Typography, Upload, message } from "antd";
import { DownloadOutlined, EyeInvisibleOutlined, EyeOutlined, UploadOutlined } from "@ant-design/icons";
import { DOCUMENT_MIME_TYPES } from "@shared/constants/peopleDocuments";
import * as docsApi from "../../../api/documents";
import { apiErrorMessage } from "../../../lib/apiError";

const ACCEPT = Object.values(DOCUMENT_MIME_TYPES).flatMap((t) => t.extensions).join(",");

// Employee profile → Documents (spec §7.2): HR-held files for one employee.
// "Visible to employee" puts a document in their Document Center (and
// notifies them); anything else stays HR-only. Every download from here is
// audit-logged server-side.
export function EmployeeDocumentsTab({ employeeId, canManage }: { employeeId: string; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [form] = Form.useForm();
  const queryKey = ["documents", "employee", employeeId];
  const { data = [], isLoading } = useQuery({ queryKey, queryFn: () => docsApi.listEmployeeDocuments(employeeId) });
  const { data: categories = [] } = useQuery({
    queryKey: ["documents", "categories", "EMPLOYEE"],
    queryFn: () => docsApi.listCategories({ appliesTo: "EMPLOYEE" }),
    enabled: canManage,
  });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey });

  const upload = useMutation({
    mutationFn: (values: { title: string; categoryId: string; visibleToEmployee: boolean }) => docsApi.uploadEmployeeDocument(employeeId, file!, values),
    onSuccess: (doc) => {
      void message.success(doc.visibleToEmployee ? "Uploaded — the employee has been notified." : "Uploaded (HR only).");
      invalidate();
      setUploadOpen(false);
      setFile(null);
      form.resetFields();
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Couldn't upload that document.")),
  });
  const update = useMutation({
    mutationFn: ({ id, ...input }: { id: string; visibleToEmployee?: boolean }) => docsApi.updateEmployeeDocument(id, input),
    onSuccess: invalidate,
    onError: (err) => void message.error(apiErrorMessage(err, "That didn't work.")),
  });
  const archive = useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) => docsApi.setEmployeeDocumentArchived(id, archived),
    onSuccess: invalidate,
    onError: (err) => void message.error(apiErrorMessage(err, "That didn't work.")),
  });

  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      {canManage && (
        <Space style={{ width: "100%", justifyContent: "flex-end" }}>
          <Button type="primary" icon={<UploadOutlined />} onClick={() => setUploadOpen(true)}>
            Upload document
          </Button>
        </Space>
      )}
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={data}
        pagination={false}
        scroll={{ x: "max-content" }}
        locale={{ emptyText: "No documents on file." }}
        columns={[
          {
            title: "Document",
            render: (_, d) => (
              <Space orientation="vertical" size={0}>
                <Typography.Text strong delete={Boolean(d.archivedAt)}>
                  {d.title}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {d.fileName} · {docsApi.formatBytes(d.sizeBytes)}
                </Typography.Text>
              </Space>
            ),
          },
          { title: "Category", render: (_, d) => d.category.name },
          {
            title: "Employee can see it",
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
          { title: "Uploaded", render: (_, d) => new Date(d.uploadedAt).toLocaleDateString("en-IN") },
          { title: "Status", render: (_, d) => (d.archivedAt ? <Tag>Archived</Tag> : <Tag color="green">Current</Tag>) },
          {
            title: "",
            render: (_, d) => (
              <Space>
                <Button
                  size="small"
                  icon={<DownloadOutlined />}
                  aria-label={`Download ${d.title}`}
                  onClick={async () => {
                    try {
                      docsApi.startDownload(await docsApi.downloadEmployeeDocument(d.id));
                    } catch (err) {
                      void message.error(apiErrorMessage(err, "Couldn't download that document."));
                    }
                  }}
                />
                {canManage &&
                  (d.archivedAt ? (
                    <Button size="small" onClick={() => archive.mutate({ id: d.id, archived: false })}>
                      Restore
                    </Button>
                  ) : (
                    <Popconfirm title="Archive this document?" description="It's hidden, not deleted." onConfirm={() => archive.mutate({ id: d.id, archived: true })}>
                      <Button size="small" danger>
                        Archive
                      </Button>
                    </Popconfirm>
                  ))}
              </Space>
            ),
          },
        ]}
      />
      <Modal
        title="Upload a document"
        open={uploadOpen}
        onCancel={() => setUploadOpen(false)}
        onOk={() => form.submit()}
        okText="Upload"
        okButtonProps={{ disabled: !file, loading: upload.isPending }}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark={false} initialValues={{ visibleToEmployee: true }} onFinish={(v) => upload.mutate(v)}>
          <Form.Item label="File" required>
            <Upload
              accept={ACCEPT}
              maxCount={1}
              beforeUpload={(f) => {
                setFile(f);
                if (!form.getFieldValue("title")) form.setFieldValue("title", f.name.replace(/\.[^.]+$/, ""));
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
            <Select options={categories.map((c) => ({ value: c.id, label: c.name }))} />
          </Form.Item>
          <Form.Item name="visibleToEmployee" label="Employee can see it" valuePropName="checked" extra="On: it appears in their Document Center and they're notified. Off: HR only.">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
