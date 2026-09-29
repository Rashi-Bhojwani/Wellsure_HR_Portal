import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, Space, Table, Tabs, Tag, Typography, Upload, message } from "antd";
import { DownloadOutlined, InboxOutlined } from "@ant-design/icons";
import { apiErrorMessage as errorMessage } from "../../../lib/apiError";
import * as importApi from "../../../api/importCenter";
import type { BatchDetail, ImportDataset, StagingRow, UploadResult } from "../../../api/importCenter";
import { useAuth } from "../../../hooks/useAuth";

const { Title, Text } = Typography;
const { Dragger } = Upload;

const DATASET_LABELS: Record<ImportDataset, string> = {
  "org-masters": "Org Masters",
  employees: "Employees",
  statutory: "Statutory",
  bank: "Bank",
  "leave-grants": "Leave Grants",
};

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function RowsTable({ rows }: { rows: StagingRow[] }) {
  const columns = rows.length > 0 ? Object.keys(rows[0]!.data) : [];
  return (
    <Table
      rowKey="rowNumber"
      size="small"
      dataSource={rows}
      pagination={{ pageSize: 10 }}
      scroll={{ x: "max-content" }}
      columns={[
        { title: "Row", dataIndex: "rowNumber", width: 60, fixed: "left" },
        ...columns.map((key) => ({ title: key, key, render: (_: unknown, r: StagingRow) => r.data[key] })),
        {
          title: "Status",
          key: "status",
          fixed: "right" as const,
          width: 320,
          render: (_: unknown, r: StagingRow) =>
            r.errors.length > 0 ? (
              <Tag color="red">{r.errors.join(" · ")}</Tag>
            ) : r.warnings.length > 0 ? (
              <Tag color="gold">{r.warnings.join(" · ")}</Tag>
            ) : (
              <Tag color="green">OK</Tag>
            ),
        },
      ]}
    />
  );
}

function BatchHistory({ dataset, onSelect }: { dataset: ImportDataset; onSelect: (id: string) => void }) {
  const { data: batches = [] } = useQuery({ queryKey: ["import", "batches", dataset], queryFn: () => importApi.listBatches(dataset) });
  if (batches.length === 0) return null;
  return (
    <Table
      rowKey="id"
      size="small"
      title={() => "Recent uploads"}
      dataSource={batches}
      pagination={{ pageSize: 5 }}
      columns={[
        { title: "File", dataIndex: "fileName", render: (v: string, r) => <a onClick={() => onSelect(r.id)}>{v}</a> },
        { title: "Rows", dataIndex: "totalRows" },
        { title: "Valid", dataIndex: "validRows" },
        { title: "Errors", dataIndex: "errorRows" },
        { title: "Status", dataIndex: "status", render: (v: string) => <Tag color={v === "COMMITTED" ? "green" : "default"}>{v}</Tag> },
        { title: "Uploaded", dataIndex: "uploadedAt", render: (v: string) => new Date(v).toLocaleString() },
      ]}
    />
  );
}

