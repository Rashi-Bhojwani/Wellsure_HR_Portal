import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tabs, Tag, Typography, Upload, message } from "antd";
import { DownloadOutlined, InboxOutlined, PlusOutlined, TeamOutlined, UploadOutlined } from "@ant-design/icons";
import { DOCUMENT_MIME_TYPES, SENSITIVITY_LABELS, sensitivityChangeAllowed, type DocumentSensitivity } from "@shared/constants/peopleDocuments";
import * as docsApi from "../../../api/documents";
import type { CategoryScope, CompanyDocument, DocumentCategory } from "../../../api/documents";
import * as orgApi from "../../../api/org";
import { HelpStrip } from "../../../components/common/HelpStrip";
import { apiErrorMessage } from "../../../lib/apiError";
import { fs } from "../../../theme/tokens";

const ACCEPT = Object.values(DOCUMENT_MIME_TYPES).flatMap((t) => t.extensions).join(",");
const formatDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

function UploadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [file, setFile] = useState<File | null>(null);
  const { data: categories = [] } = useQuery({ queryKey: ["documents", "categories", "COMPANY"], queryFn: () => docsApi.listCategories({ appliesTo: "COMPANY" }) });
  const { data: departments = [] } = useQuery({ queryKey: ["org", "departments"], queryFn: orgApi.departments.list });
  const { data: locations = [] } = useQuery({ queryKey: ["org", "locations"], queryFn: () => orgApi.listLocations() });

  const mutation = useMutation({
    mutationFn: (values: { title: string; description?: string; categoryId: string; scopeLocationId?: string; scopeDepartmentId?: string }) =>
      docsApi.uploadCompanyDocument(file!, values),
    onSuccess: () => {
      void message.success("Document published.");
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
      form.resetFields();
      setFile(null);
      onClose();
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Couldn't upload that document.")),
  });

  return (
    <Modal
      title="Publish a company document"
      open={open}
      onCancel={onClose}
      okText="Publish"
      okButtonProps={{ disabled: !file, loading: mutation.isPending }}
      onOk={() => form.submit()}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" requiredMark={false} onFinish={(values) => mutation.mutate(values)}>
        <Form.Item label="File" required>
          <Upload.Dragger
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
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p>Click or drag a file here (PDF, Word, Excel or an image)</p>
          </Upload.Dragger>
        </Form.Item>
        <Form.Item name="title" label="Title" rules={[{ required: true, message: "Give the document a title." }]}>
          <Input maxLength={200} />
        </Form.Item>
        <Form.Item name="description" label="Description">
          <Input.TextArea rows={2} maxLength={1000} />
        </Form.Item>
        <Form.Item name="categoryId" label="Category" rules={[{ required: true, message: "Choose a category." }]}>
          <Select options={categories.map((c) => ({ value: c.id, label: c.name }))} />
        </Form.Item>
        <Typography.Text type="secondary">Leave both empty to publish to everyone. Set both to limit it to one department at one branch.</Typography.Text>
        <Space style={{ width: "100%", marginTop: 8 }} wrap>
          <Form.Item name="scopeDepartmentId" label="Only for department" style={{ minWidth: 200 }}>
            <Select allowClear placeholder="Everyone" options={departments.map((d) => ({ value: d.id, label: d.name }))} />
          </Form.Item>
          <Form.Item name="scopeLocationId" label="Only for branch" style={{ minWidth: 200 }}>
            <Select allowClear placeholder="Everyone" options={locations.map((l) => ({ value: l.id, label: l.name }))} />
          </Form.Item>
        </Space>
      </Form>
    </Modal>
  );
}

function DownloadsModal({ doc, onClose }: { doc: CompanyDocument | null; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["documents", "company", doc?.id, "downloads"],
    queryFn: () => docsApi.getCompanyDocumentDownloads(doc!.id),
    enabled: Boolean(doc),
  });
  return (
    <Modal title={doc ? `Who has downloaded "${doc.title}"` : ""} open={Boolean(doc)} onCancel={onClose} footer={null} width={720}>
      {data && (
        <Typography.Paragraph>
          <strong>{data.downloadedByCount}</strong> of <strong>{data.audienceSize}</strong> people it's published to have downloaded it.
        </Typography.Paragraph>
      )}
      <Table
        size="small"
        rowKey="employeeId"
        loading={isLoading}
        dataSource={data?.downloads ?? []}
        pagination={{ pageSize: 10 }}
        columns={[
          { title: "Employee", render: (_, r) => `${r.name} (${r.employeeCode})` },
          { title: "First downloaded", render: (_, r) => formatDate(r.firstDownloadedAt) },
          { title: "Last downloaded", render: (_, r) => formatDate(r.lastDownloadedAt) },
          { title: "Times", dataIndex: "downloadCount", align: "right" },
        ]}
      />
    </Modal>
  );
}

