import { useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, InputNumber, Radio, Select, Switch, Tabs, Typography, Upload } from "antd";
import { ContainerOutlined, DownloadOutlined, PlusOutlined, TeamOutlined, UndoOutlined, UploadOutlined } from "@ant-design/icons";
import { DOCUMENT_MIME_TYPES, SENSITIVITY_LABELS, sensitivityChangeAllowed, type DocumentSensitivity } from "@shared/constants/peopleDocuments";
import * as docsApi from "../../../api/documents";
import type { CategoryScope, CompanyDocument, DocumentCategory } from "../../../api/documents";
import * as orgApi from "../../../api/org";
import { HelpStrip } from "../../../components/common/HelpStrip";
import { apiErrorMessage } from "../../../lib/apiError";
import { fs, fw, radius, space, v } from "../../../theme/tokens";
import { ConfirmModal, DataTable, EmptyState, FilterBar, Illustration, PageHeader, Panel, SideDrawer, Stack, StatusChip, toast, useIsPhone } from "../../../ui";
import { FileName, SquareAction } from "../../employee/document-center/docBits";

const ACCEPT = Object.values(DOCUMENT_MIME_TYPES).flatMap((t) => t.extensions).join(",");
const formatDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const UPLOAD_FORM = "company-doc-upload";
const CATEGORY_FORM = "doc-category-form";

function RadioTile({ value, title, hint, checked }: { value: string; title: string; hint: string; checked: boolean }) {
  return (
    <label
      style={{
        flex: "1 1 180px",
        display: "flex",
        gap: space[3],
        alignItems: "flex-start",
        border: `1px solid ${checked ? v.accent : v.borderControl}`,
        borderRadius: radius.md,
        padding: space[3],
        cursor: "pointer",
        background: v.bgSurface,
      }}
    >
      <Radio value={value} />
      <span>
        <span style={{ display: "block", fontWeight: fw.semibold, color: v.textPrimary }}>{title}</span>
        <span style={{ display: "block", fontSize: fs.sm, color: v.textSecondary }}>{hint}</span>
      </span>
    </label>
  );
}

function UploadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [file, setFile] = useState<File | null>(null);
  const [share, setShare] = useState<"everyone" | "scoped">("everyone");
  const { data: categories = [] } = useQuery({ queryKey: ["documents", "categories", "COMPANY"], queryFn: () => docsApi.listCategories({ appliesTo: "COMPANY" }) });
  const { data: departments = [] } = useQuery({ queryKey: ["org", "departments"], queryFn: orgApi.departments.list, staleTime: 30_000 });
  const { data: locations = [] } = useQuery({ queryKey: ["org", "locations"], queryFn: () => orgApi.listLocations(), staleTime: 30_000 });

  const mutation = useMutation({
    mutationFn: (values: { title: string; description?: string; categoryId: string; scopeLocationId?: string; scopeDepartmentId?: string }) => docsApi.uploadCompanyDocument(file!, values),
    onSuccess: () => {
      toast.success("Document published.");
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
      form.resetFields();
      setFile(null);
      setShare("everyone");
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't upload that document.")),
  });

  return (
    <SideDrawer
      open={open}
      onClose={onClose}
      size="wide"
      title="Publish a company document"
      formId={UPLOAD_FORM}
      primaryLabel="Publish"
      primaryDisabled={!file}
      primaryLoading={mutation.isPending}
      destroyOnHidden={false}
    >
      <Form id={UPLOAD_FORM} form={form} layout="vertical" requiredMark onFinish={(values) => mutation.mutate(values)}>
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
            style={{ background: v.bgSubtle, borderRadius: radius.md }}
          >
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: space[2], padding: `${space[2]}px 0` }}>
              <Illustration name="upload" size={96} />
              <div style={{ fontWeight: fw.bold, fontSize: fs.lg, color: v.textPrimary }}>Drag & Drop here to upload</div>
              <div style={{ color: v.textSecondary, fontSize: fs.md }}>Or select file from your computer (PDF, Word, Excel or an image)</div>
              <span aria-hidden style={{ marginTop: space[2], display: "inline-flex", alignItems: "center", gap: space[2], background: v.primary, color: v.primaryText, borderRadius: radius.md, padding: `${space[2]}px ${space[4]}px`, fontWeight: fw.semibold }}>
                <UploadOutlined /> Upload File
              </span>
            </div>
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
        <Form.Item label="Share with" style={{ marginBottom: space[3] }}>
          <Radio.Group
            value={share}
            onChange={(e) => {
              const next = e.target.value as typeof share;
              setShare(next);
              if (next === "everyone") form.setFieldsValue({ scopeDepartmentId: undefined, scopeLocationId: undefined });
            }}
            style={{ display: "flex", gap: space[3], flexWrap: "wrap", width: "100%" }}
          >
            <RadioTile value="everyone" title="Everyone" hint="Every employee sees it" checked={share === "everyone"} />
            <RadioTile value="scoped" title="Department or branch" hint="Only the people you pick" checked={share === "scoped"} />
          </Radio.Group>
        </Form.Item>
        {share === "scoped" && (
          <>
            <Typography.Text type="secondary">Leave both empty to publish to everyone. Set both to limit it to one department at one branch.</Typography.Text>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", columnGap: space[4], marginTop: space[2] }}>
              <Form.Item name="scopeDepartmentId" label="Only for department">
                <Select allowClear placeholder="Everyone" options={departments.map((d) => ({ value: d.id, label: d.name }))} />
              </Form.Item>
              <Form.Item name="scopeLocationId" label="Only for branch">
                <Select allowClear placeholder="Everyone" options={locations.map((l) => ({ value: l.id, label: l.name }))} />
              </Form.Item>
            </div>
          </>
        )}
      </Form>
    </SideDrawer>
  );
}

function DownloadsModal({ doc, onClose }: { doc: CompanyDocument | null; onClose: () => void }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["documents", "company", doc?.id, "downloads"],
    queryFn: () => docsApi.getCompanyDocumentDownloads(doc!.id),
    enabled: Boolean(doc),
  });
  return (
    <SideDrawer open={Boolean(doc)} onClose={onClose} size="wide" title="Downloads" subtitle={doc ? `Who has downloaded "${doc.title}"` : undefined} footer={null}>
      {data && (
        <Typography.Paragraph>
          <strong>{data.downloadedByCount}</strong> of <strong>{data.audienceSize}</strong> people it's published to have downloaded it.
        </Typography.Paragraph>
      )}
      <DataTable
        rowKey="employeeId"
        density="compact"
        loading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        dataSource={data?.downloads ?? []}
        pagination={{ pageSize: 10 }}
        empty={<EmptyState compact illustration="inbox" title="No downloads yet" description={null} />}
        columns={[
          { title: "Employee", key: "employee", render: (_, r) => `${r.name} (${r.employeeCode})` },
          { title: "First downloaded", key: "first", render: (_, r) => formatDate(r.firstDownloadedAt) },
          { title: "Last downloaded", key: "last", render: (_, r) => formatDate(r.lastDownloadedAt) },
          { title: "Times", dataIndex: "downloadCount", align: "right" },
        ]}
      />
    </SideDrawer>
  );
}

const scopeText = (d: CompanyDocument) => (d.scopeDepartment || d.scopeLocation ? [d.scopeDepartment?.name, d.scopeLocation?.name].filter(Boolean).join(" · ") : "Everyone");

