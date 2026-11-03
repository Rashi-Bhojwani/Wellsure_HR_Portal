import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Checkbox, Form, Input, Select, Space, Tabs, Upload } from "antd";
import { CloudUploadOutlined, EyeOutlined } from "@ant-design/icons";
import * as documentsApi from "../../../../api/documents";
import * as parityApi from "../../../../api/parity";
import { useAuth } from "../../../../hooks/useAuth";
import { apiErrorMessage as errorMessage } from "../../../../lib/apiError";
import { DataTable, PageHeader, Panel, StatusChip, toast } from "../../../../ui";
import { fs, space, v } from "../../../../theme/tokens";

// A-9 G4 (docs/plans/GREYTHR_PARITY_EMPLOYEE_ADMIN.md, item 13): many documents or photos at once, each file named by the person's employee number
// ("EMP-001.pdf" or "EMP-001__anything.pdf"). Check first (nothing is saved), then upload: every file goes through the same checks as a single upload.

const LABEL: Record<parityApi.BulkResult["rows"][number]["outcome"], [string, "success" | "info" | "warning" | "danger" | "neutral"]> = {
  READY: ["Ready", "info"],
  UPLOADED: ["Uploaded", "success"],
  UNMATCHED: ["No such employee", "warning"],
  BAD_NAME: ["Badly named", "warning"],
  DUPLICATE: ["Duplicate", "warning"],
  WRONG_TYPE: ["Wrong type", "danger"],
  ALREADY_UPLOADED: ["Already filed", "neutral"],
  FAILED: ["Failed", "danger"],
};

function Results({ result }: { result: parityApi.BulkResult | null }) {
  if (!result) return null;
  return (
    <>
      <p style={{ color: v.textSecondary, fontSize: fs.sm, margin: `${space[4]}px 0 ${space[2]}px` }}>
        {result.total} file{result.total === 1 ? "" : "s"}: {result.uploaded > 0 ? `${result.uploaded} uploaded, ` : ""}
        {result.ready > 0 ? `${result.ready} ready, ` : ""}
        {result.skipped} left out
      </p>
      <DataTable
        rowKey={(r) => r.fileName + (r.employeeCode ?? "")}
        dataSource={result.rows}
        pagination={false}
        columns={[
          { title: "File", dataIndex: "fileName", key: "f" },
          { title: "Employee", dataIndex: "employeeCode", key: "e", render: (c: string | null) => c ?? "—" },
          { title: "Result", dataIndex: "outcome", key: "o", render: (o: keyof typeof LABEL) => <StatusChip tone={LABEL[o][1]}>{LABEL[o][0]}</StatusChip> },
          { title: "Why", dataIndex: "reason", key: "r", render: (r: string | null) => r ?? "" },
        ]}
        mobile={{ title: (r) => r.fileName, subtitle: (r) => r.employeeCode ?? "—", status: (r) => <StatusChip tone={LABEL[r.outcome][1]}>{LABEL[r.outcome][0]}</StatusChip>, fields: [{ label: "Why", render: (r) => r.reason ?? "" }] }}
      />
    </>
  );
}

function BulkTab({ kind }: { kind: "documents" | "photos" }) {
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<parityApi.BulkResult | null>(null);
  const [categoryId, setCategoryId] = useState<string>();
  const [title, setTitle] = useState("");
  const [visible, setVisible] = useState(false);
  const categories = useQuery({ queryKey: ["documents", "categories", "EMPLOYEE"], queryFn: () => documentsApi.listCategories({ appliesTo: "EMPLOYEE" }), enabled: kind === "documents" });
  const fields = kind === "documents" ? { categoryId: categoryId ?? "", ...(title.trim() ? { title: title.trim() } : {}), visibleToEmployee: String(visible) } : {};
  const run = useMutation({
    mutationFn: (step: "preview" | "commit") => parityApi.bulkUpload(kind, step, files, fields),
    onSuccess: (r, step) => {
      setResult(r);
      if (step === "commit") toast.success(`${r.uploaded} uploaded.`);
    },
    onError: (err) => toast.error(errorMessage(err, "That did not work.")),
  });
  const ready = files.length > 0 && (kind === "photos" || Boolean(categoryId));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[4] }}>
      {kind === "documents" && (
        <Form layout="vertical" component="div">
          <Form.Item label="Category" required>
            <Select aria-label="Category" value={categoryId} onChange={setCategoryId} loading={categories.isLoading} options={(categories.data ?? []).filter((c) => c.isActive).map((c) => ({ value: c.id, label: c.name }))} style={{ maxWidth: 360 }} />
          </Form.Item>
          <Form.Item label="Title (optional — each file's name otherwise)">
            <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} style={{ maxWidth: 360 }} />
          </Form.Item>
          <Checkbox checked={visible} onChange={(e) => setVisible(e.target.checked)}>
            Each person can see their own document
          </Checkbox>
        </Form>
      )}
      <Upload.Dragger
        multiple
        accept={kind === "photos" ? "image/jpeg,image/png,image/webp" : undefined}
        beforeUpload={(_f, list) => {
          setFiles(list as unknown as File[]);
          setResult(null);
          return false;
        }}
        showUploadList={false}
      >
        <p style={{ margin: 0 }}>
          <CloudUploadOutlined /> {files.length > 0 ? `${files.length} file${files.length === 1 ? "" : "s"} chosen — choose again to replace` : `Drop ${kind} here, or select them`}
        </p>
        <p style={{ margin: 0, color: v.textSecondary, fontSize: fs.sm }}>Name each file after the employee number, e.g. EMP-001.{kind === "photos" ? "jpg" : "pdf"} or EMP-001__notes.{kind === "photos" ? "jpg" : "pdf"}. Up to 100 at a time.</p>
      </Upload.Dragger>
      <Space wrap>
        <Button icon={<EyeOutlined />} disabled={!ready} loading={run.isPending && run.variables === "preview"} onClick={() => run.mutate("preview")}>
          Check
        </Button>
        <Button type="primary" icon={<CloudUploadOutlined />} disabled={!ready || !result || result.ready === 0} loading={run.isPending && run.variables === "commit"} onClick={() => run.mutate("commit")}>
          Upload {result?.ready ? `${result.ready} file${result.ready === 1 ? "" : "s"}` : ""}
        </Button>
      </Space>
      <Results result={result} />
    </div>
  );
}

export function BulkUploadPage() {
  const { hasPermission } = useAuth();
  const items = [
    ...(hasPermission("employee.documents.manage") ? [{ key: "documents", label: "Documents", children: <BulkTab kind="documents" /> }] : []),
    ...(hasPermission("employee.edit") ? [{ key: "photos", label: "Photos", children: <BulkTab kind="photos" /> }] : []),
  ];
  return (
    <>
      <PageHeader title="Bulk Upload" subtitle="Documents or photos for many people at once, matched by employee number" />
      <Panel>
        <Tabs items={items} destroyOnHidden />
      </Panel>
    </>
  );
}
