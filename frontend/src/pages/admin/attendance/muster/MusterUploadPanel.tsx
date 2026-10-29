import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Select, Space, Typography, Upload } from "antd";
import { DownloadOutlined, UploadOutlined } from "@ant-design/icons";
import * as musterApi from "../../../../api/muster";
import type { MusterCycle, UploadPreview } from "../../../../api/muster";
import { apiErrorMessage } from "../../../../lib/apiError";
import { ApprovalBanner, DataTable, FormGroupTitle, KeyValueGrid, SkeletonCard, StatusChip, toast } from "../../../../ui";
import { space } from "../../../../theme/tokens";

const { Text, Paragraph } = Typography;
const KIND: Record<string, { label: string; tone: "neutral" | "danger" | "info" }> = { TIMED: { label: "times", tone: "info" }, STATUS_ONLY: { label: "status only", tone: "neutral" }, CLEARED: { label: "clears the day (back to NM)", tone: "danger" } };

/**
 * Muster upload (docs/plans/PHASE_2.md §5.2): the template for a branch and
 * cycle, then upload → preview → commit. Used on the muster page and in the
 * Import Center.
 */
export function MusterUploadPanel({ branches, cycles, defaultBranch, defaultCycle }: { branches: Array<{ id: string; name: string }>; cycles: MusterCycle[]; defaultBranch?: string; defaultCycle?: string }) {
  const queryClient = useQueryClient();
  const [branch, setBranch] = useState<string | undefined>(defaultBranch ?? (branches.length === 1 ? branches[0]!.id : undefined));
  const [cycle, setCycle] = useState<string | undefined>(defaultCycle ?? cycles[0]?.start);
  const [preview, setPreview] = useState<UploadPreview | null>(null);

  const template = useMutation({
    mutationFn: () => musterApi.downloadTemplate({ locationId: branch!, cycleStart: cycle }),
    onSuccess: (blob) => musterApi.saveBlob(blob, `muster-${branches.find((b) => b.id === branch)?.name ?? "branch"}-${cycle}.xlsx`),
    onError: (err) => toast.error(apiErrorMessage(err, "Could not download the template.")),
  });
  const upload = useMutation({
    mutationFn: (file: File) => musterApi.previewUpload(file),
    onSuccess: setPreview,
    onError: (err) => toast.error(apiErrorMessage(err, "Could not read that file.")),
  });
  const commit = useMutation({
    mutationFn: () => musterApi.commitUpload(preview!.uploadId),
    onSuccess: (r) => {
      toast.success(`${r.saved} ${r.saved === 1 ? "day" : "days"} marked from the upload.`);
      setPreview(null);
      void queryClient.invalidateQueries({ queryKey: ["attendance", "muster"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not apply this upload. Upload the file again to see what changed.")),
  });

  const changes = preview ? preview.counts.timed + preview.counts.statusOnly + preview.counts.cleared : 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[6] }}>
      <div>
        <FormGroupTitle>1. Download the template</FormGroupTitle>
        <Paragraph type="secondary" style={{ marginBottom: space[3] }}>
          One row per person marked by hand at the branch, with IN and OUT columns for each day, already filled with what's marked so far. Type the times
          (10:05 and 19:10) or a letter in IN (P, A, P:A, A:P, W). A blank cell leaves the day as it is.
        </Paragraph>
        <ApprovalBanner
          tone="warning"
          style={{ marginBottom: space[3] }}
          title={<>To clear a day marked by mistake, type <Text code>-</Text> (a dash) in its IN cell.</>}
          description="The day goes back to Not marked. Deleting what's in the cell does not clear it: a blank cell always means 'leave as it is', so a partly filled sheet can't wipe anything."
        />
        <Space wrap>
          <Select aria-label="Branch" placeholder="Branch" style={{ width: 220 }} value={branch} onChange={setBranch} options={branches.map((b) => ({ value: b.id, label: b.name }))} />
          <Select aria-label="Attendance cycle" style={{ width: 200 }} value={cycle} onChange={setCycle} options={cycles.map((c) => ({ value: c.start, label: c.label }))} />
          <Button icon={<DownloadOutlined />} disabled={!branch || !cycle} loading={template.isPending} onClick={() => template.mutate()}>
            Download template
          </Button>
        </Space>
      </div>
      <div>
        <FormGroupTitle>2. Upload the filled-in file</FormGroupTitle>
        <div>
          <Upload accept=".xlsx" showUploadList={false} beforeUpload={(file) => (upload.mutate(file), false)}>
            <Button icon={<UploadOutlined />} loading={upload.isPending}>
              Choose file and preview
            </Button>
          </Upload>
        </div>
      </div>
      {preview && (
        <div>
          <FormGroupTitle>3. Check and apply</FormGroupTitle>
          <div style={{ marginBottom: space[4] }}>
            <KeyValueGrid
              items={[
                { label: "Branch", value: preview.branch },
                { label: "Cycle", value: preview.cycle.label },
                { label: "File", value: preview.fileName, wide: true },
                { label: "Times", value: preview.counts.timed },
                { label: "Status only", value: preview.counts.statusOnly },
                { label: "Cleared", value: preview.counts.cleared },
                { label: "Unchanged", value: preview.counts.unchanged },
                { label: "Blank (left as is)", value: preview.counts.blank },
                { label: "Problems", value: preview.counts.issues ? <Text type="danger">{preview.counts.issues}</Text> : 0 },
              ]}
            />
          </div>
          {preview.issues.length > 0 && (
            <ApprovalBanner
              tone="warning"
              style={{ marginBottom: space[3] }}
              title={`${preview.issues.length} ${preview.issues.length === 1 ? "cell or row" : "cells or rows"} won't be applied`}
              description={<ul style={{ margin: 0, paddingLeft: 18, maxHeight: 160, overflow: "auto" }}>{preview.issues.map((i, n) => <li key={n}>Row {i.row}{i.employeeCode ? ` (${i.employeeCode})` : ""}{i.date ? `, ${i.date}` : ""}: {i.issue}</li>)}</ul>}
            />
          )}
          {changes > 0 ? (
            <DataTable
              density="compact"
              rowKey={(c) => `${c.employee}|${c.date}`}
              dataSource={preview.changes}
              pagination={{ pageSize: 10, hideOnSinglePage: true }}
              mobile={{ title: (c) => c.employee, subtitle: (c) => c.date, status: (c) => <StatusChip tone={KIND[c.kind]?.tone ?? "neutral"}>{KIND[c.kind]?.label ?? c.kind}</StatusChip>, fields: [{ label: "Now", render: (c) => c.before ?? "not marked" }, { label: "Becomes", render: (c) => (c.kind === "CLEARED" ? "not marked" : c.entry) }] }}
              columns={[
                { title: "Employee", dataIndex: "employee" },
                { title: "Date", dataIndex: "date" },
                { title: "Now", dataIndex: "before", render: (v: string | null) => (v ? <Text code>{v}</Text> : <Text type="secondary">not marked</Text>) },
                { title: "Becomes", dataIndex: "entry", render: (v: string, c) => (c.kind === "CLEARED" ? <Text type="danger">not marked</Text> : <Text code>{v}</Text>) },
                { title: "Kind", dataIndex: "kind", render: (k: string) => <StatusChip tone={KIND[k]?.tone ?? "neutral"}>{KIND[k]?.label ?? k}</StatusChip> },
              ]}
            />
          ) : (
            <ApprovalBanner tone="info" title="Nothing to change: every filled-in day already matches what's marked." />
          )}
          <Space style={{ marginTop: space[4] }} wrap>
            <Button type="primary" disabled={changes === 0} loading={commit.isPending} onClick={() => commit.mutate()}>
              Apply {changes} {changes === 1 ? "change" : "changes"}
            </Button>
            <Button onClick={() => setPreview(null)}>Cancel</Button>
          </Space>
        </div>
      )}
    </div>
  );
}

/** Import Center → "Manual attendance muster": the same panel, with its own branch and cycle lists. */
export function MusterUploadTab() {
  const cycles = useQuery({ queryKey: ["attendance", "muster", "cycles"], queryFn: musterApi.cycles });
  const muster = useQuery({ queryKey: ["attendance", "muster", {}], queryFn: () => musterApi.getMuster({}) });
  if (!cycles.data || !muster.data) return <SkeletonCard lines={4} />;
  return <MusterUploadPanel branches={muster.data.filters.locations} cycles={cycles.data.cycles} />;
}
