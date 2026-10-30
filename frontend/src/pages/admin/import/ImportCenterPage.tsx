import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MusterUploadTab } from "../attendance/muster/MusterUploadPanel";
import { PunchImportTab } from "./PunchImportTab";
import { InvitationsTab } from "./InvitationsTab";
import { Dropzone } from "./Dropzone";
import { Button, Input, Tabs } from "antd";
import { DownloadOutlined, FileExcelOutlined } from "@ant-design/icons";
import { apiErrorMessage as errorMessage } from "../../../lib/apiError";
import * as importApi from "../../../api/importCenter";
import type { BatchDetail, BatchSummary, ImportDataset, StagingRow, UploadResult } from "../../../api/importCenter";
import { useAuth } from "../../../hooks/useAuth";
import { fs, fw, space, v } from "../../../theme/tokens";
import { ApprovalBanner, CardGrid, DataTable, FormGroupTitle, PageHeader, Panel, SkeletonCard, StatCard, StatusChip, toast, useIsPhone } from "../../../ui";

const DATASET_LABELS: Record<ImportDataset, string> = {
  "org-masters": "Org Masters",
  employees: "Employees",
  statutory: "Statutory",
  bank: "Bank",
  "leave-grants": "Leave Grants",
};

const fmtDateTime = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

// A short chip plus the messages as wrapping text: the messages can be long, and inside a chip (no wrap) they stretched the fixed Status column over the whole table.
function rowStatus(r: StagingRow) {
  const issues = r.errors.length > 0 ? r.errors : r.warnings;
  if (issues.length === 0) return <StatusChip tone="success">OK</StatusChip>;
  const danger = r.errors.length > 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: space[1], whiteSpace: "normal" }}>
      <StatusChip tone={danger ? "danger" : "warning"}>{danger ? "Error" : "Warning"}</StatusChip>
      <span style={{ color: danger ? v.danger : v.warningText, fontSize: fs.sm }}>{issues.join(" · ")}</span>
    </div>
  );
}

function RowsTable({ rows }: { rows: StagingRow[] }) {
  const columns = rows.length > 0 ? Object.keys(rows[0]!.data) : [];
  return (
    <DataTable<StagingRow>
      rowKey="rowNumber"
      density="compact"
      dataSource={rows}
      pagination={{ pageSize: 10 }}
      scroll={{ x: "max-content" }}
      mobile={{
        title: (r) => `Row ${r.rowNumber}`,
        subtitle: (r) => (columns[0] ? r.data[columns[0]] : undefined),
        status: (r) => (r.errors.length > 0 ? <StatusChip tone="danger">Error</StatusChip> : r.warnings.length > 0 ? <StatusChip tone="warning">Warning</StatusChip> : <StatusChip tone="success">OK</StatusChip>),
        fields: [
          ...columns.slice(1, 3).map((key) => ({ label: key, render: (r: StagingRow) => r.data[key] || "—" })),
          { label: "Issues", render: (r: StagingRow) => [...r.errors, ...r.warnings].join(" · ") || "—" },
        ],
      }}
      columns={[
        { title: "Row", dataIndex: "rowNumber", width: 64, fixed: "left", render: (n: number) => <span className="ws-num">{n}</span> },
        ...columns.map((key) => ({ title: key, key, render: (_: unknown, r: StagingRow) => r.data[key] })),
        { title: "Status", key: "status", fixed: "right" as const, width: 320, render: (_: unknown, r: StagingRow) => rowStatus(r) },
      ]}
    />
  );
}

function BatchHistory({ dataset, selectedId, onSelect }: { dataset: ImportDataset; selectedId: string | null; onSelect: (id: string) => void }) {
  const { data: batches = [] } = useQuery({ queryKey: ["import", "batches", dataset], queryFn: () => importApi.listBatches(dataset) });
  if (batches.length === 0) return null;
  return (
    <div>
      <FormGroupTitle>Recent uploads</FormGroupTitle>
      <DataTable<BatchSummary>
        rowKey="id"
        density="compact"
        dataSource={batches}
        pagination={{ pageSize: 5 }}
        onRowOpen={(r) => onSelect(r.id)}
        rowClassName={(r) => (r.id === selectedId ? "ant-table-row-selected" : "")}
        mobile={{
          title: (r) => r.fileName,
          subtitle: (r) => fmtDateTime(r.uploadedAt),
          status: (r) => <StatusChip status={r.status} />,
          fields: [
            { label: "Rows", render: (r) => r.totalRows },
            { label: "Valid", render: (r) => r.validRows },
            { label: "Errors", render: (r) => r.errorRows },
          ],
        }}
        columns={[
          {
            title: "File",
            dataIndex: "fileName",
            render: (name: string) => (
              <span style={{ display: "inline-flex", alignItems: "center", gap: space[2], color: v.textPrimary, fontWeight: fw.medium }}>
                <FileExcelOutlined aria-hidden style={{ color: v.accentText }} />
                {name}
              </span>
            ),
          },
          { title: "Rows", dataIndex: "totalRows", align: "right", render: (n: number) => <span className="ws-num">{n}</span> },
          { title: "Valid", dataIndex: "validRows", align: "right", render: (n: number) => <span className="ws-num">{n}</span> },
          { title: "Errors", dataIndex: "errorRows", align: "right", render: (n: number) => <span className="ws-num" style={{ color: n > 0 ? v.danger : undefined }}>{n}</span> },
          { title: "Status", dataIndex: "status", render: (s: string) => <StatusChip tone={s === "COMMITTED" ? "success" : "neutral"}>{s}</StatusChip> },
          { title: "Uploaded", dataIndex: "uploadedAt", render: (d: string) => <span className="ws-num">{fmtDateTime(d)}</span> },
        ]}
      />
    </div>
  );
}