function DocumentsTab() {
  const queryClient = useQueryClient();
  const phone = useIsPhone();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [statsDoc, setStatsDoc] = useState<CompanyDocument | null>(null);
  const [archiving, setArchiving] = useState<CompanyDocument | null>(null);
  const { data = [], isLoading, error, refetch } = useQuery({
    queryKey: ["documents", "company", "manage", includeArchived],
    queryFn: () => docsApi.listManagedCompanyDocuments(includeArchived),
    placeholderData: keepPreviousData,
  });
  const archive = useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) => docsApi.setCompanyDocumentArchived(id, archived),
    onSuccess: (_, { archived }) => {
      toast.success(archived ? "Archived — employees no longer see it." : "Restored.");
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
      setArchiving(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "That didn't work.")),
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? data.filter((d) => [d.title, d.fileName, d.category.name, d.description ?? ""].some((s) => s.toLowerCase().includes(q))) : data;
  }, [data, search]);

  const downloadDoc = async (d: CompanyDocument) => {
    try {
      docsApi.startDownload(await docsApi.downloadCompanyDocument(d.id));
    } catch (err) {
      toast.error(apiErrorMessage(err, "Couldn't download that document."));
    }
  };

  const actions = (d: CompanyDocument) => (
    <div style={{ display: "flex", gap: space[2], justifyContent: "flex-end" }}>
      <SquareAction tone="view" icon={<TeamOutlined />} label={`Who downloaded ${d.title}`} onClick={() => setStatsDoc(d)} />
      <SquareAction tone="edit" icon={<DownloadOutlined />} label={`Download ${d.title}`} onClick={() => void downloadDoc(d)} />
      {d.archivedAt ? (
        <SquareAction tone="view" icon={<UndoOutlined />} label={`Restore ${d.title}`} loading={archive.isPending && archive.variables?.id === d.id} onClick={() => archive.mutate({ id: d.id, archived: false })} />
      ) : (
        <SquareAction tone="danger" icon={<ContainerOutlined />} label={`Archive ${d.title}`} onClick={() => setArchiving(d)} />
      )}
    </div>
  );

  const publishButton = (
    <Button type="primary" icon={<UploadOutlined />} onClick={() => setUploadOpen(true)} block={phone}>
      Publish document
    </Button>
  );

  return (
    <>
      <FilterBar
        onSearch={setSearch}
        searchPlaceholder="Search documents"
        activeCount={includeArchived ? 1 : 0}
        onClear={() => setIncludeArchived(false)}
        filters={
          <label style={{ display: "inline-flex", alignItems: "center", gap: space[2], color: v.textBody }}>
            <Switch checked={includeArchived} onChange={setIncludeArchived} aria-label="Show archived documents" />
            Show archived
          </label>
        }
        actions={publishButton}
      />
      <DataTable<CompanyDocument>
        rowKey="id"
        loading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        dataSource={rows}
        empty={
          data.length === 0 ? (
            <EmptyState
              illustration="documents"
              title="There's no document here"
              description='Publish a policy or form by clicking "Publish document".'
              action={
                <Button type="primary" icon={<UploadOutlined />} onClick={() => setUploadOpen(true)}>
                  Publish document
                </Button>
              }
            />
          ) : (
            <EmptyState kind="no-results" compact />
          )
        }
        columns={[
          {
            title: "Document",
            key: "document",
            render: (_, d) => <FileName title={d.title} caption={`${d.fileName} · ${docsApi.formatBytes(d.sizeBytes)}`} mimeType={d.mimeType} fileName={d.fileName} />,
          },
          { title: "Category", key: "category", render: (_, d) => d.category.name },
          { title: "Published to", key: "scope", render: (_, d) => (d.scopeDepartment || d.scopeLocation ? scopeText(d) : <StatusChip tone="neutral">Everyone</StatusChip>) },
          { title: "Published", key: "date", render: (_, d) => formatDate(d.uploadedAt) },
          {
            title: "Downloaded by",
            key: "downloads",
            render: (_, d) => (
              <Button type="link" icon={<TeamOutlined />} onClick={() => setStatsDoc(d)} style={{ padding: 0 }} aria-label={`${d.downloadedByCount ?? 0} downloads of ${d.title}`}>
                {d.downloadedByCount ?? 0}
              </Button>
            ),
          },
          { title: "Status", key: "status", render: (_, d) => (d.archivedAt ? <StatusChip tone="neutral">Archived</StatusChip> : <StatusChip tone="success">Live</StatusChip>) },
          { title: "Action", key: "actions", align: "right", render: (_, d) => actions(d) },
        ]}
        mobile={{
          title: (d) => <FileName title={d.title} caption={`${d.fileName} · ${docsApi.formatBytes(d.sizeBytes)}`} mimeType={d.mimeType} fileName={d.fileName} />,
          status: (d) => (d.archivedAt ? <StatusChip tone="neutral">Archived</StatusChip> : <StatusChip tone="success">Live</StatusChip>),
          fields: [
            { label: "Category", render: (d) => d.category.name },
            { label: "Published to", render: (d) => scopeText(d) },
            { label: "Published", render: (d) => formatDate(d.uploadedAt) },
            { label: "Downloaded by", render: (d) => d.downloadedByCount ?? 0 },
          ],
          actions,
        }}
      />
      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <DownloadsModal doc={statsDoc} onClose={() => setStatsDoc(null)} />
      <ConfirmModal
        open={archiving !== null}
        onCancel={() => setArchiving(null)}
        onConfirm={() => archiving && archive.mutate({ id: archiving.id, archived: true })}
        loading={archive.isPending}
        danger
        title="Archive this document?"
        description="Employees stop seeing it. Nothing is deleted."
        confirmLabel="Archive"
      />
    </>
  );
}