function DocumentsTab() {
  const queryClient = useQueryClient();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [statsDoc, setStatsDoc] = useState<CompanyDocument | null>(null);
  const { data = [], isLoading } = useQuery({
    queryKey: ["documents", "company", "manage", includeArchived],
    queryFn: () => docsApi.listManagedCompanyDocuments(includeArchived),
  });
  const archive = useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) => docsApi.setCompanyDocumentArchived(id, archived),
    onSuccess: (_, { archived }) => {
      void message.success(archived ? "Archived — employees no longer see it." : "Restored.");
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (err) => void message.error(apiErrorMessage(err, "That didn't work.")),
  });

  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <Space wrap style={{ width: "100%", justifyContent: "space-between" }}>
        <Space>
          <Switch checked={includeArchived} onChange={setIncludeArchived} aria-label="Show archived documents" />
          <Typography.Text>Show archived</Typography.Text>
        </Space>
        <Button type="primary" icon={<UploadOutlined />} onClick={() => setUploadOpen(true)}>
          Publish document
        </Button>
      </Space>
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={data}
        scroll={{ x: "max-content" }}
        columns={[
          {
            title: "Document",
            render: (_, d) => (
              <Space orientation="vertical" size={0}>
                <Typography.Text strong>{d.title}</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: fs.sm }}>
                  {d.fileName} · {docsApi.formatBytes(d.sizeBytes)}
                </Typography.Text>
              </Space>
            ),
          },
          { title: "Category", render: (_, d) => d.category.name },
          {
            title: "Published to",
            render: (_, d) =>
              d.scopeDepartment || d.scopeLocation ? [d.scopeDepartment?.name, d.scopeLocation?.name].filter(Boolean).join(" · ") : <Tag>Everyone</Tag>,
          },
          { title: "Published", render: (_, d) => formatDate(d.uploadedAt) },
          {
            title: "Downloaded by",
            render: (_, d) => (
              <Button type="link" icon={<TeamOutlined />} onClick={() => setStatsDoc(d)} style={{ padding: 0 }}>
                {d.downloadedByCount ?? 0}
              </Button>
            ),
          },
          { title: "Status", render: (_, d) => (d.archivedAt ? <Tag>Archived</Tag> : <Tag color="green">Live</Tag>) },
          {
            title: "",
            render: (_, d) => (
              <Space>
                <Button
                  size="small"
                  icon={<DownloadOutlined />}
                  aria-label={`Download ${d.title}`}
                  onClick={async () => docsApi.startDownload(await docsApi.downloadCompanyDocument(d.id))}
                />
                {d.archivedAt ? (
                  <Button size="small" onClick={() => archive.mutate({ id: d.id, archived: false })}>
                    Restore
                  </Button>
                ) : (
                  <Popconfirm title="Archive this document?" description="Employees stop seeing it. Nothing is deleted." onConfirm={() => archive.mutate({ id: d.id, archived: true })}>
                    <Button size="small" danger>
                      Archive
                    </Button>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]}
      />
      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <DownloadsModal doc={statsDoc} onClose={() => setStatsDoc(null)} />
    </Space>
  );
}

const SENSITIVITY_SHORT: Record<DocumentSensitivity, string> = { GENERAL: "General", PAY: "Pay", STATUTORY: "Statutory" };