// Exported for reuse by LeaveGranterPage's bulk-upload section — the same
// upload/validate/commit/history component, just parametrised by
// dataset="leave-grants" instead of embedded only in this Import Center
// (Employee/Admin Tools) screen. It renders flat (no outer Panel) because both
// hosts already put it inside a Panel's tabs.
export function ImportDatasetTab({ dataset }: { dataset: ImportDataset }) {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const phone = useIsPhone();
  // batchId is tracked separately from `result` — UploadResult keys its id
  // as `batchId`, BatchDetail (loaded from history) keys it as `id`; rather
  // than relying on that name lining up across the union, the id this
  // component is actually looking at lives in its own piece of state.
  const [batchId, setBatchId] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | BatchDetail | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState<"template" | "errors" | "history" | null>(null);
  const isBank = dataset === "bank";
  const canManageBank = hasPermission("employee.bank.edit");

  const uploadMutation = useMutation({
    mutationFn: (file: File) => importApi.uploadFile(dataset, file),
    onSuccess: (r) => {
      setBatchId(r.batchId);
      setResult(r);
      setConfirmText("");
      void queryClient.invalidateQueries({ queryKey: ["import", "batches", dataset] });
      toast.success(`Parsed ${r.totalRows} row(s): ${r.validRows} valid, ${r.errorRows} with errors.`);
    },
    onError: (err) => toast.error(errorMessage(err, "Could not upload this file.")),
  });

  const commitMutation = useMutation({
    mutationFn: () => importApi.commitBatch(batchId!, isBank ? confirmText : undefined),
    onSuccess: async (r) => {
      toast.success(`Committed ${r.committedRows} row(s).`);
      setResult(await importApi.getBatch(batchId!));
      void queryClient.invalidateQueries({ queryKey: ["import", "batches", dataset] });
    },
    onError: (err) => toast.error(errorMessage(err, "Could not commit this batch.")),
  });

  async function run(kind: "template" | "errors" | "history", fn: () => Promise<void>, fallback: string) {
    setBusy(kind);
    try {
      await fn();
    } catch (err) {
      toast.error(errorMessage(err, fallback));
    } finally {
      setBusy(null);
    }
  }
  const downloadTemplate = () =>
    run("template", async () => saveBlob(await importApi.downloadTemplate(dataset), `${dataset}-template.xlsx`), "Could not download the template.");
  const downloadErrorReport = () =>
    batchId ? run("errors", async () => saveBlob(await importApi.downloadErrorReport(batchId), `${dataset}-errors.xlsx`), "Could not download the error report.") : undefined;
  const selectHistoryBatch = (id: string) =>
    run(
      "history",
      async () => {
        setBatchId(id);
        setResult(await importApi.getBatch(id));
        setConfirmText("");
      },
      "Could not open this upload.",
    );

  const alreadyCommitted = result && "status" in result && result.status === "COMMITTED";
  const canCommit = !!result && result.errorRows === 0 && !alreadyCommitted && (!isBank || (canManageBank && confirmText === "IMPORT BANK DATA"));
  const label = DATASET_LABELS[dataset];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: phone ? space[4] : space[5], paddingTop: space[2] }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: space[3], justifyContent: "space-between" }}>
        <div style={{ color: v.textSecondary, fontSize: fs.md, flex: "1 1 320px", minWidth: 0 }}>
          Download the template, fill it in, then upload it. Every row is validated first — nothing is saved until you commit.
        </div>
        <Button icon={<DownloadOutlined />} loading={busy === "template"} onClick={() => void downloadTemplate()} block={phone}>
          Download blank template
        </Button>
      </div>

      {isBank && !canManageBank && <ApprovalBanner tone="warning" title="You can upload and validate bank data, but committing it requires the bank-details edit permission." />}

      <Dropzone
        compact
        accept=".xlsx"
        loading={uploadMutation.isPending}
        onFile={(file) => uploadMutation.mutate(file)}
        title={`Drop a filled-in ${label} template`}
        hint={`Click or drag a filled-in ${label} template here to upload and validate (.xlsx)`}
        buttonLabel="Choose file"
      />

      {busy === "history" && !result && <SkeletonCard lines={3} />}

      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: space[4] }} aria-live="polite">
          <CardGrid min={160} gap={space[4]}>
            <StatCard variant="compact" label="Rows" value={result.totalRows} />
            <StatCard variant="compact" tone="accent" label="Valid" value={result.validRows} />
            <StatCard variant="compact" tone={result.errorRows > 0 ? "danger" : "neutral"} label="With errors" value={result.errorRows} />
          </CardGrid>
          <ApprovalBanner
            tone={result.errorRows > 0 ? "warning" : "success"}
            title={alreadyCommitted ? `Committed — ${result.totalRows} row(s).` : `${result.totalRows} row(s): ${result.validRows} valid, ${result.errorRows} with errors.`}
            description={
              alreadyCommitted
                ? undefined
                : result.errorRows > 0
                  ? "Fix the rows marked in red (the error report lists them), then upload the file again."
                  : isBank
                    ? 'Type "IMPORT BANK DATA" below to confirm, then commit.'
                    : "Everything checks out. Commit to save these rows."
            }
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: space[2], alignItems: "center", flexDirection: phone ? "column" : "row" }}>
            {result.errorRows > 0 && (
              <Button icon={<DownloadOutlined />} loading={busy === "errors"} onClick={() => void downloadErrorReport()} block={phone}>
                Download error report
              </Button>
            )}
            {isBank && !alreadyCommitted && (
              <Input
                aria-label="Type IMPORT BANK DATA to confirm"
                placeholder='Type "IMPORT BANK DATA" to confirm'
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                style={{ width: phone ? "100%" : 280 }}
                disabled={!canManageBank}
              />
            )}
            {!alreadyCommitted && (
              <Button type="primary" danger disabled={!canCommit} loading={commitMutation.isPending} onClick={() => commitMutation.mutate()} block={phone}>
                Commit {result.validRows} row(s)
              </Button>
            )}
          </div>
          <RowsTable rows={result.rows} />
        </div>
      )}

      <BatchHistory dataset={dataset} selectedId={batchId} onSelect={(id) => void selectHistoryBatch(id)} />
    </div>
  );
}