const SENSITIVITY_SHORT: Record<DocumentSensitivity, string> = { GENERAL: "General", PAY: "Pay", STATUTORY: "Statutory" };

function CategoriesTab() {
  const queryClient = useQueryClient();
  const phone = useIsPhone();
  const [createOpen, setCreateOpen] = useState(false);
  const [raising, setRaising] = useState<{ category: DocumentCategory; sensitivity: DocumentSensitivity } | null>(null);
  const [form] = Form.useForm();
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ["documents", "categories", "all"], queryFn: () => docsApi.listCategories({ includeInactive: true }) });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["documents", "categories"] });
  const create = useMutation({
    mutationFn: (values: { code: string; name: string; appliesTo: CategoryScope; sensitivity?: DocumentSensitivity; sortOrder?: number }) =>
      docsApi.createCategory({ ...values, sensitivity: values.appliesTo === "COMPANY" ? undefined : values.sensitivity }),
    onSuccess: () => {
      toast.success("Category added.");
      invalidate();
      form.resetFields();
      setCreateOpen(false);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't add that category.")),
  });
  const update = useMutation({
    mutationFn: ({ id, ...input }: { id: string; name?: string; isActive?: boolean; sensitivity?: DocumentSensitivity; sortOrder?: number }) => docsApi.updateCategory(id, input),
    onSuccess: () => {
      invalidate();
      setRaising(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't update that category.")),
  });

  const sensitivityCell = (c: DocumentCategory) =>
    c.appliesTo === "COMPANY" ? (
      <Typography.Text type="secondary">—</Typography.Text>
    ) : c.sensitivity === "GENERAL" ? (
      // Raise-only: a General category can become Pay or Statutory, never back.
      <Select<DocumentSensitivity>
        value={c.sensitivity}
        style={{ width: 150 }}
        aria-label={`What ${c.name} may contain`}
        options={(["GENERAL", "PAY", "STATUTORY"] as const).filter((s) => sensitivityChangeAllowed(c.sensitivity, s)).map((s) => ({ value: s, label: SENSITIVITY_SHORT[s] }))}
        onChange={(sensitivity) => setRaising({ category: c, sensitivity })}
      />
    ) : (
      <StatusChip tone={c.sensitivity === "PAY" ? "warning" : "purple"}>{SENSITIVITY_SHORT[c.sensitivity]} · HR only</StatusChip>
    );

  const orderCell = (c: DocumentCategory) => (
    <InputNumber
      min={0}
      max={999}
      defaultValue={c.sortOrder}
      style={{ width: 90 }}
      onBlur={(e) => {
        const n = Number(e.target.value);
        if (n !== c.sortOrder) update.mutate({ id: c.id, sortOrder: n });
      }}
      aria-label={`Order for ${c.name}`}
    />
  );
  const activeCell = (c: DocumentCategory) => <Switch checked={c.isActive} onChange={(isActive) => update.mutate({ id: c.id, isActive })} aria-label={`${c.name} active`} />;
  const nameCell = (c: DocumentCategory) => (
    <Typography.Text strong editable={{ onChange: (name) => name.trim() && name !== c.name && update.mutate({ id: c.id, name: name.trim() }) }}>
      {c.name}
    </Typography.Text>
  );
  const usedFor = (c: DocumentCategory) => (c.appliesTo === "COMPANY" ? "Company documents" : "Employee documents");

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: space[5] }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)} block={phone}>
          Add category
        </Button>
      </div>
      <DataTable<DocumentCategory>
        rowKey="id"
        loading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        dataSource={data}
        pagination={false}
        columns={[
          { title: "Name", key: "name", render: (_, c) => nameCell(c) },
          { title: "Code", dataIndex: "code" },
          { title: "Used for", key: "usedFor", render: (_, c) => usedFor(c) },
          { title: "May contain", key: "sensitivity", render: (_, c) => sensitivityCell(c) },
          { title: "Order", key: "order", render: (_, c) => orderCell(c) },
          { title: "Active", key: "active", render: (_, c) => activeCell(c) },
        ]}
        mobile={{
          title: (c) => nameCell(c),
          subtitle: (c) => `${c.code} · ${usedFor(c)}`,
          status: (c) => activeCell(c),
          fields: [
            { label: "May contain", render: (c) => sensitivityCell(c) },
            { label: "Order", render: (c) => orderCell(c) },
          ],
        }}
      />
      <SideDrawer open={createOpen} onClose={() => setCreateOpen(false)} title="Add document category" formId={CATEGORY_FORM} primaryLabel="Add category" primaryLoading={create.isPending}>
        <Form id={CATEGORY_FORM} form={form} layout="vertical" requiredMark initialValues={{ appliesTo: "COMPANY", sortOrder: 0 }} onFinish={(vals) => create.mutate(vals)}>
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
      </SideDrawer>
      <ConfirmModal
        open={raising !== null}
        onCancel={() => setRaising(null)}
        onConfirm={() => raising && update.mutate({ id: raising.category.id, sensitivity: raising.sensitivity })}
        loading={update.isPending}
        title={raising ? `Make "${raising.category.name}" ${SENSITIVITY_SHORT[raising.sensitivity]}?` : ""}
        description="This can't be undone. Managers (and anyone without the matching permission) will stop seeing documents in this category."
        confirmLabel="Raise it"
      />
    </>
  );
}

// Employee app → Company Documents: publish policies and forms to everyone
// or to one department/branch, archive them, see who has downloaded each,
// and manage the document categories (company and employee).
export function CompanyDocumentsPage() {
  return (
    <>
      <PageHeader title="Company Documents" subtitle="Policies and forms published to employees' Document Center" />
      <Stack>
        <HelpStrip storageKey="company-documents">
          Documents published here appear in every eligible employee's Document Center. Archiving hides a document without deleting it. The download count shows who has
          opened each one.
        </HelpStrip>
        <Panel bodyStyle={{ paddingTop: space[2] }}>
          <Tabs
            items={[
              { key: "documents", label: "Documents", children: <DocumentsTab /> },
              { key: "categories", label: "Categories", children: <CategoriesTab /> },
            ]}
          />
        </Panel>
      </Stack>
    </>
  );
}