function CategoriesTab() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm();
  const { data = [], isLoading } = useQuery({ queryKey: ["documents", "categories", "all"], queryFn: () => docsApi.listCategories({ includeInactive: true }) });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["documents", "categories"] });
  const create = useMutation({
    mutationFn: (values: { code: string; name: string; appliesTo: CategoryScope; sensitivity?: DocumentSensitivity; sortOrder?: number }) =>
      docsApi.createCategory({ ...values, sensitivity: values.appliesTo === "COMPANY" ? undefined : values.sensitivity }),
    onSuccess: () => {
      void message.success("Category added.");
      invalidate();
      form.resetFields();
      setCreateOpen(false);
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Couldn't add that category.")),
  });
  const update = useMutation({
    mutationFn: ({ id, ...input }: { id: string; name?: string; isActive?: boolean; sensitivity?: DocumentSensitivity; sortOrder?: number }) => docsApi.updateCategory(id, input),
    onSuccess: invalidate,
    onError: (err) => void message.error(apiErrorMessage(err, "Couldn't update that category.")),
  });

  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "flex-end" }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          Add category
        </Button>
      </Space>
      <Table<DocumentCategory>
        rowKey="id"
        loading={isLoading}
        dataSource={data}
        pagination={false}
        columns={[
          {
            title: "Name",
            render: (_, c) => (
              <Typography.Text editable={{ onChange: (name) => name.trim() && name !== c.name && update.mutate({ id: c.id, name: name.trim() }) }}>{c.name}</Typography.Text>
            ),
          },
          { title: "Code", dataIndex: "code" },
          { title: "Used for", render: (_, c) => (c.appliesTo === "COMPANY" ? "Company documents" : "Employee documents") },
          {
            title: "May contain",
            render: (_, c) =>
              c.appliesTo === "COMPANY" ? (
                <Typography.Text type="secondary">—</Typography.Text>
              ) : c.sensitivity === "GENERAL" ? (
                // Raise-only: a General category can become Pay or Statutory, never back.
                <Select<DocumentSensitivity>
                  size="small"
                  value={c.sensitivity}
                  style={{ width: 150 }}
                  aria-label={`What ${c.name} may contain`}
                  options={(["GENERAL", "PAY", "STATUTORY"] as const).filter((s) => sensitivityChangeAllowed(c.sensitivity, s)).map((s) => ({ value: s, label: SENSITIVITY_SHORT[s] }))}
                  onChange={(sensitivity) =>
                    Modal.confirm({
                      title: `Make "${c.name}" ${SENSITIVITY_SHORT[sensitivity]}?`,
                      content: "This can't be undone. Managers (and anyone without the matching permission) will stop seeing documents in this category.",
                      okText: "Raise it",
                      onOk: () => update.mutate({ id: c.id, sensitivity }),
                    })
                  }
                />
              ) : (
                <Tag color={c.sensitivity === "PAY" ? "gold" : "purple"}>{SENSITIVITY_SHORT[c.sensitivity]} · HR only</Tag>
              ),
          },
          {
            title: "Order",
            render: (_, c) => <InputNumber size="small" min={0} max={999} defaultValue={c.sortOrder} onBlur={(e) => { const v = Number(e.target.value); if (v !== c.sortOrder) update.mutate({ id: c.id, sortOrder: v }); }} aria-label={`Order for ${c.name}`} />,
          },
          {
            title: "Active",
            render: (_, c) => <Switch checked={c.isActive} onChange={(isActive) => update.mutate({ id: c.id, isActive })} aria-label={`${c.name} active`} />,
          },
        ]}
      />
      <Modal title="Add document category" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={() => form.submit()} okButtonProps={{ loading: create.isPending }} destroyOnHidden>
        <Form form={form} layout="vertical" requiredMark={false} initialValues={{ appliesTo: "COMPANY", sortOrder: 0 }} onFinish={(v) => create.mutate(v)}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input maxLength={80} />
          </Form.Item>
          <Form.Item name="code" label="Code" rules={[{ required: true }, { pattern: /^[A-Z0-9_]+$/, message: "Capital letters, digits and underscores." }]} extra="Permanent — can't be changed later.">
            <Input maxLength={40} />
          </Form.Item>
          <Form.Item name="appliesTo" label="Used for">
            <Select
              options={[
                { value: "COMPANY", label: "Company documents (policies, forms)" },
                { value: "EMPLOYEE", label: "Employee documents (letters, ID proofs)" },
              ]}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(a, b) => a.appliesTo !== b.appliesTo}>
            {({ getFieldValue }) =>
              getFieldValue("appliesTo") === "EMPLOYEE" && (
                <Form.Item
                  name="sensitivity"
                  label="What may its documents contain?"
                  rules={[{ required: true, message: "Choose one — this decides who can ever see them." }]}
                  extra="Pay and Statutory documents are never shown to managers, whatever they've been granted. This can be raised later, never lowered."
                >
                  <Select options={(["GENERAL", "PAY", "STATUTORY"] as const).map((s) => ({ value: s, label: SENSITIVITY_LABELS[s] }))} />
                </Form.Item>
              )
            }
          </Form.Item>
          <Form.Item name="sortOrder" label="Order">
            <InputNumber min={0} max={999} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}

// Employee app → Company Documents: publish policies and forms to everyone
// or to one department/branch, archive them, see who has downloaded each,
// and manage the document categories (company and employee).
export function CompanyDocumentsPage() {
  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <HelpStrip storageKey="company-documents">
        Documents published here appear in every eligible employee's Document Center. Archiving hides a document without deleting it. The download count shows who has
        opened each one.
      </HelpStrip>
      <Card>
        <Tabs
          items={[
            { key: "documents", label: "Documents", children: <DocumentsTab /> },
            { key: "categories", label: "Categories", children: <CategoriesTab /> },
          ]}
        />
      </Card>
    </Space>
  );
}