// Exported for reuse by LeaveGranterPage's bulk-upload section — the same
// upload/validate/commit/history component, just parametrised by
// dataset="leave-grants" instead of embedded only in this Import Center
// (Employee/Admin Tools) screen.
export function ImportDatasetTab({ dataset }: { dataset: ImportDataset }) {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  // batchId is tracked separately from `result` — UploadResult keys its id
  // as `batchId`, BatchDetail (loaded from history) keys it as `id`; rather
  // than relying on that name lining up across the union, the id this
  // component is actually looking at lives in its own piece of state.
  const [batchId, setBatchId] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | BatchDetail | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const isBank = dataset === "bank";
  const canManageBank = hasPermission("employee.bank.edit");

  const uploadMutation = useMutation({
    mutationFn: (file: File) => importApi.uploadFile(dataset, file),
    onSuccess: (r) => {
      setBatchId(r.batchId);
      setResult(r);
      setConfirmText("");
      void queryClient.invalidateQueries({ queryKey: ["import", "batches", dataset] });
      void message.success(`Parsed ${r.totalRows} row(s): ${r.validRows} valid, ${r.errorRows} with errors.`);
    },
    onError: (err) => void message.error(errorMessage(err, "Could not upload this file.")),
  });

  const commitMutation = useMutation({
    mutationFn: () => importApi.commitBatch(batchId!, isBank ? confirmText : undefined),
    onSuccess: async (r) => {
      void message.success(`Committed ${r.committedRows} row(s).`);
      setResult(await importApi.getBatch(batchId!));
      void queryClient.invalidateQueries({ queryKey: ["import", "batches", dataset] });
    },
    onError: (err) => void message.error(errorMessage(err, "Could not commit this batch.")),
  });

  async function downloadTemplate() {
    const blob = await importApi.downloadTemplate(dataset);
    saveBlob(blob, `${dataset}-template.xlsx`);
  }
  async function downloadErrorReport() {
    if (!batchId) return;
    const blob = await importApi.downloadErrorReport(batchId);
    saveBlob(blob, `${dataset}-errors.xlsx`);
  }
  async function selectHistoryBatch(id: string) {
    setBatchId(id);
    setResult(await importApi.getBatch(id));
    setConfirmText("");
  }

  const alreadyCommitted = result && "status" in result && result.status === "COMMITTED";
  const canCommit = !!result && result.errorRows === 0 && !alreadyCommitted && (!isBank || (canManageBank && confirmText === "IMPORT BANK DATA"));

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Space wrap>
        <Button icon={<DownloadOutlined />} onClick={() => void downloadTemplate()}>
          Download blank template
        </Button>
      </Space>

      {isBank && !canManageBank && (
        <Alert type="warning" showIcon message="You can upload and validate bank data, but committing it requires the bank-details edit permission." />
      )}

      <Dragger
        multiple={false}
        accept=".xlsx"
        showUploadList={false}
        disabled={uploadMutation.isPending}
        beforeUpload={(file) => {
          uploadMutation.mutate(file);
          return false;
        }}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p>Click or drag a filled-in {DATASET_LABELS[dataset]} template here to upload and validate</p>
      </Dragger>

      {result && (
        <>
          <Alert
            type={result.errorRows > 0 ? "warning" : "success"}
            showIcon
            message={
              alreadyCommitted
                ? `Committed — ${result.totalRows} row(s).`
                : `${result.totalRows} row(s): ${result.validRows} valid, ${result.errorRows} with errors.`
            }
          />
          <Space wrap>
            <Button onClick={() => void downloadErrorReport()}>Download error report</Button>
            {isBank && !alreadyCommitted && (
              <Input
                placeholder='Type "IMPORT BANK DATA" to confirm'
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                style={{ width: 260 }}
                disabled={!canManageBank}
              />
            )}
            {!alreadyCommitted && (
              <Button type="primary" danger disabled={!canCommit} loading={commitMutation.isPending} onClick={() => commitMutation.mutate()}>
                Commit {result.validRows} row(s)
              </Button>
            )}
          </Space>
          <RowsTable rows={result.rows} />
        </>
      )}

      <BatchHistory dataset={dataset} onSelect={(id) => void selectHistoryBatch(id)} />
    </Space>
  );
}

function ReconciliationTab() {
  const { data, isLoading } = useQuery({ queryKey: ["import", "reconciliation"], queryFn: importApi.reconciliationReport });
  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Text type="secondary">Active headcount, for comparing against greytHR before sending invites (spec §10).</Text>
      {data && <Text strong>Total active employees: {data.totalActive}</Text>}
      <Space size={16} align="start" wrap>
        <Table
          rowKey="id"
          size="small"
          loading={isLoading}
          title={() => "By branch"}
          dataSource={data?.byLocation ?? []}
          pagination={false}
          columns={[
            { title: "Code", dataIndex: "code" },
            { title: "Branch", dataIndex: "name" },
            { title: "Active employees", dataIndex: "count" },
          ]}
        />
        <Table
          rowKey="id"
          size="small"
          loading={isLoading}
          title={() => "By department"}
          dataSource={data?.byDepartment ?? []}
          pagination={false}
          columns={[
            { title: "Code", dataIndex: "code" },
            { title: "Department", dataIndex: "name" },
            { title: "Active employees", dataIndex: "count" },
          ]}
        />
      </Space>
    </Space>
  );
}

export function ImportCenterPage() {
  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Title level={3} style={{ margin: 0 }}>
        Import Center
      </Title>
      <Tabs
        items={[
          { key: "org-masters", label: "Org Masters", children: <ImportDatasetTab dataset="org-masters" /> },
          { key: "employees", label: "Employees", children: <ImportDatasetTab dataset="employees" /> },
          { key: "statutory", label: "Statutory", children: <ImportDatasetTab dataset="statutory" /> },
          { key: "bank", label: "Bank", children: <ImportDatasetTab dataset="bank" /> },
          { key: "reconciliation", label: "Reconciliation Report", children: <ReconciliationTab /> },
        ]}
      />
    </Space>
  );
}
