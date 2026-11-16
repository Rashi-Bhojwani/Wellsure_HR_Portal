import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Upload } from "antd";
import { DownloadOutlined, UploadOutlined } from "@ant-design/icons";
import * as api from "../../../../api/updateImport";
import { saveBlob } from "../../../../api/muster";
import { useAuth } from "../../../../hooks/useAuth";
import { apiErrorMessage } from "../../../../lib/apiError";
import { formatDate } from "../../../../lib/dates";
import { fs, space, v } from "../../../../theme/tokens";
import { DataTable, EmptyState, PageHeader, Panel, QueryState, Stack, StatusChip, toast } from "../../../../ui";

// M session block 2, IE-07 / IE-08: update existing employees from a file. Each row is checked first; applying writes through the usual edits.
// Contact and personal details are applied by HR; job changes wait for a director when the setting says so. No bank or statutory column.
export function UpdateImportPage() {
  const queryClient = useQueryClient();
  const { hasRole } = useAuth();
  const director = hasRole("SUPER_ADMIN");
  const [batch, setBatch] = useState<api.ImportBatchView | null>(null);
  const waiting = useQuery({ queryKey: ["update-import", "waiting"], queryFn: api.waitingImports, enabled: director });
  const preview = useMutation({ mutationFn: api.previewImport, onSuccess: (b) => setBatch(b), onError: (e) => toast.error(apiErrorMessage(e, "Could not read the file.")) });
  const apply = useMutation({
    mutationFn: (id: string) => api.applyImport(id),
    onSuccess: (b) => { setBatch(b); void queryClient.invalidateQueries({ queryKey: ["update-import"] }); toast.success(`Applied: ${b.applied?.personal ?? 0} contact update(s), ${b.applied?.jobs ?? 0} job change(s)${b.applied?.waitingForDirector ? `; ${b.applied.waitingForDirector} job change(s) wait for a director` : ""}.`); },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not apply it.")),
  });
  const open = useMutation({ mutationFn: api.getImport, onSuccess: (b) => setBatch(b), onError: (e) => toast.error(apiErrorMessage(e, "Could not open it.")) });
  const good = batch?.rows.filter((r) => !r.errors.length).length ?? 0;
  const status = (r: api.ImportRowView) => (r.errors.length ? <StatusChip tone="danger">Not applied</StatusChip> : r.personalApplied || r.jobApplied ? <StatusChip tone="success">{r.changes.includes("job") && !r.jobApplied ? "Contact applied; job waits" : "Applied"}</StatusChip> : <StatusChip tone="info">Ready</StatusChip>);
  return (
    <>
      <PageHeader title="Update employees from a file" subtitle="Contact and personal details, and job changes with an effective date. Bank and statutory numbers are changed on the profile only." actions={<Button icon={<DownloadOutlined />} onClick={async () => saveBlob(await api.downloadTemplate(), "update-employees.xlsx")}>Template</Button>} />
      <Stack>
        <Panel title="Upload">
          <Upload accept=".xlsx" maxCount={1} showUploadList={false} beforeUpload={(file) => { preview.mutate(file); return false; }}>
            <Button icon={<UploadOutlined />} loading={preview.isPending}>Choose the filled template</Button>
          </Upload>
          <p style={{ margin: `${space[2]}px 0 0`, color: v.textSecondary, fontSize: fs.sm }}>Nothing changes until you apply. Rows with a problem are never applied.</p>
        </Panel>
        {director && waiting.isError && (
          <Panel title="Job changes waiting for a director">
            <QueryState isLoading={false} error={waiting.error} onRetry={() => void waiting.refetch()}>{null}</QueryState>
          </Panel>
        )}
        {director && (waiting.data?.length ?? 0) > 0 && (
          <Panel title="Job changes waiting for a director">
            <DataTable rowKey="id" dataSource={waiting.data ?? []} pagination={false} columns={[{ title: "File", dataIndex: "fileName" }, { title: "Uploaded", dataIndex: "createdAt", render: (x: string) => formatDate(x) }, { title: "Job rows", dataIndex: "jobRows" }, { title: "", key: "a", align: "right", render: (_, b) => <Button onClick={() => open.mutate(b.id)}>Open</Button> }]} mobile={{ title: (b) => b.fileName, subtitle: (b) => `${b.jobRows} job row(s)`, actions: (b) => <Button block onClick={() => open.mutate(b.id)}>Open</Button> }} />
          </Panel>
        )}
        {batch && (
          <Panel title={`Checked: ${good} of ${batch.rows.length} row(s) can be applied`} subtitle={batch.jobNeedsDirector ? "Job changes are applied by a director." : undefined} extra={<Button type="primary" disabled={!good} loading={apply.isPending} onClick={() => apply.mutate(batch.id)}>Apply</Button>}>
            <DataTable<api.ImportRowView> rowKey="rowNumber" dataSource={batch.rows} pagination={batch.rows.length > 25 ? { pageSize: 25 } : false} empty={<EmptyState compact title="No rows" description={null} />}
              columns={[
                { title: "Row", dataIndex: "rowNumber", width: 70 },
                { title: "Employee", dataIndex: "employeeCode" },
                { title: "Changes", key: "c", render: (_, r) => r.changes.join(", ") || "—" },
                { title: "Problems", key: "p", render: (_, r) => (r.errors.length ? r.errors.join("; ") : "—") },
                { title: "Status", key: "s", render: (_, r) => status(r) },
              ]}
              mobile={{ title: (r) => `Row ${r.rowNumber}: ${r.employeeCode}`, subtitle: (r) => (r.errors.length ? r.errors.join("; ") : r.changes.join(", ")), status }} />
          </Panel>
        )}
      </Stack>
    </>
  );
}