function ReconciliationTab() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["import", "reconciliation"], queryFn: importApi.reconciliationReport });
  const table = (title: string, nameTitle: string, rows: { id: string; code: string; name: string; count: number }[] | undefined) => (
    <div style={{ minWidth: 0 }}>
      <FormGroupTitle>{title}</FormGroupTitle>
      <DataTable
        rowKey="id"
        density="compact"
        loading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        dataSource={rows ?? []}
        pagination={false}
        mobile={{ title: (r) => r.name, subtitle: (r) => r.code, status: (r) => <span className="ws-num" style={{ fontWeight: fw.semibold }}>{r.count}</span> }}
        columns={[
          { title: "Code", dataIndex: "code" },
          { title: nameTitle, dataIndex: "name" },
          { title: "Active employees", dataIndex: "count", align: "right", render: (n: number) => <span className="ws-num">{n}</span> },
        ]}
      />
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[4], paddingTop: space[2] }}>
      <div style={{ color: v.textSecondary, fontSize: fs.md }}>Active headcount, for comparing against greytHR before sending invites (spec §10).</div>
      <div style={{ maxWidth: 320 }}>
        <StatCard variant="compact" tone="accent" label="Total active employees" value={data?.totalActive ?? "—"} loading={isLoading} />
      </div>
      <CardGrid min={320} gap={space[6]}>
        {table("By branch", "Branch", data?.byLocation)}
        {table("By department", "Department", data?.byDepartment)}
      </CardGrid>
    </div>
  );
}

export function ImportCenterPage() {
  const { hasPermission } = useAuth();
  const canImportAll = hasPermission("import.manage");
  const canImportDetails = canImportAll || hasPermission("import.details.manage");
  return (
    <>
      <PageHeader title="Import Center" subtitle="Bring data in from spreadsheets: validate first, commit when it's clean" />
      <Panel>
        <Tabs
          items={[
            // Non-pay datasets need Import employee details (or the directors' Import Center); salary, bank and statutory are the directors' alone.
            ...(canImportDetails ? [{ key: "org-masters", label: "Org Masters", children: <ImportDatasetTab dataset="org-masters" /> }] : []),
            ...(canImportDetails ? [{ key: "employees", label: "Employees", children: <ImportDatasetTab dataset="employees" /> }] : []),
            ...(canImportAll ? [{ key: "statutory", label: "Statutory", children: <ImportDatasetTab dataset="statutory" /> }] : []),
            ...(canImportAll ? [{ key: "bank", label: "Bank", children: <ImportDatasetTab dataset="bank" /> }] : []),
            ...(hasPermission("invitations.send") ? [{ key: "invitations", label: "Invitations", children: <InvitationsTab /> }] : []),
            { key: "reconciliation", label: "Reconciliation Report", children: <ReconciliationTab /> },
            // Phase 2 P2-B: the emergency punch upload (attendance.devices.manage).
            ...(hasPermission("attendance.devices.manage") ? [{ key: "punches", label: "Punches (ATTLOG)", children: <PunchImportTab /> }] : []),
            // Phase 2 P2-D: the manual-capture branches' muster (attendance.manual.enter, branch-limited).
            ...(hasPermission("attendance.manual.enter") ? [{ key: "manual-muster", label: "Manual attendance muster", children: <MusterUploadTab /> }] : []),
          ]}
        />
      </Panel>
    </>
  );
}
